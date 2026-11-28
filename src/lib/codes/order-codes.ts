import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptActivationCode } from "@/lib/codes/secrets";

/**
 * Все коды заказа (20.11.2026): «2 000 R$» — два кода по 1 000, остальные — один.
 *
 * Код закреплён за заказом через `ActivationCode.reservedForOrderId` + статус
 * ISSUED (так пишут и склад, и ручная выдача); `CodeOrder.activationCodeId`
 * указывает на первый код набора и остаётся признаком «выдан».
 * Порядок — по времени добавления, стабилен для письма, чата и кабинета.
 *
 * Бросает, если код не расшифровался: вызывающий решает, что сказать человеку.
 */

/** Разделитель кодов в ответах API — клиент показывает их по отдельности. */
export const CODE_LIST_SEPARATOR = "\n";

type Db = Prisma.TransactionClient | typeof prisma;

export async function issuedCodesForOrder(orderId: string, db: Db = prisma): Promise<string[]> {
  const rows = await db.activationCode.findMany({
    where: { reservedForOrderId: orderId, status: "ISSUED" },
    orderBy: [{ issuedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { encryptedValue: true },
  });
  if (rows.length) return rows.map((row) => decryptActivationCode(row.encryptedValue));
  // Запасной путь — как было до наборов: код, на который указывает заказ
  // (старые/ручные записи без `reservedForOrderId` или с другим статусом кода).
  const order = await db.codeOrder.findUnique({ where: { id: orderId }, select: { activationCode: { select: { encryptedValue: true } } } });
  return order?.activationCode ? [decryptActivationCode(order.activationCode.encryptedValue)] : [];
}
