/**
 * Локальные эмбеддинги через @xenova/transformers (ONNX Runtime)
 * Модель: Xenova/paraphrase-multilingual-MiniLM-L12-v2 (384 dimensions)
 * Мультиязычная — корректно работает с русским текстом (в отличие от all-MiniLM-L6-v2).
 * Работает полностью локально, без внешних API
 */

import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';

let embeddingPipeline: FeatureExtractionPipeline | null = null;
let initPromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Инициализация pipeline для эмбеддингов (ленивая загрузка)
 */
function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (embeddingPipeline) {
    return Promise.resolve(embeddingPipeline);
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      console.log('🔄 Загрузка модели эмбеддингов (первый запуск может занять время)...');
      const pipe = await pipeline(
        'feature-extraction',
        'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        {
          quantized: true, // Использовать квантованную модель (меньше памяти)
        }
      );
      embeddingPipeline = pipe;
      console.log('✅ Модель эмбеддингов загружена');
      return pipe;
    } catch (error) {
      console.error('❌ Ошибка загрузки модели:', error);
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Генерирует embedding для текста через локальную модель
 * @param text - текст для векторизации
 * @returns массив чисел - вектор (384 dimensions)
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const pipe = await getPipeline();

  // Генерируем embedding
  const output = await pipe(text, {
    pooling: 'mean',
    normalize: true,
  });

  // Transformers.js возвращает Tensor, конвертируем в массив
  if (Array.isArray(output)) {
    return output as number[];
  }

  // Если это объект с .data (Tensor)
  if (typeof output === 'object' && output !== null && 'data' in output) {
    return Array.from(output.data as Float32Array);
  }

  // Fallback
  return Array.from(output as Iterable<number>);
}

/**
 * Размерность вектора для локальных эмбеддингов
 */
export const VECTOR_DIMENSION = 384;
