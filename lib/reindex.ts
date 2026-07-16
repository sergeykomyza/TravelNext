/**
 * Общая логика чанкинга и переиндексации документов.
 * Используется и скриптом миграции (scripts/migrate-to-db.ts),
 * и API endpoint-ом (app/api/reindex-doc/route.ts) — DRY, единственный источник правды.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getEmbedding } from './embeddings';

/** Размер чанка в символах — подбирается под контекст модели и язык (русский токеноёмкий). */
export const CHUNK_SIZE = 1000;
/** Перекрытие чанков в символах — чтобы факт на границе не терялся при поиске. */
export const CHUNK_OVERLAP = 200;

/**
 * Разбивает текст на чанки с перекрытием по параграфам.
 * Перенесено из scripts/index-knowledge.ts без изменений логики.
 */
export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    if (currentChunk && currentChunk.length + trimmed.length > CHUNK_SIZE) {
      chunks.push(currentChunk.trim());

      // Начинаем новый чанк с перекрытием (берём конец предыдущего по словам)
      const words = currentChunk.split(' ');
      let overlapSize = 0;
      let overlapText = '';
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

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

export interface RawDocument {
  id: number;
  title: string;
  content: string;
}

/**
 * Переиндексация одного документа: удаляет старые чанки и создаёт новые embeddings.
 * Идемпотентна — безопасно вызывать после любой правки raw_documents.content.
 *
 * @returns количество созданных чанков
 */
export async function reindexDocument(
  supabase: SupabaseClient,
  doc: RawDocument
): Promise<number> {
  // 1. Удаляем старые чанки этого документа (каскадно по FK не сработает —
  //    документ не удаляется, только обновляется; чистим чанки вручную).
  const { error: delError } = await supabase
    .from('documents')
    .delete()
    .eq('raw_document_id', doc.id);
  if (delError) throw delError;

  // 2. Чанкуем и для каждого чанка генерируем embedding + вставляем строку.
  const chunks = chunkText(doc.content);
  for (const chunk of chunks) {
    const embedding = await getEmbedding(chunk);
    const { error: insertError } = await supabase.from('documents').insert({
      content: chunk,
      embedding: JSON.stringify(embedding),
      source_file: doc.title, // сохраняем для совместимости со старой логикой сборки в generate-plan
      raw_document_id: doc.id,
    });
    if (insertError) throw insertError;
  }

  // 3. Отмечаем, что документ переиндексирован — чтобы reindex-changed
  //    (по updated_at > last_indexed_at) больше его не трогал, пока контент не изменится.
  //    Любой путь (migrate / reindex-all / reindex-changed / POST /api/reindex-doc)
  //    проходит через эту функцию → метка обновляется везде одинаково (DRY).
  const { error: tsError } = await supabase
    .from('raw_documents')
    .update({ last_indexed_at: new Date().toISOString() })
    .eq('id', doc.id);
  if (tsError) throw tsError;

  return chunks.length;
}
