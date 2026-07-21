/**
 * One-time миграция: переносит .md/.txt из knowledge_base/ в таблицу raw_documents
 * и переиндексирует embeddings (связывая чанки через raw_document_id).
 *
 * Запуск: npm run migrate
 *
 * После успешной миграции папку knowledge_base/ можно удалить — контент
 * теперь редактируется в Supabase Dashboard → Table Editor → raw_documents.
 *
 * Скрипт идемпотентен: повторный запуск обновит контент существующих документов
 * (upsert по title) и переиндексирует только их.
 */

import 'dotenv/config';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { getSupabase } from '../lib/supabase';
import { reindexDocument } from '../lib/reindex';
import { DEFAULT_COUNTRY } from '../lib/constants';

// tsx сам .env не грузит
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const KNOWLEDGE_BASE_DIR = path.join(process.cwd(), 'knowledge_base');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ SUPABASE_URL или SUPABASE_ANON_KEY не заданы в .env.local');
  process.exit(1);
}

const supabase = getSupabase();
if (!supabase) {
  console.error('❌ Не удалось инициализировать Supabase клиент');
  process.exit(1);
}

/**
 * Эвристика категории по имени файла. Не претендует на точность —
 * категорию всегда можно поправить руками в Table Editor.
 */
function guessCategory(fileName: string): string {
  const n = fileName.toLowerCase();
  if (n.includes('visa') || n.includes('виз')) return 'visa';
  if (n.includes('insur') || n.includes('страх')) return 'insurance';
  if (n.includes('sim') || n.includes('esim') || n.includes('internet')) return 'telecom';
  if (n.includes('airport') || n.includes('transfer') || n.includes('аэропорт') || n.includes('трансфер')) return 'airport';
  if (n.includes('hotel') || n.includes('отель') || n.includes('housing')) return 'hotel';
  return 'general';
}

function readMarkdownFiles(dir: string): { fileName: string; content: string }[] {
  const out: { fileName: string; content: string }[] = [];
  if (!fs.existsSync(dir)) return out;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...readMarkdownFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.txt'))) {
      out.push({ fileName: entry.name, content: fs.readFileSync(fullPath, 'utf-8') });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const startTime = Date.now();

  if (!fs.existsSync(KNOWLEDGE_BASE_DIR)) {
    console.error(`❌ Папка не найдена: ${KNOWLEDGE_BASE_DIR}`);
    console.error('Если вы уже перенесли контент в raw_documents вручную — этот скрипт не нужен.');
    process.exit(1);
  }

  const files = readMarkdownFiles(KNOWLEDGE_BASE_DIR);
  if (files.length === 0) {
    console.warn('⚠️  В knowledge_base/ нет .md/.txt файлов. Нечего мигрировать.');
    return;
  }

  console.log(`📄 Найдено файлов: ${files.length}`);
  console.log(`📂 ${KNOWLEDGE_BASE_DIR}\n`);

  let migrated = 0;
  let errors = 0;

  for (const { fileName, content } of files) {
    const title = fileName.replace(/\.(md|txt)$/, '');
    process.stdout.write(`📝 ${title}... `);

    try {
      // Upsert по title (уникальный ключ). Повторный запуск обновит content/updated_at.
      // country = DEFAULT_COUNTRY: knowledge_base плоская, весь контент про Вьетнам.
      // TODO: выводить страну из подпапки knowledge_base/<country>/ при мульти-странах.
      const { data: doc, error: upsertError } = await supabase!
        .from('raw_documents')
        .upsert(
          {
            title,
            category: guessCategory(fileName),
            country: DEFAULT_COUNTRY,
            content,
            is_published: true,
          },
          { onConflict: 'title' }
        )
        .select('id, title, content, country')
        .single();

      if (upsertError) throw upsertError;
      if (!doc) throw new Error('upsert вернул пустую строку');

      const chunkCount = await reindexDocument(supabase!, {
        id: doc.id,
        title: doc.title,
        content: doc.content,
        country: doc.country ?? DEFAULT_COUNTRY,
      });

      migrated++;
      console.log(`✅ ${chunkCount} чанков`);
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`❌ ${msg.split('\n')[0]}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n' + '='.repeat(50));
  console.log('📊 Статистика миграции:');
  console.log(`   Документов мигрировано: ${migrated}`);
  console.log(`   Ошибок: ${errors}`);
  console.log(`   Время: ${elapsed}s`);
  console.log('='.repeat(50));

  if (errors > 0) {
    console.warn(`⚠️  Завершено с ${errors} ошибками.`);
    process.exit(1);
  }

  console.log('\n✅ Миграция завершена!');
  console.log('👉 Теперь документы живут в Supabase: Table Editor → raw_documents');
  console.log('👉 После правки документа вызывайте: POST /api/reindex-doc { "docId": <id> }');
  console.log('👉 Папку knowledge_base/ можно удалить (или оставить как backup).');
}

main();
