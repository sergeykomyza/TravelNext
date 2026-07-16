'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

/**
 * Админ-страница базы знаний: управление документами (CRUD) и переиндексация
 * embeddings — всё в браузере, без открытия терминала или Supabase Dashboard.
 *
 * Защита: один пароль из env (ADMIN_PASSWORD), хранится в localStorage и
 * отправляется в заголовке x-admin-password. API проверяет его на сервере.
 *
 * Маршрут: /admin
 */

const CATEGORIES = ['general', 'visa', 'insurance', 'telecom', 'airport', 'hotel'] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_LABELS: Record<Category, string> = {
  general: 'общее',
  visa: 'виза',
  insurance: 'страховка',
  telecom: 'связь',
  airport: 'аэропорт',
  hotel: 'отель',
};

const CATEGORY_COLORS: Record<Category, string> = {
  general: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  visa: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  insurance: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  telecom: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  airport: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  hotel: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

interface Doc {
  id: number;
  title: string;
  category: Category;
  is_published: boolean;
  updated_at: string;
  last_indexed_at: string | null;
}

interface ModalState {
  id: number | null; // null = создание нового
  title: string;
  category: Category;
  content: string;
  is_published: boolean;
}

const PW_KEY = 'admin_password';

/** Embeddings устарели: контент менялся после последней переиндексации. */
function isStale(doc: Doc): boolean {
  if (!doc.last_indexed_at) return true;
  return new Date(doc.updated_at) > new Date(doc.last_indexed_at);
}

function formatDate(iso: string | null): string {
  if (!iso) return 'никогда';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AdminPage() {
  const [password, setPassword] = useState<string>('');
  const [authed, setAuthed] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalState | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  /** Обёртка над fetch с заголовком пароля. Бросает при не-2xx. */
  const api = useCallback(
    async (path: string, opts: RequestInit = {}) => {
      const res = await fetch(path, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': password,
          ...(opts.headers ?? {}),
        },
      });
      return res;
    },
    [password]
  );

  const loadDocs = useCallback(async (): Promise<boolean> => {
    setLoadingDocs(true);
    setError(null);
    const res = await api('/api/docs');
    if (res.status === 401) {
      setAuthed(false);
      return false;
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || `Ошибка ${res.status}`);
      return false;
    }
    const data = await res.json();
    setDocs(data.documents ?? []);
    return true;
  }, [api]);

  // Bootstrap при монтировании: если пароль сохранён в localStorage — проверяем
  // и входим автоматически. localStorage доступен только на клиенте, поэтому
  // чтение и первый запрос идут в effect; setState здесь неизбежен для
  // client-side auth без SSR-данных (как и в TokenStatsContext проекта).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(PW_KEY) : null;
    if (!saved) {
      setAuthChecking(false);
      return;
    }
    setPassword(saved);
    fetch('/api/docs', { headers: { 'x-admin-password': saved } })
      .then(async (res) => {
        if (res.ok) {
          setAuthed(true);
          const data = await res.json();
          setDocs(data.documents ?? []);
        }
      })
      .finally(() => setAuthChecking(false));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const res = await fetch('/api/docs', {
      headers: { 'x-admin-password': password },
    });
    if (res.status === 401) {
      setAuthError('Неверный пароль');
      return;
    }
    if (!res.ok) {
      setAuthError(`Ошибка сервера: ${res.status}`);
      return;
    }
    localStorage.setItem(PW_KEY, password);
    const data = await res.json();
    setDocs(data.documents ?? []);
    setAuthed(true);
  };

  const handleLogout = () => {
    localStorage.removeItem(PW_KEY);
    setPassword('');
    setAuthed(false);
    setDocs([]);
  };

  const openNew = () => {
    setModal({ id: null, title: '', category: 'general', content: '', is_published: true });
  };

  const openEdit = (doc: Doc) => {
    // Контент догружаем отдельным запросом (GET /api/docs отдаёт список без content,
    // чтобы не тянуть тяжёлое при каждом обновлении).
    setModal({
      id: doc.id,
      title: doc.title,
      category: doc.category,
      content: '', // догрузим ниже
      is_published: doc.is_published,
    });
    (async () => {
      const res = await api(`/api/docs/${doc.id}`);
      if (res.ok) {
        const d = await res.json();
        setModal((m) => (m && m.id === doc.id ? { ...m, content: d.content ?? '' } : m));
      }
    })();
  };

  const handleSave = async () => {
    if (!modal) return;
    if (!modal.title.trim() || !modal.content.trim()) {
      setError('Заголовок и контент обязательны');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: modal.title.trim(),
        category: modal.category,
        content: modal.content,
        is_published: modal.is_published,
      };
      const res = modal.id === null
        ? await api('/api/docs', { method: 'POST', body: JSON.stringify(body) })
        : await api(`/api/docs/${modal.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Ошибка ${res.status}`);
        return;
      }
      setModal(null);
      await loadDocs();
    } finally {
      setSaving(false);
    }
  };

  const handleReindex = async (doc: Doc) => {
    setBusyId(doc.id);
    setError(null);
    try {
      const res = await api('/api/reindex-doc', {
        method: 'POST',
        body: JSON.stringify({ docId: doc.id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Ошибка переиндексации (${res.status})`);
        return;
      }
      await loadDocs();
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (doc: Doc) => {
    if (!confirm(`Удалить «${doc.title}»? Чанки и embeddings удалятся вместе с документом.`)) return;
    setBusyId(doc.id);
    setError(null);
    try {
      const res = await api(`/api/docs/${doc.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Ошибка удаления (${res.status})`);
        return;
      }
      await loadDocs();
    } finally {
      setBusyId(null);
    }
  };

  // ───────── Auth overlay ─────────
  if (authChecking) {
    return <div className="min-h-screen bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-gray-900 dark:to-gray-800" />;
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleLogin(e);
          }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 w-full max-w-sm"
        >
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-2 text-center">🔒 Админ-панель</h1>
          <p className="text-center text-gray-500 dark:text-gray-400 text-sm mb-6">
            Введите пароль администратора
          </p>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {authError && <p className="text-red-600 dark:text-red-400 text-sm mt-2">{authError}</p>}
          <button
            type="submit"
            className="w-full mt-4 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold py-3 rounded-lg transition"
          >
            Войти
          </button>
          <Link href="/" className="block text-center text-sm text-blue-600 dark:text-blue-400 hover:underline mt-4">
            ← На главную
          </Link>
        </form>
      </div>
    );
  }

  // ───────── Список документов ─────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white">📚 База знаний</h1>
            <div className="flex items-center gap-3">
              <button
                onClick={handleLogout}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                Выйти
              </button>
              <Link href="/" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                На главную →
              </Link>
            </div>
          </div>
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            {docs.length} {pluralize(docs.length)} · правки контента → кнопка 🔄 обновит embeddings
          </p>

          <button
            onClick={openNew}
            className="mb-6 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold py-3 px-6 rounded-lg transition shadow-lg"
          >
            + Новый документ
          </button>

          {loadingDocs && docs.length === 0 && (
            <p className="text-gray-500 dark:text-gray-400">Загрузка…</p>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
              <p className="text-red-600 dark:text-red-400 font-medium">❌ {error}</p>
            </div>
          )}

          <div className="space-y-3">
            {docs.map((doc) => {
              const stale = isStale(doc);
              const busy = busyId === doc.id;
              return (
                <div
                  key={doc.id}
                  className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-5 border border-gray-100 dark:border-gray-700"
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${CATEGORY_COLORS[doc.category]}`}>
                          {CATEGORY_LABELS[doc.category]}
                        </span>
                        {!doc.is_published && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                            черновик
                          </span>
                        )}
                        {stale && (
                          <span
                            className="text-xs font-medium px-2 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                            title="Контент изменился после последней переиндексации — embeddings устарели"
                          >
                            ⚠ embeddings устарели
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white truncate">
                        {doc.title}
                      </h3>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        обновлён: {formatDate(doc.updated_at)} · индекс: {formatDate(doc.last_indexed_at)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => openEdit(doc)}
                        disabled={busy}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition disabled:opacity-50"
                      >
                        📝 Править
                      </button>
                      <button
                        onClick={() => handleReindex(doc)}
                        disabled={busy}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white transition disabled:opacity-50"
                        title="Переиндексировать embeddings этого документа"
                      >
                        {busy ? '🔄 …' : '🔄 Reindex'}
                      </button>
                      <button
                        onClick={() => handleDelete(doc)}
                        disabled={busy}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition disabled:opacity-50"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {!loadingDocs && docs.length === 0 && !error && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 text-center text-gray-500 dark:text-gray-400">
                Документов пока нет. Нажмите «+ Новый документ».
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ───────── Модалка редактирования ───────── */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-800 dark:text-white">
                {modal.id === null ? 'Новый документ' : 'Редактировать'}
              </h2>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Заголовок
                </label>
                <input
                  type="text"
                  value={modal.title}
                  onChange={(e) => setModal({ ...modal, title: e.target.value })}
                  placeholder="Например: Виза в Таиланд"
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Категория
                  </label>
                  <select
                    value={modal.category}
                    onChange={(e) => setModal({ ...modal, category: e.target.value as Category })}
                    className="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 mt-6 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={modal.is_published}
                    onChange={(e) => setModal({ ...modal, is_published: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Опубликован (иначе — черновик, не попадает в RAG)
                  </span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Контент
                </label>
                <textarea
                  value={modal.content}
                  onChange={(e) => setModal({ ...modal, content: e.target.value })}
                  rows={14}
                  placeholder="Текст документа (поддерживается Markdown)…"
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-3">
              <button
                onClick={() => setModal(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Отмена
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white disabled:opacity-50"
              >
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function pluralize(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'документ';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'документа';
  return 'документов';
}
