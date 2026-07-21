/**
 * Справочники значений для документов.
 * Единственный источник правды для категорий и стран — используется в API-роутах,
 * админке и (для категорий) в скрипте миграции.
 */

/** Допустимые категории документов (совпадают со схемой и migrate-to-db.ts). */
export const CATEGORIES = [
  'general',
  'visa',
  'insurance',
  'telecom',
  'airport',
  'hotel',
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Поддерживаемые страны. Значения хранятся в raw_documents.country и
 * documents.country, и фильтр match_documents.filter_country сравнивает с ними.
 *
 * ВАЖНО: этот список должен совпадать с массивом DESTINATIONS в app/page.tsx
 * (dropdown «Пункт назначения»). Чтобы добавить страну:
 *   1) дописать сюда и в DESTINATIONS,
 *   2) завести документы с этой страной в админке и переиндексировать.
 * Без контента для страны RAG не сработает — будет fallback на общие знания модели.
 */
export const COUNTRIES = [
  'Вьетнам',
  'Таиланд',
  'Индонезия',
  'Шри-Ланка',
  'Турция',
  'Грузия',
  'Армения',
  'Сербия',
  'ОАЭ',
  'Египет',
  'Марокко',
  'Тунис',
] as const;
export type Country = (typeof COUNTRIES)[number];

/** Дефолтная страна для новых/старых документов (весь исторический контент — про Вьетнам). */
export const DEFAULT_COUNTRY: Country = 'Вьетнам';
