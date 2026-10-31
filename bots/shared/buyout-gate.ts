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

   С 30.10.2026 правило 1 смотрит на ВСЕ невыкупленные DBS-заказы (и даже на
   код, по которому заказа ещё нет), а не только на `PENDING` с пассом: злые
   отзывы пишут как раз застрявшие на создании пасса. Каждая такая заморозка
   уходит админам отдельным сообщением с текстом отзыва.

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
  id?: string;
  productValuation?: number;
  userName?: string;
  nmId?: number;
  productDetails?: { nmId?: number };
  text?: string;
  pros?: string;
  cons?: string;
  createdDate?: string;
  /** Правка отзыва у WB — новый отзыв: у старой версии `childFeedbackId`,
   *  у новой `parentFeedbackId`. Решает только последняя версия. */
  parentFeedbackId?: string | null;
  childFeedbackId?: string | null;
}

/** Заказ в терминах, которые нужны гейту (склеены из `WbOrder` + DBS-карточки). */
export interface GateOrder {
  wbCode: string;
  createdAt: Date;
  /** `nmId` товара WB — только у DBS-заказов; без него отзыв не сверить. */
  nmId: number | null;
  /** Имя покупателя из чата WB — только у DBS; без него отзыв не сверить. */
  buyerName: string | null;
  /**
   * Проверять ли правило 2 (висяк). Только у `PENDING` с пассом: заказ без
   * пасса «висит» по вине покупателя, и подтверждение там бессмысленно.
   * С 30.10.2026 гейт видит и такие заказы — ради правила 1 (W3QKRAA: ★1
   * на шаге «создайте пасс», заморозка пришла только с заявкой на возврат).
   * По умолчанию — проверять.
   */
  staleCheck?: boolean;
}

export function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Висит ли заказ дольше порога (правило 2). */
export function isStaleForBuyout(createdAt: Date, now: number = Date.now()): boolean {
  return now - createdAt.getTime() > STALE_BUYOUT_DAYS * 86_400_000;
}

/**
 * Последняя ли это версия отзыва. Покупатель, переписавший ★1 на ★5, оставляет
 * у WB обе записи, связанные `childFeedbackId`; считаться должна свежая.
 * Ссылка на версию, которой нет в выдаче, — значит, мы её не видим: тогда
 * доверяем той, что есть (иначе потерянная страница API снимала бы замки).
 */
function isCurrentVersion(f: WbFeedback, byId: Map<string, WbFeedback>): boolean {
  return !f.childFeedbackId || !byId.has(f.childFeedbackId);
}

function indexById(feedbacks: WbFeedback[]): Map<string, WbFeedback> {
  const byId = new Map<string, WbFeedback>();
  for (const f of feedbacks) if (f.id) byId.set(f.id, f);
  return byId;
}

/** Отзывы покупателя этого заказа (имя + товар + не раньше заказа −3 дня),
 *  только последние версии. Пусто, если сверять не с чем (не-DBS заказ). */
function buyerCurrentReviews(order: GateOrder, feedbacks: WbFeedback[], byId: Map<string, WbFeedback>): WbFeedback[] {
  if (!order.nmId || !order.buyerName) return [];
  const name = normalizeName(order.buyerName);
  if (name.length < 2) return [];
  const floor = order.createdAt.getTime() - 3 * 86_400_000;
  return feedbacks.filter((f) => {
    if (!isCurrentVersion(f, byId)) return false;
    if (Number(f.productDetails?.nmId ?? f.nmId ?? 0) !== order.nmId) return false;
    if (normalizeName(f.userName) !== name) return false;
    const dt = f.createdDate ? Date.parse(f.createdDate) : NaN;
    return !(Number.isFinite(dt) && dt < floor);
  });
}

const isBad = (f: WbFeedback) => Number(f.productValuation ?? 5) <= BAD_REVIEW_MAX_STARS;

/**
 * Плохой отзыв покупателя ЭТОГО заказа (правило 1) или `null`.
 *
 * Требует и имя, и `nmId` — без любого из них сверять не с чем, и мы честно
 * ничего не блокируем (для не-DBS заказов отзыв недоступен). Дата отзыва не
 * раньше даты заказа минус 3 дня: чужой старый отзыв того же тёзки на тот же
 * товар не должен задним числом хоронить свежий заказ. Смотрим только
 * последнюю версию: ★1, переписанная на ★5, плохой больше не считается.
 */
export function matchBadReview(order: GateOrder, feedbacks: WbFeedback[]): WbFeedback | null {
  const byId = indexById(feedbacks);
  return buyerCurrentReviews(order, feedbacks, byId).find(isBad) ?? null;
}

/** Плохой отзыв, переписанный на хороший: последняя версия и худшая из прежних. */
export interface FixedReview {
  review: WbFeedback;
  was: WbFeedback;
}

