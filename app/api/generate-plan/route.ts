import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabase } from '@/lib/supabase';
import { planCacheKey, getCachedPlan, setCachedPlan } from '@/lib/plan-cache';
import { rateLimit } from '@/lib/rate-limit';

// Vercel serverless: холодный старт (@xenova/transformers + Anthropic) требует
// запаса по времени, иначе первый запрос упирается в дефолтный таймаут функции.
export const maxDuration = 60;

/** Потолок размера RAG-контекста (символы) — защита от раздувания промпта. */
const MAX_CONTEXT_CHARS = 30_000;
/** Максимум документов в контексте (после раскрытия чанков до полных файлов). */
const MAX_DOCS = 5;
/** Лимит генераций плана на IP в окне (защита публичного эндпоинта от abuse). */
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 час

/**
 * Экранирует сырые управляющие символы (U+0000–U+001F) ВНУТРИ строковых литералов
 * JSON, не трогая структурные переносы/отступы между токенами.
 *
 * Зачем: модель иногда вставляет буквальный \n / \t / прочий control char прямо
 * внутрь значения (description, action). JSON.parse это отвергает:
 * "Bad control character in string literal". Заменяем такие символы на валидные
 * escape-последовательности (\n, \r, \t или \u00XX), проходя по строке с учётом
 * границ "..." и уже экранированных символов.
 */
function escapeControlCharsInJsonStrings(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaped) {
      // Текущий символ — часть escape-последовательности (напр. 'n' в "\n").
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString) {
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += code === 0x0a ? '\\n' : code === 0x0d ? '\\r' : code === 0x09 ? '\\t' : `\\u${code.toString(16).padStart(4, '0')}`;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.z.ai/api/anthropic',
});

/**
 * Выполняет RAG-поиск релевантных документов через Supabase
 * @returns {context, usedRag} - контекст из БД или пустая строка + флаг успеха
 */
