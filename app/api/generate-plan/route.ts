import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabase } from '@/lib/supabase';

// Vercel serverless: холодный старт (@xenova/transformers + Anthropic) требует
// запаса по времени, иначе первый запрос упирается в дефолтный таймаут функции.
export const maxDuration = 60;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.z.ai/api/anthropic',
});

/**
 * Выполняет RAG-поиск релевантных документов через Supabase
 * @returns {context, usedRag} - контекст из БД или пустая строка + флаг успеха
 */
async function retrieveContext(
  query: string
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
    });

    if (error) {
      // Если RPC функция не существует, fallback на обычный поиск
      if (error.message.includes('function') || error.code === '42883') {
        console.warn('RAG: RPC функция match_documents не найдена. Выполните init-db.sql в Supabase SQL Editor');
        return { context: '', usedRag: false, ragReason: 'no_match_documents_rpc' };
      }
      throw error;
    }

    if (!rows || rows.length === 0) {
      console.warn('RAG: релевантные документы не найдены');
      return { context: '', usedRag: false, ragReason: 'no_matching_docs' };
    }

    // Расширяем до полных документов: если хоть один чанк файла совпал с
    // запросом, подтягиваем ВЕСЬ файл целиком. Иначе фиксированное разбиение
    // может вернуть лишь часть документа (например, кусок про e-visa, но не
    // про безвиз 45 дней) — и модель получит искажённую картину.
    const matchedFiles = [...new Set(rows.map((r: { source_file: string }) => r.source_file))];

    const { data: fullRows, error: docError } = await supabase
      .from('documents')
      .select('source_file, content')
      .in('source_file', matchedFiles)
      .order('id', { ascending: true });

    if (docError) throw docError;

    // Собираем чанки обратно в целые документы (по source_file, в порядке id)
    const docsByFile = new Map<string, string>();
    for (const row of fullRows ?? []) {
      const prev = docsByFile.get(row.source_file) ?? '';
      docsByFile.set(row.source_file, prev + (prev ? '\n' : '') + row.content);
    }

    const context = [...docsByFile.entries()]
      .map(([file, content], i) => `[${i + 1}] (${file})\n${content}`)
      .join('\n\n---\n\n');

    console.log(
      `RAG: совпало ${rows.length} чанков, расширено до ${docsByFile.size} полных документов:`,
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
    const { departureCity, date, budget, destination } = body;

    if (!departureCity || !date || !budget) {
      return NextResponse.json(
        { error: 'Missing required fields: departureCity, date, budget' },
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

    // Формируем поисковый запрос для RAG
    const searchQuery = `Путешествие в ${destination || 'Вьетнам'}, вылет из ${departureCity}, дата ${date}, бюджет ${budget}$. Темы: виза, страховка, билеты, отель, трансфер, связь, вещи, аэропорт.`;

    // Выполняем RAG-поиск релевантных документов
    const { context, usedRag, ragReason } = await retrieveContext(searchQuery);

    // Базовый промпт (общие знания)
    let ragContext = '';
    if (usedRag && context) {
      ragContext = `
# База знаний путешествий

Используй эти проверенные знания из нашей базы. Факты из базы важнее твоих общих знаний: если в базе есть прямой ответ для конкретного случая (например, безвиз для граждан РФ на 45 дней), опирайся именно на него, а не на общие/устаревшие советы. Не противоречь базе; если общие знания расходятся с базой — пиши по базе.

${context}

---
`;
    }

    const prompt = `Сгенерируй пошаговый план путешествия в ${destination || 'Вьетнам'} на ${date} с бюджетом ${budget}$. Вылет из ${departureCity}.

${ragContext}
Сгенерируй пошаговый план для путешественника-новичка, у которого нет опыта за границей. Разбей план на конкретные, выполнимые шаги (виза, билеты, страховка, отель, трансфер, связь, вещи, аэропорт). Каждый шаг должен содержать четкие действия и ссылки.

ОБЯЗАТЕЛЬНО верни ответ в формате JSON БЕЗ каких-либо дополнительных текстов, markdown-оберток или пояснений. Только чистый JSON:
{
  "title": "Название маршрута",
  "totalBudget": 2000,
  "steps": [
    {
      "id": "уникальный_идентификатор",
      "title": "Название шага",
      "description": "Описание того, что нужно сделать",
      "actions": ["действие 1", "действие 2"],
      "links": [{ "text": "Текст ссылки", "url": "https://..." }],
      "cost": 100,
      "isCompleted": false
    }
  ],
  "tips": ["Совет 1", "Совет 2"]
}

ВАЖНО:
1. Генерируй только JSON без markdown кода
2. id должен быть уникальным для каждого шага (используй английские буквы и цифры, например step_1_visa)
3. Добавляй реальные ссылки на полезные ресурсы
4. Разбивай всё на конкретные действия, понятные новичку
5. Включай шаги: виза, билеты, страховка, отель, трансфер, связь, вещи, аэропорт
6. Если ссылок нет, передавай пустой массив links: []
7. actions должен содержать конкретные действия, которые нужно выполнить`;

    const response = await anthropic.messages.create({
      // z.ai обслуживает GLM-модели, не Claude. Валидные id: glm-5.2, glm-4.7,
      // glm-4.6, glm-4.5, glm-4.5-air (см. https://docs.z.ai). claude-* → 400 "Unknown Model".
      model: process.env.ANTHROPIC_MODEL || 'glm-4.6',
      // Подробный план (8+ шагов с actions/links) на русском токеноёмок;
      // 2000 обрезали JSON посередине → JSON.parse падал → пустой план. Даём запас.
      max_tokens: 6000,
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

    // Логируем сырой ответ для отладки
    console.log('📝 Сырой ответ от модели (первые 500 символов):');
    console.log(content.slice(0, 500));

    // Попытка распарсить JSON из ответа
    let jsonContent;
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
      jsonContent = JSON.parse(cleaned);
      // Гарантируем массивы для UI — иначе .map падает при рендере
      if (!Array.isArray(jsonContent.steps)) jsonContent.steps = [];
      jsonContent.steps.forEach((s: Record<string, unknown>) => {
        if (!Array.isArray(s.actions)) s.actions = [];
        if (!Array.isArray(s.links)) s.links = [];
      });
      if (!Array.isArray(jsonContent.tips)) jsonContent.tips = [];
      console.log('✅ JSON успешно распарсен');
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

    // Extract usage information
    const usage = response.usage ? {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    } : null;

    return NextResponse.json({
      ...jsonContent,
      _tokenUsage: usage,
      _model: response.model,
      _usedRag: usedRag,
      _ragReason: ragReason,
    });
  } catch (error) {
    console.error('Error generating travel plan:', error);
    return NextResponse.json(
      { error: 'Failed to generate travel plan', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
