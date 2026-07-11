/**
 * П1 (отзывы-v2): единая проверка права на бонус за отзыв (TG + VK).
 *
 * Заказы юзера ищутся не только по WbOrder.userId, но и по кодам, которые он
 * активировал (WbCode.userId → WbOrder.wbCode): при кросс-платформенной
 * активации заказ может висеть на другом User-ряду, и поиск только по userId
 * давал ложное «нет выполненных заказов».
 *
 * Вместо одного catch-all ответа — три исхода: eligible (принимаем скрин),
 * already_granted (бонус уже на балансе — подсказываем, как потратить),
 * active_order (заказ ещё в работе — скрин после выкупа), none.
 */
import { db } from "./db";

export const REVIEW_BONUS_AMOUNT = 100;
export const REVIEW_BONUS_EXPIRY_DAYS = 30;

const ACTIVE_ORDER_STATUSES = [
  "AWAITING_PAYMENT",
  "PAYMENT_PENDING",
  "AWAITING_GAMEPASS",
  "PENDING",
  "IN_PROGRESS",
];

export type ReviewEligibility =
  | { kind: "eligible"; orderId: string }
  | { kind: "already_granted"; grantedAt: Date | null; expiresAt: Date | null; balance: number }
  | { kind: "active_order"; status: string; wbCode: string }
  | { kind: "none" };

export async function resolveReviewEligibility(user: {
  id: string;
  balance?: number | null;
  reviewBonusGrantedAt?: Date | string | null;
}): Promise<ReviewEligibility> {
  const codes = await (db as any).wbCode.findMany({
    where: { userId: user.id },
    select: { code: true },
  });
  const orderWhere = {
    OR: [
      { userId: user.id },
      ...(codes.length ? [{ wbCode: { in: codes.map((c: any) => c.code as string) } }] : []),
    ],
  };

  const completed = await (db as any).wbOrder.findMany({
    where: { ...orderWhere, status: "COMPLETED" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, wbCode: true },
  });

  const grantedAt = user.reviewBonusGrantedAt ? new Date(user.reviewBonusGrantedAt) : null;

  for (const order of completed) {
    const isDirect = (order.wbCode as string).startsWith("DIR-");
    if (isDirect) {
      // DIR-заказы без WbCode-ряда — гейт по user.reviewBonusGrantedAt.
      if (!grantedAt) return { kind: "eligible", orderId: order.id as string };
    } else {
      const linked = await (db as any).wbCode.findFirst({
        where: { code: order.wbCode, reviewBonusClaimed: false },
        select: { code: true },
      });
      if (linked) return { kind: "eligible", orderId: order.id as string };
    }
  }

  if (completed.length > 0) {
    return {
      kind: "already_granted",
      grantedAt,
      expiresAt: grantedAt
        ? new Date(grantedAt.getTime() + REVIEW_BONUS_EXPIRY_DAYS * 86_400_000)
        : null,
      balance: user.balance ?? 0,
    };
  }

  const active = await (db as any).wbOrder.findFirst({
    where: { ...orderWhere, status: { in: ACTIVE_ORDER_STATUSES } },
    orderBy: { createdAt: "desc" },
    select: { status: true, wbCode: true },
  });
  if (active) {
    return { kind: "active_order", status: active.status as string, wbCode: active.wbCode as string };
  }

  return { kind: "none" };
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
}

/**
 * Текст ответа для не-eligible исходов already_granted / active_order.
 * `html: true` — TG (жирный через <b>), `html: false` — VK (plain).
 * Исход none каждый бот отвечает своим существующим текстом.
 */
export function reviewIneligibleMessage(
  elig: Extract<ReviewEligibility, { kind: "already_granted" | "active_order" }>,
  opts: { html: boolean }
): string {
  const b = (s: string) => (opts.html ? `<b>${s}</b>` : s);

  if (elig.kind === "active_order") {
    return (
      `⏳ Твой заказ ещё в работе — как только выкупим, сразу пришлю уведомление.\n\n` +
      `Скрин отзыва пришли после выкупа — получишь ${b(`+${REVIEW_BONUS_AMOUNT} R$`)} (действует на любой номинал).`
    );
  }

  if (elig.grantedAt && elig.expiresAt) {
    const balanceLine = elig.balance > 0
      ? `💰 На балансе: ${b(`${elig.balance} R$`)} — действует до ${b(fmtDate(elig.expiresAt))}.\n\n`
      : "";
    return (
      `✅ Бонус ${b(`+${REVIEW_BONUS_AMOUNT} R$`)} за отзыв уже начислен ${fmtDate(elig.grantedAt)}!\n\n` +
      balanceLine +
      `Он добавится к любому прямому заказу автоматически — просто оформи заказ в боте (без карточки WB).`
    );
  }

  return (
    `✅ Бонус за отзыв по этому заказу уже был начислен — повторно за тот же заказ он не начисляется.\n\n` +
    `Новый заказ → новый отзыв → ещё +${REVIEW_BONUS_AMOUNT} R$ 😉`
  );
}
