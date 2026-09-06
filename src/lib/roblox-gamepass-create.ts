/**
 * Автосоздание геймпасса через мост — клиент RF Web (Part 1, ДОРМАНТ).
 *
 * Создание пасса нужно делать ТАМ, где Roblox доступен (SG-мост): с RF-хоста
 * `apis.roblox.com` молча висит (см. `src/lib/roblox-bridge.ts`). Поэтому здесь
 * только тонкий вызов мостового роута `POST /create-gamepass`, а вся работа с
 * Open Cloud — на мосту (`bots/shared/roblox.ts` → `createGamePassForUserDirect`).
 *
 * Ключ клиента (`apiKey`) уходит на мост по тому же защищённому каналу, что и
 * остальные мостовые вызовы (`x-validator-key`). НИКОГДА не логировать его.
 *
 * ДОРМАНТ: в клиентский флоу не подключён — метод вступает в силу только после
 * инструкции V2 и боевого прогона. См. docs/roblox-gamepass-autocreate.md.
 */

const CREATE_TIMEOUT_MS = 45_000;

export interface CreateGamePassViaBridgeParams {
  /** Open Cloud API-ключ клиента (API System `game-passes`: read + write). */
  apiKey: string;
  /** Цена в робуксах — то, ради чего всё затевается. */
  priceInRobux: number;
  /** Название (наше, не клиентское); по умолчанию нейтральное по номиналу. */
  name?: string;
  /** Явный universe, если известен. */
  universeId?: string | number;
  /** Явный placeId (мост резолвит в universe). */
  placeId?: string | number;
  /** Ник владельца — мост резолвит в его публичные experience'ы. */
  username?: string;
}

export interface CreateGamePassOutcome {
  ok: boolean;
  gamePassId?: number;
  universeId?: string;
  priceInRobux?: number;
  isForSale?: boolean;
  name?: string;
  /**
   * Машинный код ошибки:
   *   bad_scope       — ключ без `game-pass:write` (клиент выбрал не тот API System)
   *   not_authorized  — ключ не на этот experience (опыт чужой для ключа)
   *   no_universe     — не удалось определить experience
   *   bad_price       — цена вне диапазона
   *   roblox_error    — Roblox вернул ошибку
   *   network         — сеть/таймаут до Roblox
   *   bridge_unconfigured | bridge_unauthorized | bridge_error — проблема самого моста
   */
  error?: string;
  /** Человекочитаемая деталь для админа (без ключа). */
  detail?: string;
}

export function gamepassCreateBridgeConfigured(): boolean {
  return Boolean(process.env.VALIDATOR_SOURCE_URL?.trim());
}

/**
 * Создать покупаемый пасс нужного номинала на опыте клиента через мост.
 * Возвращает различимую ошибку вместо исключения — админ увидит, что именно
 * пошло не так (например, `not_authorized` = клиент выдал ключ не на тот опыт).
 */
export async function createGamePassViaBridge(
  params: CreateGamePassViaBridgeParams,
): Promise<CreateGamePassOutcome> {
  const base = process.env.VALIDATOR_SOURCE_URL?.trim();
  if (!base) {
    return { ok: false, error: "bridge_unconfigured", detail: "VALIDATOR_SOURCE_URL не задан" };
  }
  if (!params.apiKey?.trim()) {
    return { ok: false, error: "roblox_error", detail: "пустой apiKey" };
  }
  const key = process.env.VALIDATOR_KEY?.trim();
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/create-gamepass`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(key ? { "x-validator-key": key } : {}),
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
    });
    if (res.status === 401) {
      return { ok: false, error: "bridge_unauthorized", detail: "VALIDATOR_KEY расходится с мостом" };
    }
    // 404 = на мосту нет роута: значит там крутится сборка до Фазы 1. Отдельный
    // код, потому что лечится это деплоем ботов, а не действиями покупателя.
    if (res.status === 404) {
      return { ok: false, error: "bridge_error", detail: "мост не знает /create-gamepass — нужен деплой ботов" };
    }
    const body = (await res.json().catch(() => null)) as CreateGamePassOutcome | null;
    if (!body || typeof body.ok !== "boolean") {
      return { ok: false, error: "bridge_error", detail: `неожиданный ответ моста (HTTP ${res.status})` };
    }
    return body;
  } catch (err) {
    return { ok: false, error: "network", detail: err instanceof Error ? err.message : String(err) };
  }
}
