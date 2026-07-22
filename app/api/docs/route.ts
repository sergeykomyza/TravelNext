import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { checkAdminAuth, unauthorizedResponse } from '@/lib/admin-auth';
import { CATEGORIES, COUNTRIES, DEFAULT_COUNTRY, type Category, type Country } from '@/lib/constants';
import { documentSchema, validationErrorResponse } from '@/lib/validation';

/** Дефолтный и максимальный размер страницы списка документов. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /api/docs[?category=visa][&country=Вьетнам][&limit=50][&offset=0]
 * Список документов с метаданными переиндексации (updated_at, last_indexed_at),
 * чтобы UI мог показывать «embeddings устарели». Контент НЕ отдаём (тяжёлый).
 * Пагинация limit/offset — чтобы админка не тянула тысячи строк разом.
 */
export async function GET(request: NextRequest) {
  if (!checkAdminAuth(request)) return unauthorizedResponse();

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase не подключена' }, { status: 503 });
  }

  const params = request.nextUrl.searchParams;
  const category = params.get('category');
  const country = params.get('country');

  const limit = Math.min(Math.max(Number(params.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Number(params.get('offset')) || 0, 0);

  let query = supabase
    .from('raw_documents')
    .select('id, title, category, country, is_published, updated_at, last_indexed_at', {
      count: 'exact',
    })
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (category) query = query.eq('category', category);
  if (country) query = query.eq('country', country);

  const { data, count, error } = await query;
  if (error) {
    console.error('Ошибка при получении списка документов:', error);
    return NextResponse.json({ error: 'Ошибка при получении списка документов' }, { status: 500 });
  }
  return NextResponse.json({ documents: data ?? [], total: count ?? 0, limit, offset });
}

/**
 * POST /api/docs  { title, category?, country?, content, is_published? }
 * Создаёт новый документ. Embeddings НЕ генерируются — после создания UI должен
 * предложить переиндексацию (POST /api/reindex-doc { docId }).
 */
export async function POST(request: NextRequest) {
  if (!checkAdminAuth(request)) return unauthorizedResponse();

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase не подключена' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Невалидный JSON' }, { status: 400 });
  }

  // Валидация через Zod
  const validationResult = documentSchema.safeParse(body);
  if (!validationResult.success) {
    return NextResponse.json(
      validationErrorResponse(validationResult.error),
      { status: 400 }
    );
  }

  const { title, category, country, content, is_published } = validationResult.data;

  const { data, error } = await supabase
    .from('raw_documents')
    .insert({
      title,
      category,
      country,
      content,
      is_published,
    })
    .select('id, title, category, country, is_published, updated_at, last_indexed_at')
    .single();

  if (error) {
    // title UNIQUE → нарушение констрейнта
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `Документ с заголовком «${title}» уже существует` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Ошибка при создании документа' }, { status: 500 });
  }

  return NextResponse.json({ document: data }, { status: 201 });
}
