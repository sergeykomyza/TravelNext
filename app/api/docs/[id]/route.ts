import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { checkAdminAuth, unauthorizedResponse } from '@/lib/admin-auth';
import { documentPatchSchema, validationErrorResponse } from '@/lib/validation';

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
    .select('id, title, category, country, content, is_published, updated_at, last_indexed_at')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Ошибка при получении документа:', error);
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: `Документ id=${id} не найден` }, { status: 404 });
    }
    return NextResponse.json({ error: 'Ошибка при получении документа' }, { status: 500 });
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Невалидный JSON' }, { status: 400 });
  }

  // Валидация через Zod (частичная схема)
  const validationResult = documentPatchSchema.safeParse(body);
  if (!validationResult.success) {
    return NextResponse.json(
      validationErrorResponse(validationResult.error),
      { status: 400 }
    );
  }

  // Удаляем undefined поля
  const patch: Record<string, unknown> = {};
  const data = validationResult.data;
  if (data.title !== undefined) patch.title = data.title;
  if (data.category !== undefined) patch.category = data.category;
  if (data.country !== undefined) patch.country = data.country;
  if (data.content !== undefined) patch.content = data.content;
  if (data.is_published !== undefined) patch.is_published = data.is_published;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 });
  }

  const { data: result, error } = await supabase
    .from('raw_documents')
    .update(patch)
    .eq('id', id)
    .select('id, title, category, country, is_published, updated_at, last_indexed_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Документ с таким заголовком уже существует' }, { status: 409 });
    }
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: `Документ id=${id} не найден` }, { status: 404 });
    }
    return NextResponse.json({ error: 'Ошибка при обновлении документа' }, { status: 500 });
  }

  return NextResponse.json({ document: result });
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
    console.error('Ошибка при удалении документа:', error);
    return NextResponse.json({ error: 'Ошибка при удалении документа' }, { status: 500 });
  }
  if (!count || count === 0) {
    return NextResponse.json({ error: `Документ id=${id} не найден` }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, id });
}
