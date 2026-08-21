/**
 * Извлечение числового ID геймпасса из ссылки (ultra-review U18).
 * Зеркало `src/lib/gamepass-id.ts`.
 *
 * В БД `WbOrder.gamepassId` дополнительно поддерживается триггером
 * `wborder_gamepass_id_sync` — это страховка на случай пути записи, который
 * забыли обновить; здесь значение проставляется явно, чтобы код читался.
 */
const GAMEPASS_ID_RE = /game-pass(?:es)?\/(\d+)/i;

export function extractGamepassId(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(GAMEPASS_ID_RE);
  return m ? m[1] : null;
}
