import 'dotenv/config';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { getEmbedding, VECTOR_DIMENSION } from '../lib/embeddings';
import { getSupabase } from '../lib/supabase';

// Загружаем .env.local (tsx сам .env не грузит)
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const KNOWLEDGE_BASE_DIR = path.join(process.cwd(), 'knowledge_base');
const CHUNK_SIZE = 1000; // символов
const CHUNK_OVERLAP = 200; // символов перекрытия

interface Document {
  filePath: string;
  fileName: string;
  content: string;
}

interface IndexStats {
  filesProcessed: number;
  chunksIndexed: number;
  errors: number;
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ SUPABASE_URL или SUPABASE_ANON_KEY не заданы в .env.local');
  console.error('Пожалуйста, создайте проект на https://supabase.com и добавьте переменные в .env.local');
  console.error('\nИнструкция:');
  console.error('  1. Создайте проект: https://supabase.com/dashboard');
  console.error('  2. Settings → API → скопируйте URL и anon key');
  console.error('  3. Добавьте в .env.local:');
  console.error('     SUPABASE_URL=https://xxx.supabase.co');
  console.error('     SUPABASE_ANON_KEY=your-anon-key\n');
  process.exit(1);
}

const supabase = getSupabase();
if (!supabase) {
  console.error('❌ Не удалось инициализировать Supabase клиент');
  process.exit(1);
}

/**
 * Проверка готовности БД (таблица должна быть создана вручную)
 */
async function checkDatabaseReady(): Promise<void> {
  console.log(`🔧 Проверка базы данных (размерность вектора: ${VECTOR_DIMENSION})...`);

  // Проверяем что таблица documents существует
  const { error, count } = await supabase!
    .from('documents')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('\n❌ Таблица documents не найдена!');
    console.error('Выполните SQL из supabase/init-db.sql в Supabase SQL Editor:');
    console.error('https://supabase.com/dashboard → ваш проект → SQL Editor\n');
    throw error;
  }

  const docCount = count || 0;
  console.log(`✅ База готова (в таблице ${docCount} документов)`);
}

/**
 * Рекурсивно читает файлы из папки knowledge_base
 */
function readDocuments(dir: string): Document[] {
  const documents: Document[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      documents.push(...readDocuments(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.txt'))) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      documents.push({
        filePath: fullPath,
        fileName: entry.name,
        content,
      });
    }
  }

  return documents;
}

/**
 * Разбивает текст на чанки с перекрытием
 */
function chunkText(text: string): string[] {
  const chunks: string[] = [];

  // Разбиваем по параграфам (двойной перенос строки)
  const paragraphs = text.split(/\n\n+/);

  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // Если добавление параграфа превышает CHUNK_SIZE, сохраняем текущий чанк
    if (currentChunk && currentChunk.length + trimmed.length > CHUNK_SIZE) {
      chunks.push(currentChunk.trim());

      // Начинаем новый чанк с перекрытием (берём конец предыдущего)
      const words = currentChunk.split(' ');
      let overlapSize = 0;
      let overlapText = '';

      // Берём последние слова, пока не достигнем CHUNK_OVERLAP
      for (let i = words.length - 1; i >= 0; i--) {
        const word = words[i];
        if (overlapSize + word.length + 1 > CHUNK_OVERLAP) break;
        overlapText = word + ' ' + overlapText;
        overlapSize += word.length + 1;
      }

      currentChunk = overlapText + trimmed;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
    }
  }

  // Добавляем последний чанк
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Индексация одного документа
 */
async function indexDocument(doc: Document): Promise<number> {
  const chunks = chunkText(doc.content);
  const fileName = path.relative(KNOWLEDGE_BASE_DIR, doc.filePath);

  for (const chunk of chunks) {
    try {
      const embedding = await getEmbedding(chunk);

      // Вставляем через Supabase
      const { error } = await supabase!.from('documents').insert({
        content: chunk,
        embedding: JSON.stringify(embedding),
        source_file: fileName,
      });

      if (error) {
        console.warn(`⚠️  Ошибка вставки чанка из ${fileName}:`, error.message);
        throw error;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  Ошибка индексации чанка из ${fileName}:`, errMsg);
      throw err;
    }
  }

  return chunks.length;
}

/**
 * Очистка таблицы перед индексацией.
 * Идемпотентный реиндекс: без этого повторный npm run index плодил бы
 * дубликаты чанков для каждого документа.
 */
async function clearExistingDocuments(): Promise<void> {
  const { count } = await supabase!.from('documents').select('*', { count: 'exact', head: true });
  const documentCount = count || 0;

  if (documentCount > 0) {
    console.log(`🗑️  Удаление ${documentCount} старых документов...`);
    // PostgREST требует фильтр для delete; SERIAL id всегда ≥ 1, поэтому
    // gt('id', 0) выбирает все строки.
    const { error } = await supabase!.from('documents').delete().gt('id', 0);
    if (error) throw error;
    console.log('✅ Таблица очищена');
  }
}

/**
 * Главная функция индексации
 */
async function main(): Promise<void> {
  const startTime = Date.now();
  const stats: IndexStats = {
    filesProcessed: 0,
    chunksIndexed: 0,
    errors: 0,
  };

  try {
    await checkDatabaseReady();
    await clearExistingDocuments();

    // Читаем документы
    console.log(`📂 Чтение документов из ${KNOWLEDGE_BASE_DIR}...`);
    const documents = readDocuments(KNOWLEDGE_BASE_DIR);

    if (documents.length === 0) {
      console.warn('⚠️  Документы не найдены. Создайте .md или .txt файлы в папке knowledge_base/');
      return;
    }

    console.log(`📄 Найдено ${documents.length} файлов`);

    // Индексируем каждый документ
    const docsToProcess = documents;
    for (const doc of docsToProcess) {
      const fileName = path.relative(KNOWLEDGE_BASE_DIR, doc.filePath);
      process.stdout.write(`\n📝 Индексация: ${fileName}... `);

      try {
        const chunksCount = await indexDocument(doc);
        stats.filesProcessed++;
        stats.chunksIndexed += chunksCount;
        console.log(`✅ ${chunksCount} чанков`);
      } catch {
        stats.errors++;
        console.log(`❌ ошибка`);
      }
    }

    // Статистика
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(50));
    console.log('📊 Статистика индексации:');
    console.log(`   Файлов обработано: ${stats.filesProcessed}`);
    console.log(`   Чанков проиндексировано: ${stats.chunksIndexed}`);
    console.log(`   Ошибок: ${stats.errors}`);
    console.log(`   Время: ${elapsed}s`);
    console.log('='.repeat(50));

    if (stats.errors > 0) {
      console.warn(`⚠️  Индексация завершена с ${stats.errors} ошибками. Проверьте логи выше.`);
    } else {
      console.log('✅ Индексация успешно завершена!');
    }
  } catch (error) {
    console.error('\n❌ Критическая ошибка при индексации:', error);
    process.exit(1);
  }
}

main();
