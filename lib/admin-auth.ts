import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * Имя заголовка, в котором клиент (страница /admin) передаёт пароль.
 * Хранится в localStorage браузера после ввода пользователем.
 */
export const ADMIN_PASSWORD_HEADER = 'x-admin-password';

/**
 * Проверяет пароль администратора из заголовка запроса.
 *
 * Защита простая (один общий пароль из env), без OAuth/сессий — достаточна для
 * MVP/персональной админки. Сравнение timing-safe, чтобы не давать утечку по таймингу.
 *
 * @returns true если пароль задан в env и совпадает с присланным
 */
export function checkAdminAuth(request: NextRequest): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  // Пароль не задан → блокируем всё (принудительно включаем защиту).
  if (!expected) return false;

  const provided = request.headers.get(ADMIN_PASSWORD_HEADER);
  if (!provided) return false;

  // timing-safe сравнение: одинаковая длина обязательна для timingSafeEqual.
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Стандартный 401-ответ для защищённых endpoint-ов.
 */
export function unauthorizedResponse() {
  return Response.json(
    { error: 'Требуется пароль администратора (заголовок x-admin-password)' },
    { status: 401 }
  );
}
