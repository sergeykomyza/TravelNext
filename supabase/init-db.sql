-- Supabase: инициализация таблицы и RPC функции для векторного поиска
-- Выполните этот скрипт в Supabase SQL Editor: https://supabase.com/dashboard

-- 1. Включаем расширение pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Создаём таблицу для документов
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector(384), -- для локальных эмбеддингов (paraphrase-multilingual-MiniLM-L12-v2, 384 dim)
  source_file TEXT,
  country TEXT, -- фильтр поиска по стране (см. match_documents.filter_country)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Векторный индекс для быстрого поиска (HNSW). Включайте при росте объёма
--    (тысячи чанков); для маленькой БД index не обязателен. Полная миграция со
--    страной и индексом — supabase/add-country-and-hnsw.sql.
-- CREATE INDEX IF NOT EXISTS documents_embedding_hnsw_idx ON documents USING hnsw (embedding vector_cosine_ops);

-- 4. Создаём RPC функцию для векторного поиска
-- ВАЖНО: DROP сначала — CREATE OR REPLACE не может изменить тип возврата,
-- а documents.id имеет тип integer (SERIAL), не bigint.
-- Актуальная RPC (с JOIN raw_documents и фильтром is_published) определяется
-- в migrate-docs-to-ui.sql и обновляется в add-country-and-hnsw.sql.
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
    1 - (documents.embedding <=> query_embedding) AS similarity
  FROM documents
  WHERE 1 - (documents.embedding <=> query_embedding) > match_threshold
    AND (filter_country IS NULL OR documents.country = filter_country)
  ORDER BY documents.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 5. Включаем Row Level Security (RLS) - опционально для безопасности
-- ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- 6. Создаём политику для чтения (если включён RLS)
-- CREATE POLICY "Enable read access for all users" ON documents FOR SELECT USING (true);

-- Готово! Теперь можно использовать:
-- npm run index
-- для индексации документов