async function retrieveContext(
  query: string,
  country: string | null
): Promise<{ context: string; usedRag: boolean; ragReason: string }> {
  const supabase = getSupabase();

  // Если Supabase не подключена - работаем без RAG
  if (!supabase) {
    console.warn('RAG: Supabase не подключена, работаем без базы знаний');
    return { context: '', usedRag: false, ragReason: 'no_supabase_env' };
  }

  try {
    // Динамический импорт изолирует тяжёлый ONNX-модуль (@xenova/transformers):
    // он подгружается только когда RAG реально нужен. Статический import тянул бы
    // onnxruntime-node на старте маршрута — в serverless нативные .so не bundled,
    // модуль падал и валил весь маршрут (HTML 500). Здесь любая ошибка загрузки
    // ловится нижним catch → graceful fallback на общие знания модели.
    const { getEmbedding } = await import('@/lib/embeddings');
    // Генерируем embedding для поискового запроса
    const queryEmbedding = await getEmbedding(query);
    const vectorString = JSON.stringify(queryEmbedding);

    // Ищем релевантные фрагменты через RPC функцию (создаётся в init-db.sql)
    // threshold 0.4 подобран под paraphrase-multilingual-MiniLM-L12-v2 на русском:
    // релевантные чанки идут на 0.45+, нецелевые запросы — ниже 0.4 (→ fallback).
    const { data: rows, error } = await supabase.rpc('match_documents', {
      query_embedding: vectorString,
      match_threshold: 0.4,
      match_count: 5,
      filter_country: country ?? null,
    });

    if (error) {
      // Если RPC функция не существует, fallback на обычный поиск
      if (error.message.includes('function') || error.code === '42883') {
        console.warn('RAG: RPC функция match_documents не найдена. Выполните миграции supabase/ (init-db.sql → migrate-docs-to-ui.sql → add-reindex-tracking.sql → add-country-and-hnsw.sql)');
        return { context: '', usedRag: false, ragReason: 'no_match_documents_rpc' };
      }
      throw error;
    }

    if (!rows || rows.length === 0) {
      console.warn(`RAG: релевантные документы не найдены${country ? ` для страны «${country}»` : ''}`);
      return { context: '', usedRag: false, ragReason: 'no_matching_docs' };
    }

    // Расширяем до полных документов: если хоть один чанк файла совпал с
    // запросом, подтягиваем ВЕСЬ файл целиком. Иначе фиксированное разбиение
    // может вернуть лишь часть документа (например, кусок про e-visa, но не
    // про безвиз 45 дней) — и модель получит искажённую картину.
    const matchedFiles = [...new Set(rows.map((r: { source_file: string }) => r.source_file))];

    // Лучший (макс.) similarity на файл — чтобы ранжировать документы по релевантности.
    const bestSimByFile = new Map<string, number>();
    for (const r of rows as { source_file: string; similarity: number }[]) {
      const cur = bestSimByFile.get(r.source_file) ?? -Infinity;
      if (r.similarity > cur) bestSimByFile.set(r.source_file, r.similarity);
    }

    // Тянем все чанки совпавших файлов. Фильтр по стране дублируем на всякий
    // случай — защита от гипотетической рассинхронизации country между чанками.
    let fullQuery = supabase
      .from('documents')
      .select('source_file, content')
      .in('source_file', matchedFiles);
    if (country) fullQuery = fullQuery.eq('country', country);
    const { data: fullRows, error: docError } = await fullQuery.order('id', { ascending: true });

    if (docError) throw docError;

    // Собираем чанки обратно в целые документы (по source_file, в порядке id)
    const docsByFile = new Map<string, string>();
    for (const row of fullRows ?? []) {
      const prev = docsByFile.get(row.source_file) ?? '';
      docsByFile.set(row.source_file, prev + (prev ? '\n' : '') + row.content);
    }

    // Ранжируем документы по лучшей схожести и ограничиваем контекст:
    // не более MAX_DOCS документов и MAX_CONTEXT_CHARS суммарно. Иначе крупные
    // статьи раздуют промпт → перерасход токенов или переполнение окна модели.
    const ranked = [...docsByFile.entries()].sort(
      (a, b) => (bestSimByFile.get(b[0]) ?? 0) - (bestSimByFile.get(a[0]) ?? 0)
    );

    const parts: string[] = [];
    let totalChars = 0;
    let usedDocs = 0;
    for (const [file, content] of ranked) {
      if (usedDocs >= MAX_DOCS) break;
      let text = content;
      if (totalChars + text.length > MAX_CONTEXT_CHARS) {
        // Обрезаем последний документ по границе абзаца, не превышая лимит.
        const remaining = MAX_CONTEXT_CHARS - totalChars;
        const slice = text.slice(0, Math.max(0, remaining));
        const lastPara = slice.lastIndexOf('\n\n');
        text = (lastPara > remaining * 0.5 ? slice.slice(0, lastPara) : slice).trimEnd() + '\n…[обрезано]';
      }
      parts.push(`[${usedDocs + 1}] (${file})\n${text}`);
      totalChars += text.length;
      usedDocs++;
      if (totalChars >= MAX_CONTEXT_CHARS) break;
    }

    const context = parts.join('\n\n---\n\n');
    console.log(
      `RAG: совпало ${rows.length} чанков, в контексте ${usedDocs} док. (${totalChars} симв.)` +
        (country ? `, страна=${country}` : ''),
      matchedFiles
    );
    return { context, usedRag: true, ragReason: 'ok' };
  } catch (error) {
    const reason = error instanceof Error
      ? error.message.split('\n')[0].slice(0, 200)
      : String(error).slice(0, 200);
    console.warn('RAG: ошибка при поиске, fallback на общие знания:', error);
    return { context: '', usedRag: false, ragReason: `embeddings_error: ${reason}` };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { departureCity, destination, startDate, endDate, budget } = body;

    if (!departureCity || !startDate || !budget) {
      return NextResponse.json(
        { error: 'Missing required fields: departureCity, startDate, budget' },
        { status: 400 }
      );
    }

    // Явная проверка ключа — без неё SDK вернёт непонятную ошибку 401.
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        {
          error: 'Не задан ANTHROPIC_API_KEY',
          details:
            'Добавьте переменные окружения в настройках деплоя (Vercel → Settings → Environment Variables). Нужны все 5: ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL, SUPABASE_URL, SUPABASE_ANON_KEY.',
        },
        { status: 500 }
      );
    }

    // Response-cache: повторный идентичный запрос отдаём без LLM-вызова.
    // Hits бесплатны (не дёргают провайдера), поэтому проверяем до rate-limit.
    // Кэш per-instance (serverless) — подробности в lib/plan-cache.ts.
    const cacheKey = planCacheKey({
      departureCity,
      destination: destination ?? '',
      startDate,
      endDate: endDate ?? '',
      budget,
    });
    const cached = getCachedPlan(cacheKey);
    if (cached) {
      console.log('💾 План отдан из кэша (без LLM-вызова)');
      return NextResponse.json({ ...(cached as Record<string, unknown>), _cached: true });
    }

    // Rate-limit по IP: защита публичного эндпоинта от abuse. Считаем только
    // промахи мимо кэша (hits выше бесплатны). In-memory → per-instance.
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rl = rateLimit(ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: 'Слишком много запросов',
          details: `Лимит ${RATE_LIMIT_MAX} планов в час с одного IP. Повторите через ${rl.retryAfter} сек.`,
        },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      );
    }

    // Форматируем даты для отображения (YYYY-MM-DD) и считаем длительность поездки
    const startDateObj = startDate ? new Date(startDate) : new Date();
    const formattedStartDate = startDateObj.toISOString().split('T')[0];
    let formattedEndDate = '';
    let tripDays = 0;
    if (endDate) {
      const endDateObj = new Date(endDate);
      formattedEndDate = endDateObj.toISOString().split('T')[0];
      const diffMs = endDateObj.getTime() - startDateObj.getTime();
      if (diffMs >= 0) {
        tripDays = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
      }
    }

    // Период поездки одной строкой — для поискового запроса и промпта
    const periodText = formattedEndDate
      ? `с ${formattedStartDate} по ${formattedEndDate}${tripDays ? ` (${tripDays} дн.)` : ''}`
      : `от ${formattedStartDate}`;

    // Формируем поисковый запрос для RAG
    const searchQuery = `Путешествие в ${destination || 'Вьетнам'}, вылет из ${departureCity}, период ${periodText}, бюджет ${budget}$. Темы: виза, страховка, билеты, отель, трансфер, связь, вещи, аэропорт.`;

    // Выполняем RAG-поиск релевантных документов (destination = страна для фильтра)
    const { context, usedRag, ragReason } = await retrieveContext(searchQuery, destination || null);

    // Базовый промпт (общие знания)
    let ragContext = '';
    if (usedRag && context) {
      ragContext = `
# База знаний путешествий

⚠️ КРИТИЧЕСКИ ВАЖНО: Ты обязан использовать ТОЛЬКО информацию из базы знаний ниже.

СТРОГИЕ ПРАВИЛА:
1. Используй только факты, которые ЕСТЬ в базе знаний выше
2. НЕ выдумывай информацию, которой нет в базе — лучше пропустить шаг, чем добавить выдуманные данные
3. Если в базе нет информации по какой-то теме (например, про плату за выезд/биометрию), НЕ добавляй её от себя
4. НЕ используй свои общие знания из обучающих данных — только база
5. Если база не содержит информацию для конкретного шага, либо опусти этот шаг, либо укажи явно: "Информации нет в базе знаний"

${context}

---
`;
    } else {
      // Если RAG не сработал - предупредить пользователя
      console.warn('⚠️ RAG не сработал, используем общие знания модели (возможны галлюцинации)');
    }

    const prompt = `Сгенерируй пошаговый план путешествия в ${destination || 'Вьетнам'}${tripDays ? ` на ${tripDays} дней` : ''} с бюджетом ${budget}$. Вылет из ${departureCity}.

${ragContext}
${!usedRag ? '⚠️ ВНИМАНИЕ: База знаний недоступна. Возможны неточности. Проверяйте всю информацию.' : ''}

- Маршрут: ${departureCity} → ${destination || 'Вьетнам'}
- Период поездки: ${periodText}

Сгенерируй пошаговый план для путешественника-новичка, у которого нет опыта за границей. Разбей план на конкретные, выполнимые шаги (виза, билеты, страховка, отель, трансфер, связь, вещи, аэропорт). Каждый шаг должен содержать четкие действия и ссылки.

⚠️ КРИТИЧЕСКИ ВАЖНО - МАКСИМАЛЬНАЯ ДЕТАЛИЗАЦИЯ:
- Используй ВСЕ полезные детали из базы знаний — не сокращай информацию!
- В поле description давай МАКСИМАЛЬНО развернутые ответы (5-10 предложений), а не 1-2 фразы
- Включай ВСЕ важные нюансы: предостережения, советы, требования, цену, сроки
- Каждый важный факт из базы должен быть отражен в ответе
- НЕ выдумывай данные, которых нет в базе знаний
- Если информации по теме нет — лучше пропусти шаг или напиши "Проверьте актуальность информации на официальных ресурсах"
- НЕ добавляй детали из своих "общих знаний" (например,платы за выезд, биометрию и т.д.) — только если они ЕСТЬ в базе

ПРИМЕРЫ КАК ДОЛЖЕН ВЫГЛЯДЕТЬ ДЕТАЛЬНЫЙ ШАГ:

{
  "title": "Медицинская страховка",
  "description": "Медицинская страховка для въезда во Вьетнам не является обязательной, но настоятельно рекомендуется. Она поможет избежать непредвиденных расходов на лечение и получить качественную медицинскую помощь. Без страховки даже небольшое обращение к врачу может стоить $50-100. Оформить полис можно онлайн за несколько минут — после оплаты он придет на email. Сохраните полис на телефоне и распечатайте.",
  "actions": [
    "Оформите медицинскую страховку онлайн с покрытием от $30,000",
    "Сохраните файл полиса на телефон и распечатайте",
    "Запишите номер ассистанса для связи при необходимости"
  ]
}

⚠️ ВАЖНО ПО ФОРМАТУ - МАКСИМАЛЬНАЯ ДЕТАЛИЗАЦИЯ:
- description: 5-10 предложений с МАКСИМАЛЬНО подробной информацией из базы
- actions: 6-12 конкретных действий, каждое действие должно быть детальным
- Включай ВСЕ важные нюансы: предостережения, советы, требования, цены, сроки
- Не экономь токены — лучше дать больше полезной информации, чем меньше

ПРИМЕР МАКСИМАЛЬНО ДЕТАЛЬНОГО ШАГА (делай так же):

{
  "title": "Медицинская страховка",
  "description": "Медицинская страховка для въезда во Вьетнам не является обязательной, но настоятельно рекомендуется. Она поможет избежать непредвиденных расходов на лечение и получить качественную медицинскую помощь. Без страховки даже небольшое обращение к врачу может стоить $50-100, а стационарное лечение — тысячи долларов. Оформить полис можно онлайн за несколько минут — после оплаты он придет на email. Сохраните полис на телефоне и распечатайте. ⚠️ ВАЖНО: При обращении в клинику ВСЕГДА сначала связывайтесь с ассистансом по телефону из полиса — иначе страховая может отказать в возмещении расходов. Сообщите оператору номер полиса, местоположение и проблему, следуйте инструкциям. Для въезда обязательные прививки не требуются, но в сельской местности риск малярии выше — поэтому особенно важно иметь действующую страховку.",
  "actions": [
    "Оформите медицинскую страховку онлайн с покрытием от $30,000 на весь период поездки",
    "Сохраните файл полиса на телефон и обязательно распечатайте копию",
    "Запишите номер ассистенса для экстренной связи в заметки телефона",
    "При необходимости обращения к врачу — СНАЧАЛА звоните в ассистанс, а не сразу в клинику",
    "Следуйте инструкциям ассистенса по выбору клиники для возмещения расходов",
    "Не пейте кипяченую воду из-под крана — используйте только бутилированную",
    "Пользуйтесь солнцезащитным кремом SPF 30+ для защиты от солнца",
    "Избегайте длительного пребывания на солнце в пиковой период (11:00-15:00)",
    "При поездках в сельскую местность учитывайте повышенный риск малярии и тропических лихорадок"
  ]
}

ОБЯЗАТЕЛЬНО верни ответ в формате JSON БЕЗ каких-либо дополнительных текстов, markdown-оберток или пояснений. Только чистый JSON:
{
  "title": "Название маршрута",
  "totalBudget": 2000,
  "steps": [
    {
      "id": "уникальный_идентификатор",
      "title": "Название шага",
      "description": "МАКСИМАЛЬНО подробное описание из базы знаний (5-10 предложений со всеми деталями)",
      "actions": ["конкретное действие 1", "конкретное действие 2", "действие 3", "действие 4", "действие 5", "действие 6", "действие 7", "действие 8"],
      "links": [{ "text": "Текст ссылки", "url": "https://..." }],
      "cost": 100,
      "isCompleted": false
    }
  ],
  "tips": ["Совет 1", "Совет 2", "Совет 3", "Совет 4"]
}

ВАЖНО:
1. Генерируй только JSON без markdown кода
2. id должен быть уникальным для каждого шага (используй английские буквы и цифры, например step_1_visa)
3. Добавляй реальные ссылки на полезные ресурсы
4. Разбивай всё на конкретные действия, понятные новичку
5. Включай шаги: виза, билеты, страховка, отель, трансфер, связь, вещи, аэропорт
6. Если ссылок нет, передавай пустой массив links: []
7. actions должен содержать МНОГО конкретных действий (6-12 штук) с максимальными деталями
8. tips должен содержать 4-8 полезных советов из базы знаний
9. Не экономь токены — давай максимально подробную информацию из базы

⚠️ ДЛЯ ШАГА "АВИАБИЛЕТЫ" - ИСПОЛЬЗУЙ БАЗУ ЗНАНИЙ:
Информацию по авиабилетам бери ТОЛЬКО из базы знаний (если она там есть).
НЕ выдумывай точные цены — если цены нет в базе, напиши "проверьте актуальные цены на агрегаторах".
`;

    const response = await anthropic.messages.create({
      // z.ai обслуживает GLM-модели, не Claude. Валидные id: glm-5.2, glm-4.7,
      // glm-4.6, glm-4.5, glm-4.5-air (см. https://docs.z.ai). claude-* → 400 "Unknown Model".
      model: process.env.ANTHROPIC_MODEL || 'glm-4.6',
      // Подробный план (8+ шагов с МАКСИМАЛЬНО детальными actions/links) на русском токеноёмок;
      // Увеличили до 8000 для максимально подробных ответов с большим количеством действий
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Anthropic Messages API возвращает content как массив блоков
    const textBlock = response.content.find((block) => block.type === 'text');
    const content = textBlock && 'text' in textBlock ? textBlock.text : '';

    // Логируем сырой ответ для отладки (stop_reason покажет truncation по max_tokens)
    console.log('📝 Сырой ответ от модели (stop_reason=%s, первые 500 символов):', response.stop_reason);
    console.log(content.slice(0, 500));

    // Попытка распарсить JSON из ответа. parseOk — кэшируем только успешный
    // ответ, иначе в кэш на час ляжет fallback «неожиданный формат ответа».
    let jsonContent;
    let parseOk = false;
    try {
      // Убираем markdown-обёртку (```json ... ```), если модель её добавила —
      // причём толерантно к пробелам/регистру (старая регулярка требовала \n сразу после json).
      let cleaned = content.trim();
      const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenceMatch) cleaned = fenceMatch[1].trim();
      // Берём подстроку от первой { до последней } — отсекает лишний текст вокруг.
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }
      // Модель иногда вставляет буквальные управляющие символы внутрь строковых
      // значений — экранируем их (иначе JSON.parse падает с "Bad control character").
      cleaned = escapeControlCharsInJsonStrings(cleaned);
      jsonContent = JSON.parse(cleaned);
      // Гарантируем массивы для UI — иначе .map падает при рендере
      if (!Array.isArray(jsonContent.steps)) jsonContent.steps = [];
      jsonContent.steps.forEach((s: Record<string, unknown>) => {
        if (!Array.isArray(s.actions)) s.actions = [];
        if (!Array.isArray(s.links)) s.links = [];
      });
      if (!Array.isArray(jsonContent.tips)) jsonContent.tips = [];
      console.log('✅ JSON успешно распарсен');
      parseOk = true;
    } catch (parseError) {
      // Если всё-таки не распарсилось — не оставляем страницу пустой:
      // кладём сырой ответ модели в один шаг, чтобы пользователь видел хоть что-то.
      console.warn('⚠️  Не удалось распарсить JSON:', parseError);
      jsonContent = {
        title: 'План путешествия',
        steps: [
          {
            id: 'raw_response',
            title: '⚠️ Модель вернула ответ в неожиданном формате',
            description: content,
            actions: [],
            links: [],
            cost: 0,
            isCompleted: false,
          },
        ],
        tips: [],
      };
    }

    // Собираем полезную нагрузку ответа. _usedRag/_model/_ragReason кэшируем
    // (бейдж базы знаний и информация), а _tokenUsage — НЕТ: на cache-hit его нет,
    // иначе TokenStats задвоит токены за переиспользованный ответ.
    const payload = {
      ...jsonContent,
      _model: response.model,
      _usedRag: usedRag,
      _ragReason: ragReason,
    };

    // Сохраняем в response-cache для следующих идентичных запросов (hits не делают LLM-вызов).
    if (parseOk) setCachedPlan(cacheKey, payload);

    // Extract usage information
    const usage = response.usage ? {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    } : null;

    return NextResponse.json({
      ...payload,
      _tokenUsage: usage,
    });
  } catch (error) {
    console.error('Error generating travel plan:', error);
    return NextResponse.json(
      { error: 'Failed to generate travel plan', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