/**
 * Покупатель исправил отзыв (★1 → ★5) — повод снять заморозку гейта.
 *
 * Только если у покупателя не осталось ни одного плохого актуального отзыва:
 * тёзка с ★5 не должен размораживать того, кто так и стоит на ★1.
 */
export function matchFixedReview(order: GateOrder, feedbacks: WbFeedback[]): FixedReview | null {
  const byId = indexById(feedbacks);
  const current = buyerCurrentReviews(order, feedbacks, byId);
  if (current.some(isBad)) return null;
  for (const review of current) {
    let worst: WbFeedback | null = null;
    let cursor = review.parentFeedbackId ? byId.get(review.parentFeedbackId) : undefined;
    for (let hops = 0; cursor && hops < 20; hops += 1) {
      if (isBad(cursor) && (!worst || Number(cursor.productValuation) < Number(worst.productValuation))) worst = cursor;
      cursor = cursor.parentFeedbackId ? byId.get(cursor.parentFeedbackId) : undefined;
    }
    if (worst) return { review, was: worst };
  }
  return null;
}

/** Начало причины заморозки по отзыву — по нему свип узнаёт свои замки. */
export const BAD_REVIEW_REASON_HEAD = "плохой отзыв WB";

/** Кто ставит заморозку гейта — так она подписана в заметке и в `OrderHold`. */
export const GATE_ACTOR = "гейт выкупа";

/** Заморозку поставил гейт по отзыву, и с тех пор её никто не перебил
 *  (заявка или человек переписывают `createdBy`/причину) — её гейт и снимает. */
export function isGateReviewHold(hold: { reason: string; createdBy: string }): boolean {
  return hold.createdBy === GATE_ACTOR && hold.reason.startsWith(BAD_REVIEW_REASON_HEAD);
}

/** Что гейт решил сделать с заказом (для лога и уведомления). */
export interface GateDecision {
  wbCode: string;
  reason: string;
  rule: "bad_review" | "stale";
  /** Сам отзыв — для уведомления админам (только у `bad_review`). */
  review?: WbFeedback;
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
      review: bad,
      reason: `${BAD_REVIEW_REASON_HEAD} (${order.buyerName}, ★${stars}, ${when}) — выкуп запрещён до ручной проверки`,
    };
  }
  if (order.staleCheck !== false && isStaleForBuyout(order.createdAt, now)) {
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
  /** Заказы под заморозкой гейта по отзыву — кандидаты на разморозку. */
  loadReviewHolds?: () => Promise<GateOrder[]>;
  /** Все отзывы кабинета; `complete=false` — часть выдачи не пришла. */
  loadFeedbacks: () => Promise<{ feedbacks: WbFeedback[]; complete: boolean }>;
  /** Заморозить заказ по коду (тот же `holdByCode`, что у ручной заморозки). */
  freeze: (wbCode: string, reason: string) => Promise<void>;
  /** Снять заморозку гейта (тот же `releaseByCode`, что у кнопки). */
  release?: (wbCode: string) => Promise<void>;
  now?: number;
  /** Флаг: гейт можно выключить, не трогая остальную синхронизацию. */
  enabled?: boolean;
}

export interface GateRelease extends FixedReview {
  wbCode: string;
}

export interface BuyoutGateResult {
  checked: number;
  frozen: GateDecision[];
  released: GateRelease[];
  skippedByCap: number;
}

/**
 * Один прогон гейта: пометить заморозкой заказы, которые нельзя выкупать без
 * вмешательства, и снять свои же замки с тех, кто исправил отзыв.
 *
 * Идемпотентен по построению — `loadBuyableOrders` отдаёт только заказы без
 * активной заморозки и без снятой руками (снятая человеком возвращалась бы на
 * следующем прогоне), а `loadReviewHolds` — только замки самого гейта.
 * Размораживаем лишь по ПОЛНОЙ выдаче отзывов: потерянной страницей могла
 * оказаться как раз свежая ★1.
 */
export async function runBuyoutGate(deps: BuyoutGateDeps): Promise<BuyoutGateResult> {
  const now = deps.now ?? Date.now();
  const result: BuyoutGateResult = { checked: 0, frozen: [], released: [], skippedByCap: 0 };
  if (deps.enabled === false) return result;

  const orders = await deps.loadBuyableOrders();
  const holds = deps.loadReviewHolds && deps.release ? await deps.loadReviewHolds() : [];
  result.checked = orders.length;
  if (orders.length === 0 && holds.length === 0) return result;

  // Отзывы тянем один раз на прогон и только если есть кого проверять.
  const { feedbacks, complete } = await deps.loadFeedbacks()
    .catch(() => ({ feedbacks: [] as WbFeedback[], complete: false }));

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

  if (complete && deps.release) {
    for (const order of holds) {
      const fixed = matchFixedReview(order, feedbacks);
      if (!fixed) continue;
      await deps.release(order.wbCode);
      result.released.push({ wbCode: order.wbCode, ...fixed });
    }
  }
  return result;
}
