import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { checkAdminAuth, unauthorizedResponse } from '@/lib/admin-auth';
import { reindexSchema, validationErrorResponse } from '@/lib/validation';

// Vercel serverless: переиндексация грузит модель ONNX (@xenova/transformers),
// холодный старт требует запаса по времени — иначе первый запрос упирается в таймаут.
export const maxDuration = 60;

/**
 * GET /api/reindex-doc[?category=visa]
 * Список документов (без content) — удобно для UI/отладки в браузере.
 */
export async function GET(request: NextRequest) {
  if (!checkAdminAuth(request)) return unauthorizedResponse();

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase не подключена (SUPABASE_URL / SUPABASE_ANON_KEY не заданы)' },
      { status: 503 }
    );
  }

  const category = request.nextUrl.searchParams.get('category');
  let query = supabase
    .from('raw_documents')
    .select('id, title, category, is_published, updated_at, created_at')
    .order('updated_at', { ascending: false });

  if (category) query = query.eq('category', category);

  const { data, error } = await query;
  if (error) {
    console.error('Ошибка при получении списка документов:', error);
    return NextResponse.json({ error: 'Ошибка при получении списка документов' }, { status: 500 });
  }
  return NextResponse.json({ documents: data });
}

/**
 * POST /api/reindex-doc  { "docId": 3 }
 * Переиндексирует embeddings одного документа из raw_documents.
 * Вызывать после правки content в Supabase Table Editor.
 */
export async function POST(request: NextRequest) {
  if (!checkAdminAuth(request)) return unauthorizedResponse();

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase не подключена (SUPABASE_URL / SUPABASE_ANON_KEY не заданы)' },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть JSON' }, { status: 400 });
  }

  // Валидация через Zod
  const validationResult = reindexSchema.safeParse(body);
  if (!validationResult.success) {
    return NextResponse.json(
      validationErrorResponse(validationResult.error),
      { status: 400 }
    );
  }

  const { docId: id } = validationResult.data;

  // Достаём актуальный контент документа
  const { data: doc, error: docError } = await supabase
    .from('raw_documents')
    .select('id, title, content')
    .eq('id', id)
    .single();

  if (docError || !doc) {
    return NextResponse.json(
      { error: `Документ с id=${id} не найден в raw_documents` },
      { status: 404 }
    );
  }

  // Динамический импорт изолирует тяжёлый ONNX-модуль (см. комментарий в generate-plan):
  // статический import тянул бы onnxruntime-node на старте маршрута — в serverless
  // нативные .so не bundled, модуль падал. Грузим лениво только когда reindex нужен.
  try {
    const { reindexDocument } = await import('@/lib/reindex');
    const chunkCount = await reindexDocument(supabase, {
      id: doc.id,
      title: doc.title,
      content: doc.content,
    });

    console.log(`✅ Reindex: «${doc.title}» (id=${id}) → ${chunkCount} чанков`);
    return NextResponse.json({
      reindexed: chunkCount,
      docId: id,
      title: doc.title,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Reindex failed для docId=${id}:`, msg);
    return NextResponse.json(
      { error: 'Ошибка при переиндексации документа' },
      { status: 500 }
    );
  }
}
