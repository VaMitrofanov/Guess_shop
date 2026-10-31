/**
 * ❄️ Заморозить проблемные заказы, которые появились ДО автозащиты (24.10.2026).
 *
 * С этого дня заявка на возврат, отмена на WB и возврат платежа ставят
 * заморозку сами. Но то, что случилось раньше, автоматика уже не увидит
 * «впервые» — заявка JR7HTSW, например, была отмечена до выкатки. Скрипт
 * проходит по трём источникам и ставит заморозку тем же `holdForProblem`,
 * что и воркер:
 *
 *  1. открытые заявки на возврат WB (заявка есть, решения нет);
 *  2. отменённые на WB заказы, наш заказ по которым не выкуплен;
 *  3. возвращённые платежи (полностью или частично), заказ не выкуплен.
 *
 * Выкупленные заказы пропускаются (тратить уже нечего), уже замороженные —
 * тоже. Запускать ТОЛЬКО после деплоя кода автозащиты.
 *
 *   node --import tsx scripts/hold-problem-orders.ts            # показать
 *   node --import tsx scripts/hold-problem-orders.ts --apply    # заморозить
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { holdForProblem, type ProblemKind } from "../bots/shared/order-hold";

const apply = process.argv.includes("--apply");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) }) as any;

type Candidate = { code: string; kind: ProblemKind; detail?: string | null; why: string };

async function main() {
  const candidates: Candidate[] = [];

  const claims = await db.wbMarketplaceOrder.findMany({
    where: { isTest: false, claimOpenedAt: { not: null }, claimResolvedAt: null, wbCodeId: { not: null } },
    select: { wbOrderId: true, claimReason: true, wbCode: { select: { code: true } } },
  });
  for (const c of claims) {
    if (c.wbCode?.code) candidates.push({ code: c.wbCode.code, kind: "WB_CLAIM", detail: c.claimReason, why: `заявка WB #${c.wbOrderId}` });
  }

  const cancelled = await db.wbMarketplaceOrder.findMany({
    where: { isTest: false, cancelledAt: { not: null }, wbCodeId: { not: null } },
    select: { wbOrderId: true, wbCode: { select: { code: true } } },
  });
  for (const c of cancelled) {
    if (c.wbCode?.code) candidates.push({ code: c.wbCode.code, kind: "WB_CANCELLED", detail: `WB #${c.wbOrderId}`, why: `отмена WB #${c.wbOrderId}` });
  }

  const refunds = await db.paymentAttempt.findMany({
    where: { status: { in: ["REFUNDED", "PARTIALLY_REFUNDED"] } },
    select: { status: true, order: { select: { wbCode: true } } },
  });
  for (const r of refunds) {
    if (r.order?.wbCode) {
      candidates.push({
        code: r.order.wbCode,
        kind: r.status === "REFUNDED" ? "PAYMENT_REFUNDED" : "PAYMENT_PARTIAL_REFUND",
        why: `платёж ${r.status}`,
      });
    }
  }

  // Один код — одна заморозка; приоритет у первой найденной причины.
  const byCode = new Map<string, Candidate>();
  for (const c of candidates) if (!byCode.has(c.code)) byCode.set(c.code, c);

  const codes = [...byCode.keys()];
  const [orders, holds] = await Promise.all([
    db.wbOrder.findMany({ where: { wbCode: { in: codes } }, select: { wbCode: true, status: true, heldAt: true } }),
    db.orderHold.findMany({ where: { wbCode: { in: codes }, releasedAt: null }, select: { wbCode: true } }),
  ]);
  const orderBy = new Map<string, { status: string; heldAt: Date | null }>(orders.map((o: any) => [o.wbCode, o]));
  const held = new Set<string>(holds.map((h: any) => h.wbCode));

  const todo: Array<Candidate & { status: string }> = [];
  for (const [code, c] of byCode) {
    const order = orderBy.get(code);
    if (order?.status === "COMPLETED") continue;
    if (held.has(code) || order?.heldAt) continue;
    todo.push({ ...c, status: order?.status ?? "заказа нет" });
  }

  console.log(`Кандидатов: ${byCode.size}, к заморозке: ${todo.length}${apply ? "" : " (без --apply ничего не меняется)"}`);
  for (const t of todo) console.log(`  ${t.code}  ${t.status.padEnd(18)} ${t.kind.padEnd(22)} ${t.why}`);

  if (!apply) return;
  let ok = 0;
  for (const t of todo) {
    const res = await holdForProblem(db, { wbCode: t.code, kind: t.kind, detail: t.detail, actor: "автозащита (разовый проход)" });
    if (res.ok) ok += 1;
    else console.error(`  ✗ ${t.code}: ${res.error}`);
  }
  console.log(`Заморожено: ${ok} из ${todo.length}`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); await pool.end(); });
