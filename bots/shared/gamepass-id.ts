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

/**
 * Ручной ввод геймпасса — общий разбор того, что покупатель вставляет в чат
 * или в поле «не нашли по нику». Зеркало `src/lib/gamepass-id.ts`.
 *
 * Поиск по нику опирается на публичные списки Roblox (`accessFilter=Public`
 * + перебор игр) и регулярно отдаёт пусто при живом геймпассе: скрытый плейс,
 * свежесозданный пасс, лаг API. Ссылку на сам геймпасс покупатель при этом
 * видит — она и становится запасным входом в заказ.
 *
 * `parseGamepassUrl` — только ссылочные формы: голое число здесь означало бы,
 * что чисто цифровой ник Roblox уедет в геймпассы. `parseGamepassRef`
 * добавляет голый ID и применяется там, где поле подписано «ссылка или ID».
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
