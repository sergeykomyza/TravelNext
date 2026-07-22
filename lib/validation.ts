/**
 * Схемы валидации для API запросов (Zod)
 * Предотвращает инъекции, некорректные данные и атаки на API
 */

import { z } from 'zod';

// Базовые типы для переиспользования
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'Дата должна быть в формате YYYY-MM-DD',
}).refine((date) => {
  const parsed = new Date(date);
  return !isNaN(parsed.getTime()) && parsed.getFullYear() >= 2020 && parsed.getFullYear() <= 2100;
}, { message: 'Некорректная дата' });

const positiveNumber = z.number().positive({ message: 'Значение должно быть положительным' });

const nonEmptyString = z.string().min(1, { message: 'Поле обязательно для заполнения' });

// Константы из app/page.tsx
const DEPARTURE_CITIES = ['Москва'] as const;
const DESTINATIONS = ['Вьетнам', 'Таиланд', 'Индонезия', 'Шри-Ланка', 'Турция', 'Грузия', 'Армения', 'Сербия', 'ОАЭ', 'Египет', 'Марокко', 'Тунис'] as const;

// Схема для генерации плана путешествия
export const generatePlanSchema = z.object({
  departureCity: z.enum(DEPARTURE_CITIES, {
    errorMap: () => ({ message: 'Некорректный город вылета' }),
  }),
  destination: z.enum(DESTINATIONS, {
    errorMap: () => ({ message: 'Некорректный пункт назначения' }),
  }).optional(),
  startDate: dateSchema,
  endDate: dateSchema.optional().refine((endDate, ctx) => {
    if (!endDate) return true;
    const startDate = ctx.parent.startDate as string;
    if (new Date(endDate) < new Date(startDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Дата возвращения не может быть раньше даты вылета',
      });
      return false;
    }
    return true;
  }),
  budget: positiveNumber,
});

export type GeneratePlanInput = z.infer<typeof generatePlanSchema>;

// Схема для создания/обновления документа
const CATEGORIES = ['general', 'visa', 'insurance', 'telecom', 'airport', 'hotel'] as const;
const COUNTRIES = ['Вьетнам', 'Таиланд', 'Индонезия', 'Шри-Ланка', 'Турция', 'Грузия', 'Армения', 'Сербия', 'ОАЭ', 'Египет', 'Марокко', 'Тунис'] as const;

export const documentSchema = z.object({
  title: nonEmptyString.max(200, { message: 'Заголовок не может превышать 200 символов' })
    .refine((title) => !/<script|javascript:|onerror|onload/i.test(title), {
    message: 'Заголовок содержит недопустимые символы',
  }),
  category: z.enum(CATEGORIES, {
    errorMap: () => ({ message: 'Некорректная категория' }),
  }),
  country: z.enum(COUNTRIES, {
    errorMap: () => ({ message: 'Некорректная страна' }),
  }),
  content: nonEmptyString.max(100000, { message: 'Контент слишком большой' }),
  is_published: z.boolean().default(false),
});

export type DocumentInput = z.infer<typeof documentSchema>;

// Схема для переиндексации
export const reindexSchema = z.object({
  docId: z.number().positive({ message: 'ID документа должен быть положительным числом' }),
});

export type ReindexInput = z.infer<typeof reindexSchema>;

// Частичная схема для обновления документа (все поля опциональны)
export const documentPatchSchema = documentSchema.partial();

export type DocumentPatchInput = z.infer<typeof documentPatchSchema>;

/**
 * Безопасный ответ с ошибкой валидации
 */
export function validationErrorResponse(error: z.ZodError) {
  return {
    error: 'Некорректные данные запроса',
    details: error.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    })),
  };
}
