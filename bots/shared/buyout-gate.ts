/* ─────────────────────────────────────────────────────────────────────────────
   Гейт выкупа: два правила владельца (21.09.2026), закреплённые в коде.

   Оба родились из разбора застрявших заказов. Раньше это была ручная проверка
   перед каждым выкупом; теперь свип метит рискованные заказы заморозкой, а
   заморозку уважают ВСЕ пути выкупа (`assertOrderNotHeld`) — то же самое, что
   делали руками, но без человека и без пропусков.

   Правило 1 — «плохой отзыв до выкупа → не выкупать». Покупатель, оставивший
   на Wildberries отзыв на 1–3 звезды по нашему товару, выкуп не получает:
   деньги ему уже, по сути, вернут, а мы бы потратили робуксы донора впустую.
   Совпадение — по имени покупателя + тому же `nmId` + оценке ≤3, и отзыв не
   раньше заказа (минус запас в 3 дня на часовые пояса WB). Имя на WB не уникально,
   поэтому это «замок с предупреждением»: заморозку всегда можно снять руками, но
   по умолчанию такой заказ выкупать нельзя.

   Правило 2 — «старый висяк без ответа → сначала подтверждение». Заказ, который
   висит дольше `STALE_BUYOUT_DAYS` и до сих пор не выкуплен, замораживается до
   подтверждения актуальности: «если бы человеку было надо, он бы вышел на связь».
   Разморозка после «да» покупателя — обычная кнопка «Вернуть к выкупу».

   Модуль без зависимостей от Prisma-клиента напрямую: сверка (`matchBadReview`,
   `isStaleForBuyout`) — чистые функции с юнит-тестами, а свип получает и базу, и
   заморозку, и загрузчик отзывов снаружи.
   ───────────────────────────────────────────────────────────────────────── */

/** Сколько дней заказ может ждать выкупа, прежде чем потребует подтверждения. */
export const STALE_BUYOUT_DAYS = 21;

/** Оценка WB, ниже или равная которой отзыв считается плохим. */
export const BAD_REVIEW_MAX_STARS = 3;

/** Максимум заморозок за один прогон свипа — защита от бурста на первом запуске. */
export const GATE_FREEZE_CAP = 25;

/** Отзыв Wildberries в том виде, в каком его отдаёт feedbacks-api. */
export interface WbFeedback {
  productValuation?: number;
  userName?: string;
  nmId?: number;
  productDetails?: { nmId?: number };
  text?: string;
  createdDate?: string;
}

/** Заказ в терминах, которые нужны гейту (склеены из `WbOrder` + DBS-карточки). */
export interface GateOrder {
  wbCode: string;
  createdAt: Date;
  /** `nmId` товара WB — только у DBS-заказов; без него отзыв не сверить. */
  nmId: number | null;
  /** Имя покупателя из чата WB — только у DBS; без него отзыв не сверить. */
  buyerName: string | null;
}

export function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Висит ли заказ дольше порога (правило 2). */
export function isStaleForBuyout(createdAt: Date, now: number = Date.now()): boolean {
  return now - createdAt.getTime() > STALE_BUYOUT_DAYS * 86_400_000;
}

/**
 * Плохой отзыв покупателя ЭТОГО заказа (правило 1) или `null`.
 *
 * Требует и имя, и `nmId` — без любого из них сверять не с чем, и мы честно
 * ничего не блокируем (для не-DBS заказов отзыв недоступен). Дата отзыва не
 * раньше даты заказа минус 3 дня: чужой старый отзыв того же тёзки на тот же
 * товар не должен задним числом хоронить свежий заказ.
 */
