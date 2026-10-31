#!/usr/bin/env node
/**
 * Corrects the 30.07 Anton batch that was charged with the mistaken NET model.
 * The Google Sheet is authoritative and calculates SUMPRODUCT(C, F) / 1000.
 *
 * Without flags this is a guarded dry-run. Pass --apply to write, in one
 * transaction, a visible REFUND, the corrected BUYOUT and the small historical
 * rounding ADJUSTMENT needed to make the ledger balance equal sheet J2.
 */
import pg from "pg";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const APPLY = process.argv.includes("--apply");
const ORIGINAL_BATCH = "bulk-done:1785370345485";
const EXPECTED = {
  amount: -30.75,
  robux: 8290,
  netRobux: 5802,
  items: 4,
  rate: 5.3,
  sheetCharge: 43.937,
  sheetBalance: 63.32905,
  purchaseRate: 4.7,
  supplierCost: 38.963,
  profit: 4.974,
  roundingAdjustment: 0.04605,
};
const IDS = {
  refund: "anton_refund_20260730_wrong_net_batch",
  buyout: "anton_buyout_20260730_sheet_formula",
  adjustment: "anton_adjustment_20260730_sheet_rounding",
};
const BATCHES = {
  refund: "correction:anton-net-reversal-20260730",
  buyout: "correction:anton-sheet-charge-20260730",
  adjustment: "correction:anton-sheet-rounding-20260730",
};
const OPERATOR = "codex: sheet formula correction 2026-07-30";
const round7 = (value) => Math.round((Number(value) + Number.EPSILON) * 10_000_000) / 10_000_000;
const close = (actual, expected, tolerance = 0.0000001) => Math.abs(Number(actual) - expected) <= tolerance;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const { rows: partners } = await client.query(`SELECT id FROM "Partner" WHERE slug = 'anton'`);
  if (partners.length !== 1) throw new Error("Партнёр anton не найден или не уникален");
  const partnerId = partners[0].id;

  const { rows: existingCorrections } = await client.query(
    `SELECT id FROM "PartnerLedgerEntry" WHERE id = ANY($1::text[])`,
    [Object.values(IDS)],
  );
  if (existingCorrections.length === Object.keys(IDS).length) {
    console.log("✅ Корректировка уже применена полностью; повторных записей не создано.");
    process.exitCode = 0;
  } else if (existingCorrections.length > 0) {
    throw new Error(`Найдена частичная корректировка: ${existingCorrections.map((row) => row.id).join(", ")}`);
  } else {
    const { rows: originals } = await client.query(
      `SELECT * FROM "PartnerLedgerEntry"
       WHERE "partnerId" = $1 AND "batchId" = $2 AND type = 'BUYOUT'`,
      [partnerId, ORIGINAL_BATCH],
    );
    if (originals.length !== 1) throw new Error(`Ожидалась одна исходная BUYOUT-запись, найдено ${originals.length}`);
    const original = originals[0];
    const guardsOk = close(original.amount, EXPECTED.amount)
      && Number(original.robuxAmount) === EXPECTED.robux
      && Number(original.netRobuxAmount) === EXPECTED.netRobux
      && Number(original.itemCount) === EXPECTED.items
      && close(original.rateUsdtPer1000, EXPECTED.rate)
      && original.rateBasis === "NET";
    if (!guardsOk) {
      throw new Error(`Исходная пачка не совпала с guard: amount=${original.amount}, robux=${original.robuxAmount}, net=${original.netRobuxAmount}, items=${original.itemCount}, rate=${original.rateUsdtPer1000}, basis=${original.rateBasis}`);
    }

    const { rows: [balanceRow] } = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::double precision AS balance
       FROM "PartnerLedgerEntry" WHERE "partnerId" = $1 AND currency = 'USDT'`,
      [partnerId],
    );
    const currentBalance = Number(balanceRow.balance);
    const balanceAfterFormulaCorrection = round7(currentBalance - original.amount - EXPECTED.sheetCharge);
    const adjustment = round7(EXPECTED.sheetBalance - balanceAfterFormulaCorrection);
    if (!close(adjustment, EXPECTED.roundingAdjustment)) {
      throw new Error(`Исторический drift ${adjustment} не совпал с ожидаемым ${EXPECTED.roundingAdjustment}; БД изменилась, нужна новая сверка`);
    }

    console.log(`Сейчас: ${currentBalance.toFixed(5)} USDT`);
    console.log(`Сторно ошибочного NET-списания: +${Math.abs(EXPECTED.amount).toFixed(5)} USDT`);
    console.log(`Правильное списание по SUMPRODUCT(C,F)/1000: -${EXPECTED.sheetCharge.toFixed(5)} USDT`);
    console.log(`Историческое построчное округление: +${adjustment.toFixed(5)} USDT`);
    console.log(`После: ${EXPECTED.sheetBalance.toFixed(5)} USDT (как J2 таблицы)`);

    if (!APPLY) {
      console.log("DRY-RUN: изменений нет. Для применения запусти с --apply.");
    } else {
      await client.query("BEGIN");
      try {
        await client.query(
          `INSERT INTO "PartnerLedgerEntry"
             (id, "partnerId", type, amount, currency, "rateUsdtPer1000",
              "purchaseRateUsdtPer1000", "rateBasis", "costBasis", "robloxFeePct",
              "grossRobuxAmount", "netRobuxAmount", "revenueUsdt", "expectedRevenueUsdt",
              "costUsdt", "profitUsdt", "robuxAmount", "purchaseAccountName", "batchId",
              "itemCount", reference, comment, "createdBy")
           VALUES
             ($1, $2, 'REFUND', $3, 'USDT', $4, $5, 'NET', 'RATE', 30,
              $6, $7, $8, $9, $10, $11, $6, $12, $13, $14, $15, $16, $17)`,
          [
            IDS.refund, partnerId, -Number(original.amount), Number(original.rateUsdtPer1000),
            Number(original.purchaseRateUsdtPer1000), -EXPECTED.robux, -EXPECTED.netRobux,
            -Number(original.revenueUsdt ?? Math.abs(original.amount)),
            -Number(original.expectedRevenueUsdt ?? Math.abs(original.amount)),
            -Number(original.costUsdt ?? EXPECTED.supplierCost),
            -Number(original.profitUsdt ?? 0), original.purchaseAccountName, BATCHES.refund,
            -EXPECTED.items, ORIGINAL_BATCH,
            "Сторно ошибочного списания: к номиналу таблицы был применён коэффициент 0.7",
            OPERATOR,
          ],
        );
        await client.query(
          `INSERT INTO "PartnerLedgerEntry"
             (id, "partnerId", type, amount, currency, "rateUsdtPer1000",
              "purchaseRateUsdtPer1000", "rateBasis", "costBasis", "robloxFeePct",
              "grossRobuxAmount", "netRobuxAmount", "revenueUsdt", "expectedRevenueUsdt",
              "costUsdt", "profitUsdt", "robuxAmount", "purchaseAccountName", "batchId",
              "itemCount", reference, comment, "createdBy")
           VALUES
             ($1, $2, 'BUYOUT', $3, 'USDT', $4, $5, 'DIRTY', 'RATE', 30,
              $6, $7, $8, $8, $9, $10, $6, $11, $12, $13, $14, $15, $16)`,
          [
            IDS.buyout, partnerId, -EXPECTED.sheetCharge, EXPECTED.rate, EXPECTED.purchaseRate,
            EXPECTED.robux, EXPECTED.netRobux, EXPECTED.sheetCharge, EXPECTED.supplierCost,
            EXPECTED.profit, original.purchaseAccountName, BATCHES.buyout, EXPECTED.items,
            ORIGINAL_BATCH, "Исправленное списание по формуле таблицы SUMPRODUCT(C,F)/1000", OPERATOR,
          ],
        );
        await client.query(
          `INSERT INTO "PartnerLedgerEntry"
             (id, "partnerId", type, amount, currency, "batchId", reference, comment, "createdBy")
           VALUES ($1, $2, 'ADJUSTMENT', $3, 'USDT', $4, $5, $6, $7)`,
          [
            IDS.adjustment, partnerId, adjustment, BATCHES.adjustment, ORIGINAL_BATCH,
            "Сверка с J2 таблицы: устранено историческое построчное округление до центов",
            OPERATOR,
          ],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      const { rows: [after] } = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::double precision AS balance
         FROM "PartnerLedgerEntry" WHERE "partnerId" = $1 AND currency = 'USDT'`,
        [partnerId],
      );
      if (!close(after.balance, EXPECTED.sheetBalance)) {
        throw new Error(`После COMMIT баланс ${after.balance}, ожидался ${EXPECTED.sheetBalance}`);
      }
      console.log(`✅ Применено. Ledger-баланс: ${Number(after.balance).toFixed(5)} USDT.`);
    }
  }
} finally {
  await client.end();
}
