/**
 * 🚫 Аннулирование кода гейта — «деньги вернулись, код больше не работает».
 *
 * Зачем это существует
 * ────────────────────
 * Отмена заказа на Wildberries возвращает покупателю деньги. Код гейта при этом
 * оставался полностью рабочим: ни одна точка активации — сайт, вход по коду,
 * TG, VK, чат WB, кросс-платформенный клейм — не смотрела на `cancelledAt`.
 * Живой случай `XKFFJUU` (WB #5722328333, 12.09.2026): WB вернул 453 ₽, а код
 * на 500 R$ остался `AVAILABLE` и ждал, когда его кто-нибудь предъявит.
 *
 * Вторая половина той же дыры — консоль. Отменённый заказ с выпущенным кодом
 * `wbCancelledCodeAtRisk` намеренно держит в «Нужна проверка», но выйти оттуда
 * было нельзя: снятие требовало `internalStatus ∈ {COMPLETED, REJECTED}`, то
 * есть код сначала должен был быть активирован. Чтобы погасить алерт, надо было
 * впустить призрака. `REVOKED` при этом лежал в схеме и в подписях консоли и не
 * ставился ниоткуда.
 *
 * Две защёлки, а не одна
 * ──────────────────────
 * 1. `WbCode.status = REVOKED` + `WbMarketplaceOrder.gateState = REVOKED` —
 *    отказ на входе, с человеческим текстом покупателю.
 * 2. Заморозка по коду (`OrderHold`) — та же запись, что ставит оператор руками.
 *    Она блокирует ВЫКУП во всех путях сразу (`assertOrderNotHeld`, `NOT_HELD`,
 *    `activeHoldCodes`, крон-свип, подстановка пасса из чата WB) и уже покрыта
 *    тестами. Если новая дверь активации появится без гарда — робуксы всё
 *    равно не уйдут.
 *
 * Одна защёлка была бы дешевле. Но первая живёт на девяти дверях, а вторая —
 * на одной кассе, и цена ошибки здесь — номинал заказа в робуксах.
 *
 * Ядро лежит в `bots/shared`, потому что боты не умеют импортировать из `src/`
 * (так же живут `order-hold.ts` и `wb-order-source.ts`); веб переэкспортирует
 * его из `src/lib/wb-code-revocation.ts`.
 */

import { holdByCode, releaseByCode } from "./order-hold";

/** Статус кода, при котором активация запрещена. */
export const REVOKED_CODE_STATUS = "REVOKED" as const;

/** Состояния гейта, в которых существует предъявительский код. */
const GATE_MINTED = new Set(["ISSUED", "SENDING", "SENT", "SEND_UNKNOWN"]);

/** Внутренние статусы, при которых аннулировать можно: робуксы не потрачены. */
const INTERNAL_SAFE_TO_REVOKE = new Set(["REJECTED"]);

/**
 * Причина заморозки, которую ставит аннулирование.
 *
 * Текст фиксированный: по нему в ленте заказов видно, что заморозка не ручная,
 * а следствие возврата денег, и снимать её просто так не нужно.
 */
export function revocationHoldReason(wbOrderId: string): string {
  return `Заказ WB #${wbOrderId} отменён — деньги вернулись покупателю, код аннулирован`;
}

/** Отказ покупателю на входе. Один и тот же текст на сайте, в TG и в VK.
 *
 * Формулировка намеренно не обвиняет: человек мог и не подавать заявку (за него
 * это сделал тот, кто дарил карту), а отмену на WB он мог не связать с кодом. */
export const REVOKED_CODE_REFUSAL =
  "Этот код больше не действует: заказ на Wildberries был отменён и деньги вернулись покупателю. " +
  "Если это ошибка — напиши нам, разберёмся.";

export interface RevocableCode {
  status?: string | null;
}

/** Аннулирован ли код. Единственный предикат — копий заводить нельзя. */
export function isRevokedCode(code: RevocableCode | null | undefined): boolean {
  return code?.status === REVOKED_CODE_STATUS;
}

/**
 * Гард активации: можно ли пускать этот код дальше.
 *
 * Возвращает `null`, когда можно, и текст отказа, когда нельзя. Текст, а не
 * исключение: у девяти дверей девять разных способов ответить человеку
 * (JSON, `ctx.reply`, редирект), и бросать из общего ядра значило бы
 * переписывать обработку ошибок в каждой из них.
 *
 * Никогда не бросает: недоступная база не имеет права превратить активацию
 * оплаченного заказа в отказ. Цена ошибки несимметрична — пропущенный призрак
 * стоит номинал, а ложный отказ стоит клиента.
 */
