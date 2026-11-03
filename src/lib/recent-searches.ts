/**
 * Недавние поиски заказов — под полем поиска в TWA и в ⌘K на сайте.
 *
 * Запрос владельца 28.10.2026: с несколькими заказами работают параллельно и
 * каждый раз заново копируют код. Это удобство одного устройства, поэтому
 * только localStorage: никакой синхронизации и ничего на сервере. Хранилище
 * может быть недоступно (приватный режим, WebView) — тогда список просто пуст.
 */

export const RECENT_SEARCH_LIMIT = 6;

export type RecentSearchScope = "twa" | "admin";

const storageKey = (scope: RecentSearchScope) => `rb:recent-search:${scope}`;

/** Чистая логика: новый запрос в начало, без повторов (регистр не важен). */
export function pushRecentSearch(list: readonly string[], raw: string, limit = RECENT_SEARCH_LIMIT): string[] {
  const query = raw.trim();
  if (query.length < 2 || query.length > 120) return [...list];
  const rest = list.filter((item) => item.toLowerCase() !== query.toLowerCase());
  return [query, ...rest].slice(0, limit);
}

export function loadRecentSearches(scope: RecentSearchScope): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, RECENT_SEARCH_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecentSearch(scope: RecentSearchScope, query: string): string[] {
  const next = pushRecentSearch(loadRecentSearches(scope), query);
  try { window.localStorage.setItem(storageKey(scope), JSON.stringify(next)); } catch { /* только удобство */ }
  return next;
}

export function forgetRecentSearches(scope: RecentSearchScope): void {
  try { window.localStorage.removeItem(storageKey(scope)); } catch { /* только удобство */ }
}
