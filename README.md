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

**Выполните SQL инициализацию:**

```
Dashboard → SQL Editor → New Query
Вставьте содержимое файла supabase/init-db.sql
Нажмите "Run"
```

**Добавьте в `.env.local`:**

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

### 3. LLM (для генерации планов)

У вас уже есть `ANTHROPIC_API_KEY` в `.env.local` (z.ai). Если нет:

- Получите ключ на https://z.ai (аналог Anthropic API)

### 4. Индексация базы знаний

```bash
npm run index
```

Этот скрипт:
- Загрузит модель эмбеддингов (первый раз ~30 секунд)
- Прочитает файлы из `knowledge_base/`
- Разобьёт на чанки, сгенерирует embeddings (локально!)
- Загрузит в Supabase

**Результат:**
```
📊 Статистика индексации:
   Файлов обработано: 4
   Чанков проиндексировано: 15
   Ошибок: 0
✅ Индексация успешно завершена!
```

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
   ```
4. Deploy!

## RAG-база знаний

### Структура knowledge_base/

Положите `.md` или `.txt` файлы в папку `knowledge_base/`. Примеры:
- `vietnam-visa.md` - виза во Вьетнам
- `travel-insurance.md` - медстраховка
- `mobile-internet-sim.md` - SIM/eSIM
- `airport-and-transfer.md` - аэропорт, таможня

### Переиндексация

После добавления новых файлов:

```bash
npm run index
```

### Проверка в Supabase Table Editor

```sql
SELECT source_file, COUNT(*) as chunks
FROM documents
GROUP BY source_file;
```

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
