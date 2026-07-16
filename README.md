# Travel Planner - Планировщик путешествий с RAG-базой знаний

Это [Next.js](https://nextjs.org) приложение с RAG (Retrieval-Augmented Generation) для генерации планов путешествий.

**Полностью бесплатный стек для Vercel:**
- 🗄️ Supabase (бесплатная БД с pgvector)
- 🤖 Local embeddings через ONNX (@xenova/transformers)
- ⚡ Anthropic через z.ai для генерации планов

## Возможности

- 🤖 Генерация персонализированных планов путешествий (LLM)
- 📊 Пошаговый чек-лист с прогресс-баром
- 🔍 RAG-поиск по базе знаний (документы о путешествиях)
- ⚡ Graceful fallback: работает без базы на общих знаниях модели
- 🛠 Админ-панель `/admin` — управление документами без терминала и Supabase Dashboard
- 🆓 Полностью бесплатно для small apps

## Getting Started

### 1. Установка зависимостей

```bash
npm install
```

### 2. Supabase (бесплатная БД)

**Создайте проект на Supabase (бесплатно):**

1. Зайдите на https://supabase.com/dashboard и нажмите "New Project"
2 - Название: любое (например, "travel-planner")
3 - Пароль: сгенерируйте
4 - Регион: выберите ближайший (например, Southeast Asia)
5 - Ждите ~2 минуты готовности

**Скопируйте credentials:**

```
Dashboard → ваш проект → Settings → API
- Project URL: https://xxx.supabase.co
- anon/public key: скопируйте
```

**Выполните SQL инициализацию (три файла по очереди):**

```
Dashboard → SQL Editor → New Query
1. Вставьте содержимое файла supabase/init-db.sql             → Run
2. Вставьте содержимое файла supabase/migrate-docs-to-ui.sql  → Run
3. Вставьте содержимое файла supabase/add-reindex-tracking.sql → Run
```

1. Создаёт таблицу `documents` + RPC `match_documents` для векторного поиска.
2. Добавляет таблицу `raw_documents` (контент, который вы редактируете в UI) и
   связывает чанки с исходниками через `raw_document_id`.
3. Добавляет колонку `last_indexed_at` + RPC `get_documents_to_reindex` для
   быстрой incremental-переиндексации (нужна при 500+ документах).

**Добавьте в `.env.local`:**

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
ADMIN_PASSWORD=надёжный-пароль-для-админки  # для /admin и API документов
```

### 3. LLM (для генерации планов)

У вас уже есть `ANTHROPIC_API_KEY` в `.env.local` (z.ai). Если нет:

- Получите ключ на https://z.ai (аналог Anthropic API)

### 4. Первый импорт базы знаний в Supabase

Если в `knowledge_base/` уже лежат `.md`/`.txt` — перенесите их в БД одним запуском:

```bash
npm run migrate
```

Скрипт:
- Загрузит модель эмбеддингов (первый раз ~30 секунд)
- Прочитает файлы из `knowledge_base/`
- Запишет каждый в таблицу `raw_documents` (с авто-категорией)
- Разобьёт на чанки, сгенерирует embeddings (локально!) и свяжет с исходником

**Результат:**
```
📊 Статистика миграции:
   Документов мигрировано: 4
   Ошибок: 0
✅ Миграция завершена!
```

После этого **контент живёт в Supabase, а не в проекте** — папку `knowledge_base/`
можно удалить (или оставить как backup). Дальше документы добавляются и правятся
через интерфейс БД (см. раздел «RAG-база знаний» ниже).

### 5. Запуск dev-сервера

```bash
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000).

## Использование

1. Заполните форму: город вылета, пункт назначения, дата, бюджет
2. Нажмите «✨ Сгенерировать план»
3. Получите пошаговый чек-лист с ссылками и стоимостью
4. Отмечайте выполненные шаги — прогресс обновляется

## Deploy на Vercel (бесплатно)

1. Push код в GitHub
2. Импортируйте проект в Vercel
3. Добавьте переменные окружения в Vercel Settings:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   ANTHROPIC_API_KEY=your-zai-key
   ADMIN_PASSWORD=надёжный-пароль-для-админки
   ```
4. Deploy!

## RAG-база знаний

Документы хранятся **в Supabase, а не в проекте**. Сырой текст — в таблице
`raw_documents` (редактируется в браузере), чанки с embeddings — в `documents`.

### 👉 Рекомендуемый путь: админ-панель `/admin`

Самый простой способ управлять документами — встроенная админка (правки контента
+ переиндексация, без терминала и Supabase Dashboard):

1. Откройте `http://localhost:3000/admin` (или `…/admin` на проде)
2. Введите пароль из `ADMIN_PASSWORD`
3. Создавайте / редактируйте / удаляйте документы прямо в браузере
4. После правки контента жмите 🔄 Reindex — embeddings обновятся

В админке видно: категорию, статус (черновик/опубликован), бейдж
«⚠ embeddings устарели» (контент изменён после последней переиндексации),
время правки и индексации. Пароль сохраняется в localStorage.

> Для точечной правки 1–2 документов админка удобнее всего. Для массового
> импорта 500+ документов используйте CSV-импорт + `npm run reindex-all`
> (см. ниже) — у serverless-функции лимит 60с, она не тянет переиндексацию
> тысяч документов по кнопке.

