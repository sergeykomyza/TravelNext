import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { checkAdminAuth, unauthorizedResponse } from '@/lib/admin-auth';

/**
 * GET /api/docs[?category=visa]
 * Список документов с метаданными переиндексации (updated_at, last_indexed_at),
 * чтобы UI мог показывать «embeddings устарели». Контент НЕ отдаём (тяжёлый).
 */
export async function GET(request: NextRequest) {
  if (!checkAdminAuth(request)) return unauthorizedResponse();

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase не подключена' }, { status: 503 });
  }

  const category = request.nextUrl.searchParams.get('category');
  let query = supabase
    .from('raw_documents')
    .select('id, title, category, is_published, updated_at, last_indexed_at')
    .order('updated_at', { ascending: false });

  if (category) query = query.eq('category', category);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ documents: data });
}

/** Допустимые категории (совпадают со скриптом миграции). */
const CATEGORIES = ['general', 'visa', 'insurance', 'telecom', 'airport', 'hotel'] as const;
type Category = (typeof CATEGORIES)[number];

/**
 * POST /api/docs  { title, category?, content, is_published? }
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

  const { data, error } = await supabase
    .from('raw_documents')
    .insert({
      title,
      category,
      content,
      is_published: body.is_published ?? true,
    })
    .select('id, title, category, is_published, updated_at, last_indexed_at')
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
