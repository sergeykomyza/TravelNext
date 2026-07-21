import crypto from 'node:crypto';

/**
 * In-memory кэш готовых планов (response-cache), provider-независимый.
 *
 * Кэшируется ПОЛНЫЙ ответ /api/generate-plan по ключу маршрута
 * (город вылета / страна / даты / бюджет). Повторный идентичный запрос
 * не делает LLM-вызов и не считает эмбеддинги → экономия токенов и времени.
 *
 * Почему не prompt caching (cache_control): на z.ai Coding Plan кэшированные
 * токены тарифицируются как обычные, а поддержка Anthropic-формата cache_control
 * в их Anthropic-эндпоинте не подтверждена. Response-cache работает с любым
 * провайдером и экономит именно LLM-вызовы.
 *
 * Ограничение: кэш per-instance (serverless). На разных инстансах Vercel кэш не
 * шарится, поэтому выигрыш реален в пределах тёплого инстанса (бёрсты, ретраи,
 * популярный маршрут). Апгрейд до общего кэша — таблица plan_cache в Supabase.
 */

const TTL_MS = 60 * 60 * 1000; // 1 час
const MAX_ENTRIES = 100;

interface CacheEntry {
  json: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export interface PlanCacheParams {
  departureCity: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget: string;
}

/** Стабильный ключ кэша из параметров маршрута. */
export function planCacheKey(params: PlanCacheParams): string {
  const stable = JSON.stringify({
    departureCity: params.departureCity,
    destination: params.destination,
    startDate: params.startDate,
    endDate: params.endDate,
    budget: params.budget,
  });
  return crypto.createHash('sha1').update(stable).digest('hex');
}

/** Возвращает кэшированный план, если он есть и не протух. Иначе null. */
export function getCachedPlan(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.json;
}

/** Сохраняет план в кэш (TTL 1ч). При переполнении выталкивает самую старую запись. */
export function setCachedPlan(key: string, json: unknown): void {
  if (cache.size >= MAX_ENTRIES) {
    // Линейный поиск старейшего — при MAX_ENTRIES=100 недорого.
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;
    for (const [k, e] of cache) {
      if (e.expiresAt < oldestExpiry) {
        oldestExpiry = e.expiresAt;
        oldestKey = k;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { json, expiresAt: Date.now() + TTL_MS });
}