### Альтернатива: Supabase Table Editor / curl

### Добавить / отредактировать документ

1. Откройте **Supabase Dashboard → Table Editor → `raw_documents`**
2. Добавьте строку или поправьте существующую:

   | title | category | content | is_published |
   |-------|----------|---------|--------------|
   | Виза во Вьетнам | visa | Граждане РФ… | true |

   - `category` — для организации (`visa`, `insurance`, `telecom`, `airport`, …)
   - `is_published = false` — черновик: документ не попадает в RAG-поиск, но
     сохраняется в БД (можно быстро «включить» обратно)
3. После правки **перегенерируйте embeddings** — Supabase не умеет звать локальную
   модель сама, поэтому дёргаем API endpoint:

   ```bash
   curl -X POST https://your-app.vercel.app/api/reindex-doc \
     -H "Content-Type: application/json" \
     -H "x-admin-password: ВАШ_ПАРОЛЬ" \
     -d '{"docId": 3}'
   ```

   Ответ: `{ "reindexed": 4, "docId": 3, "title": "..." }`
   (старые чанки документа удаляются, создаются новые — операция идемпотентна).

### Список документов (через API)

```bash
# Все документы (без content, для обзора)
curl -H "x-admin-password: ВАШ_ПАРОЛЬ" https://your-app.vercel.app/api/docs

# По категории
curl -H "x-admin-password: ВАШ_ПАРОЛЬ" "https://your-app.vercel.app/api/docs?category=visa"
```

### Проверка в Supabase SQL Editor

```sql
-- Сколько чанков на каждый документ
SELECT rd.title, COUNT(d.id) AS chunks
FROM raw_documents rd
LEFT JOIN documents d ON d.raw_document_id = rd.id
GROUP BY rd.title
ORDER BY rd.title;
```

### Массовая работа (500+ документов)

При большом объёме переиндексация идёт **локальными скриптами**, а не через
`/api/reindex-doc`: у serverless-функции Vercel лимит 60с — не хватит на тысячи
embeddings. Локально таймаута нет.

**Импорт документов:**
- **CSV** (быстрее всего): Supabase Table Editor → `raw_documents` →
  *Insert → Import data from CSV*. Колонки: `title,category,content,is_published`.
- **Из файлов**: положите `.md`/`.txt` в папку и запустите `npm run migrate`.

**Переиндексация после импорта / правок:**

| Команда | Что делает | Когда использовать |
|---------|-----------|--------------------|
| `npm run reindex-all` | Переиндексирует **все** документы | После массового импорта или при подозрении на рассинхрон |
| `npm run reindex-changed` | Только изменённые (`updated_at > last_indexed_at`) | Повседневно — секунды вместо минут |

Прогресс в консоли: `[127/500] vietnam-visa ✅ 2 чанка`.
Ориентир: ~100ms × ~4 чанка × N документов → 500 документов ≈ 3-4 минуты
локально (модель эмбеддингов грузится один раз за запуск).

> `/api/reindex-doc { docId }` (один документ) — оставлен для точечной правки
> через UI или curl, когда трогаете 1-2 документа.

## Почему Supabase + Local Embeddings?

✅ **Полностью бесплатно**
- Supabase: 500MB БД, 10K запросов/месяц free
- Local embeddings: $0 (работает на вашем сервере)

✅ **Vercel-ready**
- Serverless-совместимый код
- Нет rate limits
- Масштабируется автоматически

✅ **Privacy-first**
- Данные остаются в Supabase (EU/US/Asia)
- Эмбеддинги локальные (не уходят во внешние API)

## Лимиты бесплатного tiers

| Ресурс | Free Tier | Когда upgrade |
|--------|-----------|---------------|
| Supabase БД | 500MB | ~10K документов |
| Supabase запросы | 10K/месяц | ~300 пользователей/день |
| Local embeddings | ∞ | Нет ограничений |

## Troubleshooting

**Ошибка "match_documents function not found":**
- Выполните `supabase/init-db.sql` в Supabase SQL Editor

**Ошибка "relation `raw_documents` does not exist":**
- Выполните `supabase/migrate-docs-to-ui.sql` в Supabase SQL Editor
  (создаёт таблицу `raw_documents` и колонку `raw_document_id`)

**POST /api/reindex-doc возвращает 404:**
- Документ с таким `docId` не существует в `raw_documents`.
- Проверьте список: `GET /api/reindex-doc` — там видны все id.

**`npm run reindex-changed`: "function get_documents_to_reindex does not exist":**
- Выполните `supabase/add-reindex-tracking.sql` в Supabase SQL Editor
  (создаёт колонку `last_indexed_at` и RPC для incremental-режима).

**Медленная загрузка модели:**
- Первый запуск ~30 секунд (загрузка модели)
- Последующие ~50-100ms на embedding

**Ошибка "Cannot find module '@xenova/transformers":**
- Запустите `npm install`

## Learn More

- [Supabase Documentation](https://supabase.com/docs)
- [Transformers.js Documentation](https://huggingface.co/docs/transformers.js)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [z.ai API](https://docs.z.ai)

## License

MIT
