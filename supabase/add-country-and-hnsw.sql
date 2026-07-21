-- Supabase: страна как сущность + HNSW-индекс для масштабирования (12+ стран, тысячи документов)
-- Выполните в Supabase SQL Editor (поверх init-db.sql → migrate-docs-to-ui.sql → add-reindex-tracking.sql).
-- Идемпотентен — безопасно запускать повторно.
--
-- Цель:
--   1) Фильтр векторного поиска по стране — чтобы чанки других стран не попадали
--      в план (иначе виза Таиланда подтягивается в план по Вьетнаму).
--   2) HNSW-индекс вместо отсутствующего (раньше brute-force KNN по всем чанкам).
--   3) btree на country — ускоряет предикат фильтра.

-- 1. Колонка страны в исходных документах и в чанках.
--    TEXT по образцу category; валидация значений — на стороне кода (COUNTRIES).
ALTER TABLE raw_documents ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS country TEXT;

-- 2. Бэкфилл: весь существующий контент — про Вьетнам.
--    Чанкам проставляем страну их исходного документа (где есть связь).
UPDATE raw_documents SET country = 'Вьетнам' WHERE country IS NULL;
UPDATE documents d
  SET country = rd.country
  FROM raw_documents rd
  WHERE d.raw_document_id = rd.id
    AND d.country IS NULL;
-- Старьё без raw_document_id — тоже Вьетнам (легаси-чанки до UI-миграции).
UPDATE documents SET country = 'Вьетнам' WHERE country IS NULL;

-- 3. Векторный индекс: HNSW (пригоден для cosine, строится в любой момент, авто-наполняется).
--    Заменяет отсутствовавший IVFFlat. Подбирается под тысячи чанков без заметной деградации.
CREATE INDEX IF NOT EXISTS documents_embedding_hnsw_idx
  ON documents USING hnsw (embedding vector_cosine_ops);

-- 4. btree на country — чтобы WHERE country = $ отрабатывал до векторной сортировки.
CREATE INDEX IF NOT EXISTS documents_country_idx ON documents (country);

-- 5. RPC с новым опциональным параметром filter_country.
--    DROP обе прошлые сигнатуры (vector,float,int) и гипотетическую (vector,float,int,text):
--    CREATE OR REPLACE не меняет сигнатуру, поэтому пересоздаём через DROP+CREATE.
--    ВАЖНО: сохранён JOIN с raw_documents и фильтр is_published из migrate-docs-to-ui.sql —
--    иначе draft-документы попадут в выдачу RAG.
DROP FUNCTION IF EXISTS match_documents(vector(384), float, int);
DROP FUNCTION IF EXISTS match_documents(vector(384), float, int, text);

CREATE FUNCTION match_documents(
  query_embedding vector(384),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 5,
  filter_country text DEFAULT NULL
)
RETURNS TABLE (
  id integer,
  content text,
  source_file text,
  raw_document_id integer,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    documents.id,
    documents.content,
    documents.source_file,
    documents.raw_document_id,
    1 - (documents.embedding <=> query_embedding) AS similarity
  FROM documents
  LEFT JOIN raw_documents ON raw_documents.id = documents.raw_document_id
  WHERE 1 - (documents.embedding <=> query_embedding) > match_threshold
    -- Чанк виден, если у него нет источника (старые данные) ИЛИ источник опубликован.
    AND (documents.raw_document_id IS NULL OR raw_documents.is_published = true)
    -- Фильтр по стране: NULL = без фильтра (обратная совместимость со старыми вызовами).
    AND (filter_country IS NULL OR documents.country = filter_country)
  ORDER BY documents.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Готово! Теперь:
--   - /api/generate-plan передаёт destination как filter_country.
--   - Чужие страны больше не загрязняют контекст.
--   - Векторный поиск идёт по HNSW, а не полным сканированием.
