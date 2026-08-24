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

/**
 * Ручной ввод геймпасса — общий разбор того, что покупатель вставляет в чат
 * или в поле «не нашли по нику».
 *
 * Поиск по нику опирается на публичные списки Roblox (`accessFilter=Public`
 * + перебор игр), и они регулярно отдают пусто при живом геймпассе: скрытый
 * плейс, свежесозданный пасс, лаг API. Ссылку на сам геймпасс покупатель
 * при этом видит — она и становится запасным входом в заказ, поэтому разбор
 * должен принимать всё, что реально копируют:
 *
 *   https://www.roblox.com/game-pass/1784555857/name?x=1#frag
 *   https://www.roblox.com/ru/game-passes/1784555857
 *   create.roblox.com/dashboard/creations/experiences/123/passes/1784555857/sales
 *   www.roblox.com/game_pass/1784555857
 *
 * `parseGamepassUrl` — только ссылочные формы: голое число здесь означало бы,
 * что чисто цифровой ник Roblox (NICK_RE его допускает) уедет в геймпассы.
 * `parseGamepassRef` добавляет голый ID и применяется там, где поле явно
 * подписано «ссылка или ID».
 */
const GAMEPASS_URL_PATTERNS = [
  /game-pass(?:es)?\/(\d+)/i,
  /game_pass(?:es)?\/(\d+)/i,
  /\bpasses\/(\d+)/i,
  /catalog\/(\d+)/i,
  /library\/(\d+)/i,
  /assets?\/(\d+)/i,
];

/** Голый ID: реальные ID геймпассов — от сотен до сотен миллионов. */
const BARE_ID_RE = /^\d{3,15}$/;

export function parseGamepassUrl(input?: string | null): string | null {
  if (!input) return null;
  // Query и hash режем до матча: `?id=42` в хвосте не должен побеждать пасс.
  const clean = input.trim().split("?")[0].split("#")[0];
  for (const pattern of GAMEPASS_URL_PATTERNS) {
    const m = clean.match(pattern);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function parseGamepassRef(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (BARE_ID_RE.test(trimmed)) return trimmed;
  return parseGamepassUrl(trimmed);
}
