-- Supabase: исправление триггера updated_at для работы с last_indexed_at
-- Выполните в Supabase SQL Editor.
-- Проблема: при обновлении last_indexed_at триггер также обновлял updated_at,
-- что приводило к тому, что переиндексированные документы помечались как "устаревшие".
--
-- Решение: триггер обновляет updated_at только при изменении контента,
-- а не при обновлении служебного поля last_indexed_at.

-- Удаляем старый триггер
DROP TRIGGER IF EXISTS raw_documents_updated_at ON raw_documents;

-- Создаём улучшенный триггер, который проверяет, изменились ли реальные данные
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Обновляем updated_at только если изменились реальные данные контента,
  -- а не служебные поля (last_indexed_at и т.д.)
  IF
    (OLD.title IS DISTINCT FROM NEW.title) OR
    (OLD.content IS DISTINCT FROM NEW.content) OR
    (OLD.category IS DISTINCT FROM NEW.category) OR
    (OLD.country IS DISTINCT FROM NEW.country) OR
    (OLD.is_published IS DISTINCT FROM NEW.is_published)
  THEN
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Создаём триггер заново
CREATE TRIGGER raw_documents_updated_at
  BEFORE UPDATE ON raw_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Готово! Теперь при переиндексации (обновлении last_indexed_at)
-- поле updated_at не будет изменяться, и метка "устаревшие" исчезнет корректно.