export function matchBadReview(order: GateOrder, feedbacks: WbFeedback[]): WbFeedback | null {
  if (!order.nmId || !order.buyerName) return null;
  const name = normalizeName(order.buyerName);
  if (name.length < 2) return null;
  const floor = order.createdAt.getTime() - 3 * 86_400_000;
  for (const f of feedbacks) {
    if (Number(f.productValuation ?? 5) > BAD_REVIEW_MAX_STARS) continue;
    const nm = Number(f.productDetails?.nmId ?? f.nmId ?? 0);
    if (nm !== order.nmId) continue;
    if (normalizeName(f.userName) !== name) continue;
    const dt = f.createdDate ? Date.parse(f.createdDate) : NaN;
    if (Number.isFinite(dt) && dt < floor) continue;
    return f;
  }
  return null;
}

/** Что гейт решил сделать с заказом (для лога и уведомления). */
export interface GateDecision {
  wbCode: string;
  reason: string;
  rule: "bad_review" | "stale";
}

/**
 * Решение гейта по одному заказу: заморозить или пропустить.
 *
 * Плохой отзыв старше висяка по приоритету — причина в заморозке важнее.
 * Чистая функция: свип ниже только применяет её результат.
 */
export function decideGate(order: GateOrder, feedbacks: WbFeedback[], now: number = Date.now()): GateDecision | null {
  const bad = matchBadReview(order, feedbacks);
  if (bad) {
    const stars = Number(bad.productValuation ?? 0);
    const when = bad.createdDate ? String(bad.createdDate).slice(0, 10) : "?";
    return {
      wbCode: order.wbCode,
      rule: "bad_review",
      reason: `плохой отзыв WB (${order.buyerName}, ★${stars}, ${when}) — выкуп запрещён до ручной проверки`,
    };
  }
  if (isStaleForBuyout(order.createdAt, now)) {
    const days = Math.floor((now - order.createdAt.getTime()) / 86_400_000);
    return {
      wbCode: order.wbCode,
      rule: "stale",
      reason: `заказ висит ${days} дн. без выкупа — подтвердите актуальность у покупателя перед выкупом`,
    };
  }
  return null;
}

/** Зависимости свипа — всё, что трогает мир, приходит снаружи (тестируемость). */
export interface BuyoutGateDeps {
  /** Заказы, которые сейчас можно выкупить и которые ещё ни разу не морозили. */
  loadBuyableOrders: () => Promise<GateOrder[]>;
  /** Плохие отзывы (оценка ≤ 3) со всего кабинета. */
  loadNegativeFeedbacks: () => Promise<WbFeedback[]>;
  /** Заморозить заказ по коду (тот же `holdByCode`, что у ручной заморозки). */
  freeze: (wbCode: string, reason: string) => Promise<void>;
  now?: number;
  /** Флаг: гейт можно выключить, не трогая остальную синхронизацию. */
  enabled?: boolean;
}

export interface BuyoutGateResult {
  checked: number;
  frozen: GateDecision[];
  skippedByCap: number;
}

/**
 * Один прогон гейта: пометить заморозкой заказы, которые нельзя выкупать без
 * вмешательства. Идемпотентен по построению — `loadBuyableOrders` отдаёт только
 * НИКОГДА не морозившиеся заказы (у уже размороженных остаётся запись
 * `OrderHold`, и второй раз мы их не трогаем, иначе снятая руками заморозка
 * возвращалась бы на следующем прогоне).
 */
export async function runBuyoutGate(deps: BuyoutGateDeps): Promise<BuyoutGateResult> {
  const now = deps.now ?? Date.now();
  const result: BuyoutGateResult = { checked: 0, frozen: [], skippedByCap: 0 };
  if (deps.enabled === false) return result;

  const orders = await deps.loadBuyableOrders();
  result.checked = orders.length;
  if (orders.length === 0) return result;

  // Отзывы тянем один раз на прогон и только если есть кого проверять.
  const feedbacks = await deps.loadNegativeFeedbacks().catch(() => [] as WbFeedback[]);

  for (const order of orders) {
    const decision = decideGate(order, feedbacks, now);
    if (!decision) continue;
    if (result.frozen.length >= GATE_FREEZE_CAP) {
      result.skippedByCap += 1;
      continue;
    }
    await deps.freeze(decision.wbCode, decision.reason);
    result.frozen.push(decision);
  }
  return result;
}
