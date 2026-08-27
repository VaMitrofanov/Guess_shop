/**
 * Roblox egress через сингапурский мост.
 *
 * Все API-хосты Roblox (`users`/`games`/`apis`/`thumbnails`.roblox.com) живут
 * на собственной сети Roblox `128.116.0.0/16`, и TCP до неё с российского
 * хоста не устанавливается вообще — соединение не отбивается, а молча висит.
 * `www.roblox.com` при этом отвечает: он на Cloudflare, поэтому «сайт открылся»
 * никогда не был признаком того, что работает поиск.
 *
 * Для страницы это выглядело так: каждый запрос выбирал весь бюджет ретраев
 * `src/lib/roblox.ts` (три попытки по 8 с), после чего `getRobloxUser` отдавал
 * `null`, а покупатель через 25 секунд читал «Такого пользователя Roblox не
 * нашли» — про существующий аккаунт.
 *
 * Мост (`VALIDATOR_SOURCE_URL`) стоит там, где Roblox доступен, и выполняет те
 * же самые запросы за ~2 с. Поэтому он здесь ПЕРВЫЙ источник, а не аварийный:
 * прямой путь остаётся фолбэком для хостов, которым до Roblox есть дорога, и
 * для окружений, где мост не настроен.
 *
 * Зеркало потребителя моста в ботах — `bots/shared/roblox.ts`.
 */

const BRIDGE_TIMEOUT_MS = 20_000;

export type BridgeAccount = {
  id: string;
  name: string;
  displayName: string;
  avatarUrl: string | null;
  /** Есть только при резолве по ID — Roblox не отдаёт их в ответе на ник. */
  description?: string | null;
  created?: string | null;
};

export type BridgePass = {
  gamepassId: number;
  productId: number;
  placeId: number;
  name: string;
  robux: number;
  sellerName: string;
  image: string;
};

export type BridgeGamepassDetails = {
  id: string;
  name: string;
  price: number;
  creatorId: number;
  creatorName?: string;
  isActive: boolean;
  /** Мост не смог подтвердить пасс и вернул заглушку — для сайта это «нет данных». */
  validationSkipped?: boolean;
};

export function bridgeConfigured(): boolean {
  return Boolean(process.env.VALIDATOR_SOURCE_URL?.trim());
}

async function bridgeFetch(path: string, init: RequestInit = {}): Promise<Record<string, unknown> | null> {
  const base = process.env.VALIDATOR_SOURCE_URL?.trim();
  if (!base) return null;
  const key = process.env.VALIDATOR_KEY?.trim();
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(key ? { "x-validator-key": key } : {}),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
    if (res.status === 401) {
      console.error("[RobloxBridge] 401 — VALIDATOR_KEY расходится с мостом");
      return null;
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || body.ok !== true) {
      console.warn(`[RobloxBridge] ${path}: HTTP ${res.status} — ${String(body?.error ?? "no ok")}`);
      return null;
    }
    return body;
  } catch (error) {
    console.warn(`[RobloxBridge] ${path} недоступен:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Аккаунт по нику или по ID. `null` — мост не ответил ИЛИ такого аккаунта нет. */
export async function bridgeRobloxUser(ref: { username?: string; userId?: string | number }): Promise<BridgeAccount | null> {
  const query = ref.userId != null
    ? `userId=${encodeURIComponent(String(ref.userId))}`
    : `username=${encodeURIComponent((ref.username ?? "").trim())}`;
  const body = await bridgeFetch(`/roblox-user?${query}`);
  const user = body?.user as BridgeAccount | null | undefined;
  return user ?? null;
}

export type BridgeNickSearch = {
  /** `false` — Roblox ответил, что такого ника нет. */
  userExists: boolean;
  account: BridgeAccount | null;
  gamepasses: BridgePass[];
};

/** `null` отличает «мост не ответил» от «мост ответил, ника нет». */
export async function bridgeSearchGamepasses(username: string): Promise<BridgeNickSearch | null> {
  const body = await bridgeFetch("/search-gamepasses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!body) return null;
  const gamepasses = Array.isArray(body.gamepasses) ? (body.gamepasses as BridgePass[]) : [];
  const account = (body.account as BridgeAccount | null | undefined) ?? null;
  // Старый мост не знает про `userExists`/`account`. Найденные пассы сами по
  // себе доказывают, что аккаунт есть; пустой ответ там неотличим, и честнее
  // считать аккаунт существующим — тогда покупатель увидит «пассов не нашли,
  // вставь ссылку», а не обвинение в опечатке в правильно набранном нике.
  const userExists = typeof body.userExists === "boolean"
    ? body.userExists
    : account !== null || gamepasses.length > 0;
  return { userExists, account, gamepasses };
}

/** Полные данные одного геймпасса: продаётся ли, чей он, картинка, placeId. */
export async function bridgeGamepassById(gamepassId: string): Promise<{
  pass: BridgePass | null;
  details: BridgeGamepassDetails | null;
} | null> {
  const body = await bridgeFetch(`/gamepass-by-id?id=${encodeURIComponent(gamepassId)}`);
  if (!body) return null;
  const details = (body.details as BridgeGamepassDetails | null | undefined) ?? null;
  return {
    pass: (body.gamepass as BridgePass | null | undefined) ?? null,
    // Заглушка «Roblox недоступен» из моста — не подтверждение пасса: пропустить
    // её на сайт значит дать оплатить пасс, цену и продавца которого никто не
    // проверил. Для сайта это отсутствие данных.
    details: details?.validationSkipped ? null : details,
  };
}

/** Только карточка пасса (цена/владелец/продажа), без обхода вселенных. */
export async function bridgeGamepassDetails(gamepassId: string): Promise<BridgeGamepassDetails | null> {
  const body = await bridgeFetch(`/check-pass?id=${encodeURIComponent(gamepassId)}`);
  if (!body) return null;
  const data = (body.data as BridgeGamepassDetails | null | undefined) ?? null;
  return data?.validationSkipped ? null : data;
}
