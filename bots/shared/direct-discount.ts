import type { PrismaClient } from "@prisma/client";

/**
 * Скидка 60 ₽ на вторую прямую покупку — единственное место, где она решается.
 *
 * Раньше правило жило двумя одинаковыми копиями (`bots/tg/handlers.ts` и
 * `src/lib/twa-notify.ts`) и звучало как «каждый завершённый прямой заказ
 * меньше 500 R$ начисляет 60 ₽». Заказ на 100 R$ сам меньше 500, так что петля
 * замыкалась на себе: скидка → заказ за 84 ₽ вместо 144 ₽ → завершение → снова
 * скидка. Один клиент прошёл её пять раз подряд.
 *
 * Правило владельца от 20.08.2026:
 *
 *   Скидка даётся ОДИН раз за всё время, на вторую прямую покупку, и только
 *   если на первом прямом заказе покупатель не воспользовался бонусом
 *   в 100 R$ — и этот первый заказ был меньше 500 R$.
 *
 *   а) бонус на первом заказе активирован        → второй заказ по фулл-прайсу
 *   б) первый заказ < 500 R$, бонус не активирован → 60 ₽ на второй заказ
 *   в) первый заказ ≥ 500 R$, бонус не активирован → скидки нет
 *
 * Смысл (б) и (в): маленький первый заказ — единственный случай, когда бонусом
 * толком нельзя было воспользоваться, и рубли заменяют его. Отказ от бонуса на
 * крупном заказе — выбор покупателя, а не наша недоработка.
 */

export const DIRECT_DISCOUNT_RUBLES = 60;

/** Первый прямой заказ должен быть строго меньше этого номинала (правило «б»). */
export const DIRECT_DISCOUNT_MAX_FIRST_ORDER_ROBUX = 500;

export type DirectDiscountRefusal =
  | "not_direct"
  | "already_granted"
  | "not_first_direct_order"
  | "bonus_used"
  | "first_order_too_large";

export type DirectDiscountDecision =
  | { granted: true; rubles: number }
  | { granted: false; reason: DirectDiscountRefusal };

export type DirectDiscountFacts = {
  /** Завершённый прямо сейчас заказ — прямой? */
  isDirectOrder: boolean;
  /** Номинал этого заказа в R$. */
  amount: number;
  /** Бонусных робуксов списано на этот заказ. */
  bonusAppliedRobux: number;
  /** Сколько прямых заказов пользователя уже COMPLETED, включая этот. */
  completedDirectOrders: number;
  /** Когда скидка уже выдавалась. `null` — ни разу. */
  grantedAt: Date | null;
};

/**
 * Чистое решение — без БД, чтобы правило можно было прочитать и проверить
 * целиком. Порядок проверок = порядок причин в отказе: сначала то, что вообще
 * выводит заказ из игры, потом условия самого правила.
 */
export function decideDirectDiscount(facts: DirectDiscountFacts): DirectDiscountDecision {
  if (!facts.isDirectOrder) return { granted: false, reason: "not_direct" };
  if (facts.grantedAt) return { granted: false, reason: "already_granted" };
  // Скидка живёт на ВТОРОЙ покупке, поэтому выдаётся в момент завершения
  // первой. Если завершённых прямых заказов уже больше одного, момент прошёл.
  if (facts.completedDirectOrders !== 1) return { granted: false, reason: "not_first_direct_order" };
  if (facts.bonusAppliedRobux > 0) return { granted: false, reason: "bonus_used" };
  if (facts.amount >= DIRECT_DISCOUNT_MAX_FIRST_ORDER_ROBUX) {
    return { granted: false, reason: "first_order_too_large" };
  }
  return { granted: true, rubles: DIRECT_DISCOUNT_RUBLES };
}

/** Один и тот же клиент у ботов (`bots/shared/db`) и у веба (`src/lib/prisma`),
 * поэтому обе поверхности исполняют этот файл, а не свою копию правила. */
type DiscountDb = PrismaClient;

/**
 * Считает факты по заказу и, если правило сошлось, начисляет скидку.
 *
 * Начисление идёт `updateMany` с условием `directDiscountGrantedAt: null` —
 * два параллельных завершения (бот и веб слушают одно и то же событие) дадут
 * ровно одну скидку, а не две.
 *
 * Возвращает решение, чтобы вызывающий мог сказать покупателю правду: тексты
 * «дарим 60 ₽ на следующий заказ» показываются только при `granted`.
 */
export async function grantDirectDiscountOnCompletion(
  db: DiscountDb,
  input: { userId: string; orderId: string; amount: number; isDirectOrder: boolean },
): Promise<DirectDiscountDecision> {
  if (!input.isDirectOrder) return { granted: false, reason: "not_direct" };

  const [user, order, completedDirectOrders] = await Promise.all([
    db.user.findUnique({
      where: { id: input.userId },
      select: { directDiscountGrantedAt: true },
    }),
    db.wbOrder.findUnique({
      where: { id: input.orderId },
      select: { bonusAppliedRobux: true, amount: true },
    }),
    db.wbOrder.count({
      where: { userId: input.userId, isDirectOrder: true, status: "COMPLETED", isTest: false },
    }),
  ]);

  const facts: DirectDiscountFacts = {
    isDirectOrder: true,
    amount: order?.amount ?? input.amount,
    bonusAppliedRobux: await resolveBonusApplied(db, input.orderId, order?.bonusAppliedRobux ?? null),
    completedDirectOrders,
    grantedAt: user?.directDiscountGrantedAt ?? null,
  };

  const decision = decideDirectDiscount(facts);
  if (!decision.granted) return decision;

  const applied = await db.user.updateMany({
    where: { id: input.userId, directDiscountGrantedAt: null },
    data: { rubleDiscount: decision.rubles, directDiscountGrantedAt: new Date() },
  });
  // Проиграли гонку — скидку уже выдал другой канал. Ровно одна, как и задумано.
  if (applied.count !== 1) return { granted: false, reason: "already_granted" };
  return decision;
}

/**
 * Списан ли бонус на этом заказе.
 *
 * `bonusAppliedRobux` исторически писал только TG-путь, и у ранних заказов он
 * `null` — «неизвестно», а не «ноль». Принять `null` за ноль здесь дороже
 * всего: покупатель, который бонусом воспользовался, получил бы ещё и скидку.
 * Поэтому неизвестность добирается из журнала бонусов — он и есть единственная
 * точка правды по списаниям.
 */
async function resolveBonusApplied(
  db: DiscountDb,
  orderId: string,
  snapshot: number | null,
): Promise<number> {
  if (snapshot !== null) return snapshot;
  const redemptions = await db.bonusLedger.count({
    where: { referenceId: orderId, deltaRobux: { lt: 0 } },
  }).catch(() => 0);
  return redemptions > 0 ? 1 : 0;
}
