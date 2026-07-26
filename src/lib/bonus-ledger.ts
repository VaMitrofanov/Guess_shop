import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Единственная точка изменения бонусного баланса (ultra-review U3/U4,
 * риск №25 в docs/security.md).
 *
 * До этого `balance` правили в трёх местах разными способами: web-checkout
 * списывал через `decrement` и писал в `BonusLedger`, бот считал
 * `balance = user.balance + x` (read-modify-write, теряется при гонке) и в
 * леджер не писал вовсе, а компенсации при неудачной оплате не было нигде.
 * В итоге `BonusLedger` не был источником правды, и спор с клиентом закрыть
 * было нечем.
 *
 * Инварианты этой функции:
 *   1. баланс меняется только через `increment` — никаких read-modify-write;
 *   2. каждое движение оставляет строку в `BonusLedger`;
 *   3. ключ идемпотентности обязателен — повтор не удваивает начисление.
 */

export type BonusDeltaInput = {
  userId: string;
  /** Положительная — начисление/возврат, отрицательная — списание. */
  deltaRobux: number;
  reason: string;
  referenceId?: string | null;
  idempotencyKey: string;
  metadata?: Prisma.InputJsonValue;
};

export type BonusDeltaResult =
  | { applied: true; balanceAfter: number }
  | { applied: false; reason: "duplicate" | "insufficient" };

type TxClient = Prisma.TransactionClient;

/** Внутренняя реализация: обязана выполняться внутри транзакции. */
export async function applyBonusDeltaTx(
  tx: TxClient,
  input: BonusDeltaInput,
): Promise<BonusDeltaResult> {
  if (!Number.isInteger(input.deltaRobux) || input.deltaRobux === 0) {
    throw new Error(`[bonus-ledger] deltaRobux must be a non-zero integer, got ${input.deltaRobux}`);
  }

  const existing = await tx.bonusLedger.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { balanceAfter: true },
  });
  if (existing) return { applied: false, reason: "duplicate" };

  if (input.deltaRobux < 0) {
    // Списание не должно уводить баланс в минус — проверяем атомарно.
    const guarded = await tx.user.updateMany({
      where: { id: input.userId, balance: { gte: -input.deltaRobux } },
      data: { balance: { increment: input.deltaRobux } },
    });
    if (guarded.count !== 1) return { applied: false, reason: "insufficient" };
  } else {
    await tx.user.update({
      where: { id: input.userId },
      data: { balance: { increment: input.deltaRobux } },
    });
  }

  const after = await tx.user.findUnique({
    where: { id: input.userId },
    select: { balance: true },
  });
  const balanceAfter = after?.balance ?? 0;

  await tx.bonusLedger.create({
    data: {
      userId: input.userId,
      deltaRobux: input.deltaRobux,
      balanceAfter,
      reason: input.reason,
      referenceId: input.referenceId ?? null,
      idempotencyKey: input.idempotencyKey,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    },
  });

  return { applied: true, balanceAfter };
}

/** Обёртка для вызова вне уже открытой транзакции. */
export async function applyBonusDelta(input: BonusDeltaInput): Promise<BonusDeltaResult> {
  return prisma.$transaction((tx) => applyBonusDeltaTx(tx, input));
}

export const BONUS_REASONS = {
  WEB_ORDER_REDEMPTION: "WEB_ORDER_REDEMPTION",
  WEB_ORDER_REDEMPTION_REVERSED: "WEB_ORDER_REDEMPTION_REVERSED",
  DIRECT_ORDER_REDEMPTION: "DIRECT_ORDER_REDEMPTION",
  DIRECT_ORDER_REDEMPTION_REVERSED: "DIRECT_ORDER_REDEMPTION_REVERSED",
  REVIEW_BONUS: "REVIEW_BONUS",
} as const;

export function webOrderBonusKey(quoteId: string) {
  return `web-order-bonus:${quoteId}`;
}

export function webOrderBonusRevertKey(quoteId: string) {
  return `web-order-bonus-revert:${quoteId}`;
}

export function directOrderBonusKey(orderId: string) {
  return `direct-order-bonus:${orderId}`;
}

export function directOrderBonusRevertKey(orderId: string) {
  return `direct-order-bonus-revert:${orderId}`;
}
