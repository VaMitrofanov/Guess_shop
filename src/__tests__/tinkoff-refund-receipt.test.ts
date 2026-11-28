/**
 * U7: чек при возврате. Матрица ККТ в docs/payments-and-kkt.md утверждала
 * «частичный и затем остаток → 2 корректных чека ✅», хотя роут передавал
 * остаток вместо полной суммы платежа, и второй возврат уходил БЕЗ `Receipt`.
 * Банк в этом случае формирует закрывающий чек на всю исходную сумму: платёж
 * 1000 ₽ → возвраты 400 + 600 → фискально 400 + 1000 = 1400 ₽.
 */

import { refundNeedsReceipt } from "../lib/tinkoff";

const PAYMENT = 100_000; // 1000 ₽ в копейках

describe("refundNeedsReceipt", () => {
  it("полный возврат первым же действием — чек формирует банк", () => {
    expect(
      refundNeedsReceipt({
        amountKopecks: PAYMENT,
        totalAmountKopecks: PAYMENT,
        alreadyRefundedKopecks: 0,
      }),
    ).toBe(false);
  });

  it("частичный возврат — чек ровно на возвращаемую часть", () => {
    expect(
      refundNeedsReceipt({
        amountKopecks: 40_000,
        totalAmountKopecks: PAYMENT,
        alreadyRefundedKopecks: 0,
      }),
    ).toBe(true);
  });

  it("остаток после частичного — чек обязателен (регресс U7)", () => {
    expect(
      refundNeedsReceipt({
        amountKopecks: 60_000,
        totalAmountKopecks: PAYMENT,
        alreadyRefundedKopecks: 40_000,
      }),
    ).toBe(true);
  });

  it("сумма фискальных возвратов равна платежу в сценарии 400 + 600", () => {
    const steps = [
      { amountKopecks: 40_000, alreadyRefundedKopecks: 0 },
      { amountKopecks: 60_000, alreadyRefundedKopecks: 40_000 },
    ];
    const receiptTotal = steps
      .filter((s) => refundNeedsReceipt({ ...s, totalAmountKopecks: PAYMENT }))
      .reduce((sum, s) => sum + s.amountKopecks, 0);

    // Оба возврата идут с собственным чеком, банк ничего не дорисовывает.
    expect(receiptTotal).toBe(PAYMENT);
  });
});
