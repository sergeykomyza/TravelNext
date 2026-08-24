-- Supabase: чинит потерю country при переиндексации.
-- Выполните в Supabase SQL Editor (поверх add-country-and-hnsw.sql).
-- Идемпотентен — безопасно запускать повторно.
--
-- Проблема: переиндексация через POST /api/reindex-doc и скрипты
-- reindex-all / reindex-changed перезаписывала чанки с country = NULL
-- (в SELECT не было колонки country), из-за чего RAG-фильтр
-- match_documents.filter_country = 'Вьетнам' переставал находить документы
-- и генерация плана падала в fallback на общие знания (галлюцинации про e-visa).
--
-- Что делает:
--   1) RPC get_documents_to_reindex теперь возвращает country.
--   2) Бэкфилл: чанкам без страны проставляем страну их raw-документа
--      (по raw_document_id; для легаси-чанков без связи — не трогаем,
--      их всё равно не видно при фильтре по стране).

-- 1. RPC с country в выдаче (CREATE OR REPLACE меняет тело, сигнатура расширяется
--    через DROP + CREATE, как в add-country-and-hnsw.sql для match_documents).
DROP FUNCTION IF EXISTS get_documents_to_reindex(int, int);
DROP FUNCTION IF EXISTS get_documents_to_reindex(int, int, int); -- на случай чужих сигнатур

CREATE FUNCTION get_documents_to_reindex(
  p_limit int DEFAULT 1000,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id integer,
  title text,
  content text,
  country text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT raw_documents.id, raw_documents.title, raw_documents.content, raw_documents.country
  FROM raw_documents
  WHERE raw_documents.last_indexed_at IS NULL
     OR raw_documents.updated_at > raw_documents.last_indexed_at
  ORDER BY raw_documents.id
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- 2. Бэкфилл страны у существующих чанков.
UPDATE documents d
  SET country = rd.country
  FROM raw_documents rd
  WHERE d.raw_document_id = rd.id
    AND d.country IS NULL
    AND rd.country IS NOT NULL;
