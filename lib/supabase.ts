import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RealtimeClientOptions } from '@supabase/realtime-js';
import ws from 'ws';

let supabase: SupabaseClient | null = null;

/**
 * Инициализация Supabase клиента
 * @returns Supabase клиент или null, если переменные окружения не заданы
 */
export function getSupabase(): SupabaseClient | null {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return null;
  }
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        db: {
          schema: 'public',
        },
        // Node < 22 не имеет нативного WebSocket, поэтому realtime-js бросает
        // ошибку при создании клиента. Передаём ws как transport (мы realtime
        // не используем, но клиент всё равно его инициализирует).
        // Каст нужен из-за перегрузки constructor(address: null) в @types/ws.
        realtime: {
          transport: ws as unknown as NonNullable<RealtimeClientOptions['transport']>,
        },
      }
    );
  }
  return supabase;
}

/**
 * Размерность вектора для локальных эмбеддингов (paraphrase-multilingual-MiniLM-L12-v2)
 */
export const VECTOR_DIMENSION = 384;
