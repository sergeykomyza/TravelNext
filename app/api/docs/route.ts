import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { checkAdminAuth, unauthorizedResponse } from '@/lib/admin-auth';
import { CATEGORIES, COUNTRIES, DEFAULT_COUNTRY, type Category, type Country } from '@/lib/constants';

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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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

  let body: {
    title?: string;
    category?: string;
    country?: string;
    content?: string;
    is_published?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Невалидный JSON' }, { status: 400 });
  }

  const title = body.title?.trim();
  const content = body.content?.trim();

  if (!title) {
    return NextResponse.json({ error: 'title обязательный' }, { status: 400 });
  }
  if (!content) {
    return NextResponse.json({ error: 'content обязательный' }, { status: 400 });
  }

  const category: Category =
    body.category && (CATEGORIES as readonly string[]).includes(body.category)
      ? (body.category as Category)
      : 'general';

  const country: Country =
    body.country && (COUNTRIES as readonly string[]).includes(body.country)
      ? (body.country as Country)
      : DEFAULT_COUNTRY;

  const { data, error } = await supabase
    .from('raw_documents')
    .insert({
      title,
      category,
      country,
      content,
      is_published: body.is_published ?? true,
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ document: data }, { status: 201 });
}
