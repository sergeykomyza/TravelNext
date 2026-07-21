/**
 * In-memory rate limiter (скользящее окно) — защита /api/generate-plan от abuse.
 *
 * Зачем: публичный эндпоинт без лимита → один бот сливает LLM-баланс за часы.
 * Лимит (10 планов/час на IP) отсекает hammering до тяжёлой работы (ONNX + LLM).
 *
 * Ограничение: счётчик per-instance (serverless). Каждый инстанс Vercel держит
 * свой Map, поэтому точный cross-instance лимит так не получить. Для MVP
 * (десяток стран, умеренный трафик) достаточно: ловит наивный hammering и бьёт
 * по бюджету LLM в пределах тёплого инстанса. Апгрейд до точного лимита —
 * Upstash Redis / Vercel KV (@upstash/ratelimit), нужен аккаунт и env-переменные.
 */

const hits = new Map<string, number[]>();

/** Потолок числа ключей в Map — защита от роста при атаке с множества IP. */
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  /** Секунды до освобождения слота (для заголовка Retry-After). 0 если allowed. */
  retryAfter: number;
}

/**
 * Скользящее окно: считает запросы key за последние windowMs мс.
 * Возвращает allowed=false, если лимит превышен, и секунды до следующего слота.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  const prev = hits.get(key) ?? [];
  // Оставляем только таймстампы внутри актуального окна (чистим протухшие).
  const recent = prev.filter((ts) => ts > windowStart);

  if (recent.length >= limit) {
    // Сколько ждать до момента, когда самый старый запрос «выпадет» из окна.
    const oldest = recent[0];
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    hits.set(key, recent);
    return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
  }

  recent.push(now);
  hits.set(key, recent);

  // При переполнении Map чистим ключи, у которых не осталось активных запросов.
  if (hits.size > MAX_KEYS) {
    for (const [k, timestamps] of hits) {
      if (!timestamps.some((ts) => ts > windowStart)) hits.delete(k);
    }
  }

  return { allowed: true, retryAfter: 0 };
}
