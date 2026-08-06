/**
 * Извлечение числового ID геймпасса из ссылки (ultra-review U18).
 * Зеркало `bots/shared/gamepass-id.ts`.
 *
 * Заказы искали через `gamepassUrl: { contains: '/<id>' }` списком `OR` —
 * индекс к такому запросу неприменим, поэтому TWA-поиск по геймпассу и гард
 * перед каждой покупкой сканировали таблицу `WbOrder` целиком. Теперь ID
 * лежит отдельным индексируемым полем, а `wborder_gamepass_id_sync` (триггер
 * из миграции `20260726_ultra_review_fixes`) держит его в синхроне со ссылкой.
 */
const GAMEPASS_ID_RE = /game-pass(?:es)?\/(\d+)/i;

export function extractGamepassId(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(GAMEPASS_ID_RE);
  return m ? m[1] : null;
}
