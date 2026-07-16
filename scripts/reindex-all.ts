/**
 * Полная переиндексация ВСЕХ документов из raw_documents.
 * Запуск: npm run reindex-all
 *
 * Использовать:
 *   - после массового импорта (CSV / много файлов)
 *   - если подозреваете рассинхрон embeddings ↔ контент
 *
   Для повседневных правок быстрее: npm run reindex-changed (только изменённые).
 *
 * Работает локально — без serverless таймаута. Готов к тысячам документов
 * за счёт пагинации по 100 строк.
 */

import 'dotenv/config';
import dotenv from 'dotenv';
import { getSupabase } from '../lib/supabase';
import { reindexDocument } from '../lib/reindex';

dotenv.config({ path: '.env.local' });

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ SUPABASE_URL или SUPABASE_ANON_KEY не заданы в .env.local');
  process.exit(1);
}

const supabase = getSupabase();
if (!supabase) {
  console.error('❌ Не удалось инициализировать Supabase клиент');
  process.exit(1);
}

const PAGE = 100;

async function main(): Promise<void> {
  const startTime = Date.now();
  let processed = 0;
  let chunksTotal = 0;
  let errors = 0;
  let total = 0;

  console.log('🔄 Полная переиндексация всех документов...\n');

  let from = 0;
  while (true) {
    const { data, count, error } = await supabase!
      .from('raw_documents')
      .select('id, title, content', { count: 'exact' })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      console.error('❌ Ошибка чтения raw_documents:', error.message);
      console.error('Выполните supabase/migrate-docs-to-ui.sql в SQL Editor');
      process.exit(1);
    }

    total = count ?? 0;
    if (total === 0) {
      console.warn('⚠️  В raw_documents нет документов. Нечего индексировать.');
      return;
    }

    for (const doc of data ?? []) {
      process.stdout.write(`  [${processed + 1}/${total}] ${doc.title}... `);
      try {
        const chunks = await reindexDocument(supabase!, {
          id: doc.id,
          title: doc.title,
          content: doc.content,
        });
        chunksTotal += chunks;
        processed++;
        console.log(`✅ ${chunks} чанков`);
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`❌ ${msg.split('\n')[0]}`);
      }
    }

    from += PAGE;
    if (from >= total) break;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(50));
  console.log('📊 Полная переиндексация завершена:');
  console.log(`   Документов: ${processed}/${total}`);
  console.log(`   Чанков создано: ${chunksTotal}`);
  console.log(`   Ошибок: ${errors}`);
  console.log(`   Время: ${elapsed}s`);
  console.log('='.repeat(50));

  if (errors > 0) process.exit(1);
}

main();
