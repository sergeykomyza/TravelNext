import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { checkAdminAuth, unauthorizedResponse } from '@/lib/admin-auth';

const CATEGORIES = ['general', 'visa', 'insurance', 'telecom', 'airport', 'hotel'] as const;

/** Контекст динамического маршрута /api/docs/[id] — params это Promise в Next.js 16. */
async function parseId(ctx: { params: Promise<{ id: string }> }): Promise<number | null> {
  const { id } = await ctx.params;
  const num = Number(id);
  return Number.isInteger(num) && num > 0 ? num : null;
}

/**
 * GET /api/docs/[id]
 * Полный документ с контентом — для модалки редактирования.
 * (GET /api/docs отдаёт список без content, чтобы не тянуть тяжёлое.)
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!checkAdminAuth(request)) return unauthorizedResponse();

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase не подключена' }, { status: 503 });
  }

  const id = await parseId(ctx);
  if (id === null) {
    return NextResponse.json({ error: 'id должен быть целым положительным числом' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('raw_documents')
    .select('id, title, category, content, is_published, updated_at, last_indexed_at')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: `Документ id=${id} не найден` }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

/**
 * PATCH /api/docs/[id]  { title?, category?, content?, is_published? }
 * Обновляет поля документа. Если меняется content — updated_at обновится триггером,
 * и UI покажет «embeddings устарели» (предложит переиндексацию).
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!checkAdminAuth(request)) return unauthorizedResponse();

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase не подключена' }, { status: 503 });
  }

  const id = await parseId(ctx);
  if (id === null) {
    return NextResponse.json({ error: 'id должен быть целым положительным числом' }, { status: 400 });
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

  // Собираем только переданные поля
  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) return NextResponse.json({ error: 'title не может быть пустым' }, { status: 400 });
    patch.title = t;
  }
  if (body.category !== undefined) {
    if (!(CATEGORIES as readonly string[]).includes(body.category)) {
      return NextResponse.json({ error: `category должен быть одним из: ${CATEGORIES.join(', ')}` }, { status: 400 });
    }
    patch.category = body.category;
  }
  if (body.content !== undefined) {
    const c = body.content.trim();
    if (!c) return NextResponse.json({ error: 'content не может быть пустым' }, { status: 400 });
    patch.content = c;
  }
  if (body.is_published !== undefined) {
    patch.is_published = Boolean(body.is_published);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('raw_documents')
    .update(patch)
    .eq('id', id)
    .select('id, title, category, is_published, updated_at, last_indexed_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Документ с таким заголовком уже существует' }, { status: 409 });
    }
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: `Документ id=${id} не найден` }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ document: data });
}

/**
 * DELETE /api/docs/[id]
 * Удаляет документ. Чанки удалятся автоматически (FK ON DELETE CASCADE).
 */
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!checkAdminAuth(request)) return unauthorizedResponse();

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase не подключена' }, { status: 503 });
  }

  const id = await parseId(ctx);
  if (id === null) {
    return NextResponse.json({ error: 'id должен быть целым положительным числом' }, { status: 400 });
  }

  const { error, count } = await supabase
    .from('raw_documents')
    .delete({ count: 'exact' })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!count || count === 0) {
    return NextResponse.json({ error: `Документ id=${id} не найден` }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, id });
}