export async function codeActivationRefusal(db: any, code: string): Promise<string | null> {
  const normalized = (code ?? "").trim();
  if (!normalized) return null;
  try {
    const row = await db.wbCode.findFirst({
      where: { code: { equals: normalized, mode: "insensitive" } },
      select: { status: true },
    });
    return isRevokedCode(row) ? REVOKED_CODE_REFUSAL : null;
  } catch {
    return null;
  }
}

export interface RevokeInput {
  /** `WbMarketplaceOrder.id` — по нему пишется аудит. */
  marketplaceOrderId: string;
  wbOrderId: string;
  /** Кто аннулирует: `wb-sync` для авто, имя оператора для кнопки. */
  actor: string;
}

export type RevokeResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

/**
 * Аннулировать код отменённого заказа.
 *
 * Идемпотентна: повторный вызов на уже аннулированном коде возвращает `ok`.
 * Отказывает, если робуксы могли быть потрачены — это решение оператора, а не
 * автоматики (тот же принцип, что у `canAutoRejectInternalOrder`).
 */
export async function revokeGateCode(db: any, input: RevokeInput): Promise<RevokeResult> {
  const order = await db.wbMarketplaceOrder.findUnique({
    where: { id: input.marketplaceOrderId },
    select: {
      id: true,
      cancelledAt: true,
      gateState: true,
      wbCode: { select: { id: true, code: true, status: true, isUsed: true } },
    },
  });
  if (!order) return { ok: false, error: "Заказ не найден" };
  if (!order.wbCode) return { ok: false, error: "По заказу не выпускался код гейта" };

  const code = order.wbCode.code;
  if (isRevokedCode(order.wbCode)) return { ok: true, code };

  if (!order.cancelledAt) {
    return { ok: false, error: "Заказ не отменён на WB — аннулировать нечего" };
  }
  if (!GATE_MINTED.has(order.gateState)) {
    return { ok: false, error: "Код не выпускался или уже закрыт" };
  }

  const internal = await db.wbOrder.findUnique({
    where: { wbCode: code },
    select: { status: true },
  });
  if (internal && !INTERNAL_SAFE_TO_REVOKE.has(internal.status)) {
    return {
      ok: false,
      error: `По коду есть заказ в статусе ${internal.status} — сначала закройте его во вкладке «Заказы»`,
    };
  }

  await db.wbCode.update({
    where: { id: order.wbCode.id },
    data: { status: REVOKED_CODE_STATUS },
  });
  await db.wbMarketplaceOrder.update({
    where: { id: order.id },
    data: { gateState: REVOKED_CODE_STATUS },
  });
  // Вторая защёлка. Не валит аннулирование: статус кода уже закрыл дверь.
  await holdByCode(db, {
    wbCode: code,
    reason: revocationHoldReason(input.wbOrderId),
    actor: input.actor,
  }).catch(() => undefined);

  return { ok: true, code };
}

/**
 * Снять аннулирование — на случай, когда отмена на WB оказалась ошибкой.
 *
 * Кнопки для этого нет намеренно: отмена заказа на WB означает возвращённые
 * деньги, и возврат кода в оборот — это решение владельца, а не операторский
 * клик. Путь — `scripts/revoke-gate.mjs --code XXX --release --apply`.
 */
export async function restoreGateCode(db: any, input: RevokeInput): Promise<RevokeResult> {
  const order = await db.wbMarketplaceOrder.findUnique({
    where: { id: input.marketplaceOrderId },
    select: { id: true, gateState: true, wbCode: { select: { id: true, code: true, status: true } } },
  });
  if (!order?.wbCode) return { ok: false, error: "По заказу не выпускался код гейта" };
  const code = order.wbCode.code;
  if (!isRevokedCode(order.wbCode)) return { ok: true, code };

  await db.wbCode.update({
    where: { id: order.wbCode.id },
    // Код возвращается предъявителю ровно в том виде, в каком был выдан: до
    // активации он `AVAILABLE`, владельца у него нет.
    data: { status: "AVAILABLE" },
  });
  await db.wbMarketplaceOrder.update({ where: { id: order.id }, data: { gateState: "SENT" } });
  await releaseByCode(db, { wbCode: code, actor: input.actor }).catch(() => undefined);
  return { ok: true, code };
}
