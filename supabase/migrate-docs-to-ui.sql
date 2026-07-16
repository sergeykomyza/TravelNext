-- Supabase: миграция на хранение документов в БД (управление через Table Editor)
-- Выполните этот скрипт в Supabase SQL Editor поверх уже созданной init-db.sql.
-- Скрипт идемпотентен — безопасно запускать повторно.
--
-- Цель: сырой текст документов живёт в таблице raw_documents (редактируется в UI),
-- а documents хранит только чанки с embeddings и ссылку raw_document_id.

-- 1. Таблица исходных документов (контент, который вы редактируете в браузере)
CREATE TABLE IF NOT EXISTS raw_documents (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL UNIQUE,        -- уникальный заголовок = ключ для upsert при миграции
  category TEXT NOT NULL DEFAULT 'general', -- visa, insurance, telecom, airport, ...
  content TEXT NOT NULL,             -- полный текст документа
  is_published BOOLEAN NOT NULL DEFAULT true, -- false → не попадает в RAG-поиск (draft)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Автообновление updated_at при правке строки (Table Editor показывает актуальное время)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS raw_documents_updated_at ON raw_documents;
CREATE TRIGGER raw_documents_updated_at
  BEFORE UPDATE ON raw_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. Связь чанков с исходным документом (NULL для старых чанков без источника)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS raw_document_id INTEGER REFERENCES raw_documents(id) ON DELETE CASCADE;

-- Индекс для быстрого удаления/поиска чанков одного документа (reindex, unpublish)
CREATE INDEX IF NOT EXISTS documents_raw_document_id_idx ON documents(raw_document_id);

-- 4. Обновлённая RPC функция: фильтрует неопубликованные (draft) документы через JOIN.
--    DROP сначала — CREATE OR REPLACE не может изменить тело с новым JOIN/сигнатуру безопасно.
DROP FUNCTION IF EXISTS match_documents(vector(384), float, int);

CREATE FUNCTION match_documents(
  query_embedding vector(384),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 5
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
    -- Чанк виден в поиске, если у него нет источника (старые данные) ИЛИ источник опубликован
    AND (documents.raw_document_id IS NULL OR raw_documents.is_published = true)
  ORDER BY documents.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Готово! Дальше:
--   1) npm run migrate  — перенесёт .md/.txt из knowledge_base/ в raw_documents + переиндексирует
--   2) Управляйте контентом: Supabase Dashboard → Table Editor → raw_documents
--   3) После правки документа вызовите POST /api/reindex-doc { "docId": <id> }
