/**
 * Incremental переиндексация: только документы, чей контент менялся
 * с последней переиндексации (updated_at > last_indexed_at), плюс новые
 * (last_indexed_at IS NULL).
 * Запуск: npm run reindex-changed
 *
   Это режим для повседневной работы: правите 3 документа из 500 →
   переиндексация занимает секунды, а не минуты.
 *
   Кого индексировать — определяет Postgres (RPC get_documents_to_reindex),
 * потому что PostgREST не умеет сравнивать две колонки в WHERE.
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

const PAGE = 1000;

async function main(): Promise<void> {
  const startTime = Date.now();
  const changed: { id: number; title: string; content: string }[] = [];
  let offset = 0;

  // Выгружаем страницы изменённых документов.
  while (true) {
    const { data, error } = await supabase!.rpc('get_documents_to_reindex', {
      p_limit: PAGE,
      p_offset: offset,
    });

    if (error) {
      console.error('❌ Ошибка RPC get_documents_to_reindex:', error.message);
      console.error('Выполните supabase/add-reindex-tracking.sql в SQL Editor');
      process.exit(1);
    }

    if (!data || data.length === 0) break;
    changed.push(...data);
    if (data.length < PAGE) break; // последняя страница
    offset += PAGE;
  }

  if (changed.length === 0) {
    console.log('✅ Все документы актуальны — переиндексация не требуется.');
    console.log('   (изменяйте content в Supabase Table Editor, и они появятся здесь)');
    return;
  }

  console.log(`🔄 Найдено изменённых документов: ${changed.length}\n`);

  let processed = 0;
  let chunksTotal = 0;
  let errors = 0;

  for (const doc of changed) {
    process.stdout.write(`  ${doc.title}... `);
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

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(50));
  console.log('📊 Incremental переиндексация завершена:');
  console.log(`   Обновлено документов: ${processed}/${changed.length}`);
  console.log(`   Чанков создано: ${chunksTotal}`);
  console.log(`   Ошибок: ${errors}`);
  console.log(`   Время: ${elapsed}s`);
  console.log('='.repeat(50));

  if (errors > 0) process.exit(1);
}

main();
