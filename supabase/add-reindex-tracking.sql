-- Supabase: tracking для incremental переиндексации
-- Выполните в Supabase SQL Editor (поверх init-db.sql и migrate-docs-to-ui.sql).
-- Идемпотентен — безопасно запускать повторно.
--
-- Цель: знать, какие документы изменились с последней переиндексации,
-- чтобы npm run reindex-changed пересчитывал embeddings только для них,
-- а не для всех 500+ документов.

-- 1. Метка последней переиндексации документа.
--    NULL = ещё ни разу не индексировался (новый/импортированный) → попадает в changed.
ALTER TABLE raw_documents ADD COLUMN IF NOT EXISTS last_indexed_at TIMESTAMPTZ;

-- 2. RPC: возвращает документы, требующие переиндексации.
--    PostgREST не умеет сравнивать две колонки (updated_at > last_indexed_at),
--    поэтому сравнение делаем на стороне Postgres, а клиенту отдаём уже отфильтрованный список.
--    p_limit/p_offset — для пагинации, чтобы reindex-changed работал и на тысячах документов.
CREATE OR REPLACE FUNCTION get_documents_to_reindex(
  p_limit int DEFAULT 1000,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id integer,
  title text,
  content text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT raw_documents.id, raw_documents.title, raw_documents.content
  FROM raw_documents
  WHERE raw_documents.last_indexed_at IS NULL
     OR raw_documents.updated_at > raw_documents.last_indexed_at
  ORDER BY raw_documents.id
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- Готово! Теперь доступны:
--   npm run reindex-all      — пересчитать ВСЕ документы
--   npm run reindex-changed  — только изменённые (быстро для повседневной работы)
