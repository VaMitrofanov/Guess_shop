/**
 * One-off repair for WB DBS orders that the pre-20.08.2026 sync mis-filed.
 *
 * Two defects left dead weight in the console:
 *
 *  1. `/api/v3/dbs/orders` is every order in the window, not the completed
 *     ones, and it carries no status fields — yet the sync stamped `completedAt`
 *     on every row it returned. Because the status poller only ever looked at
 *     orders with no `completedAt`, a cancellation arriving afterwards could
 *     never be seen. Five live orders were sitting as "completed" while WB had
 *     them as `declined_by_client` or `receive/canceled`.
 *  2. Buyer names were only ever read from the DBS *client* endpoint, which
 *     answers with empty strings. WB publishes the name on the chat instead, so
 *     the console showed «WB #5508870842» for all 41 orders.
 *
 * The fix ships in `bots/shared/wb-delivery-sync.ts`; this script applies the
 * same verdicts to rows that are already wrong, by importing the very same
 * policy functions so the two can never disagree.
 *
 * Usage:
 *   node --import tsx scripts/wb-dbs-repair.ts            # dry run, writes nothing
 *   node --import tsx scripts/wb-dbs-repair.ts --apply
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "pg";
import {
  canAutoRejectInternalOrder,
  wbMarketplaceTerminalFlags,
} from "../bots/shared/wb-delivery-policy";
import { wbChatClientName } from "../bots/shared/wb-delivery-contract";

const APPLY = process.argv.includes("--apply");
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const MARKETPLACE = "https://marketplace-api.wildberries.ru";
const CHAT = "https://buyer-chat-api.wildberries.ru";

function token(scope: "marketplace" | "chat") {
  const scoped = scope === "marketplace" ? process.env.WB_MARKETPLACE_TOKEN : process.env.WB_CHAT_TOKEN;
  const value = (scoped || process.env.WB_API_TOKEN || "").trim().replace(/^['"`]|['"`]$/g, "");
  if (!value) throw new Error(`No WB token for scope ${scope}`);
  return value;
}

type WbStatusRow = { orderId: number | string; supplierStatus?: string; wbStatus?: string };

async function wbStatuses(ids: string[]): Promise<Map<string, WbStatusRow>> {
  const out = new Map<string, WbStatusRow>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const response = await fetch(`${MARKETPLACE}/api/marketplace/v3/dbs/orders/status/info`, {
      method: "POST",
      headers: { Authorization: token("marketplace"), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ordersIds: ids.slice(offset, offset + 100).map(Number) }),
    });
    if (!response.ok) throw new Error(`status/info ${response.status}`);
    const body = await response.json() as { orders?: WbStatusRow[] };
    for (const row of body.orders ?? []) out.set(String(row.orderId), row);
  }
  return out;
}

/** rid → buyer name, straight from the chat directory WB serves the seller. */
async function wbChatNames(): Promise<Map<string, string>> {
  const response = await fetch(`${CHAT}/api/v1/seller/chats`, {
    headers: { Authorization: token("chat"), Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`chats ${response.status}`);
  const body = await response.json() as { result?: Array<{ clientName?: string; goodCard?: { rid?: string } }> };
  const names = new Map<string, string>();
  for (const chat of body.result ?? []) {
    const rid = chat.goodCard?.rid;
    const name = wbChatClientName(chat);
    if (rid && name && !names.has(rid)) names.set(rid, name);
  }
  return names;
}

async function main() {
  const orders = await db.wbMarketplaceOrder.findMany({
    where: { isTest: false },
    include: { wbCode: { select: { code: true } } },
    orderBy: { firstSeenAt: "desc" },
  });
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} · ${orders.length} DBS orders\n`);

  const [statuses, chatNames] = await Promise.all([
    wbStatuses(orders.map((order) => order.wbOrderId)),
    wbChatNames(),
  ]);

  let statusFixed = 0;
  let cancelled = 0;
  let internalRejected = 0;
  let needsHuman = 0;
  let named = 0;

  for (const order of orders) {
    const live = statuses.get(order.wbOrderId);
    const name = order.rid ? chatNames.get(order.rid) : undefined;
    const changes: string[] = [];
    const data: Record<string, unknown> = {};

    if (live) {
      const { cancelled: isCancelled, completed } = wbMarketplaceTerminalFlags(live.supplierStatus, live.wbStatus);
      const now = new Date();
      if (live.supplierStatus && live.supplierStatus !== order.supplierStatus) {
        data.supplierStatus = live.supplierStatus;
        changes.push(`supplier ${order.supplierStatus}→${live.supplierStatus}`);
      }
      if (live.wbStatus && live.wbStatus !== order.wbStatus) {
        data.wbStatus = live.wbStatus;
        changes.push(`wb ${order.wbStatus}→${live.wbStatus}`);
      }
      if (isCancelled && !order.cancelledAt) {
        data.cancelledAt = now;
        changes.push("CANCELLED");
      }
      // A cancellation retracts the completion the buggy feed had stamped.
      if (isCancelled && order.completedAt) {
        data.completedAt = null;
        changes.push("completedAt cleared");
      }
      if (!isCancelled && completed && !order.completedAt) {
        data.completedAt = now;
        changes.push("completed");
      }
      // The feed marked orders complete that WB never finished. Undo that so
      // the status poller starts watching them again.
      if (!isCancelled && !completed && order.completedAt) {
        data.completedAt = null;
        changes.push("completedAt cleared (not finished at WB)");
      }
    } else {
      changes.push("WB did not return a status");
    }

    if (name && !order.buyerName) {
      data.buyerName = name;
      changes.push(`name → ${name}`);
    }

    if (!changes.length) continue;
    console.log(`WB #${order.wbOrderId} [${order.wbCode?.code ?? "no code"}] ${changes.join(" · ")}`);

    if (data.cancelledAt) cancelled += 1;
    if (data.buyerName) named += 1;
    if (Object.keys(data).some((key) => key !== "buyerName")) statusFixed += 1;

    // Mirror the cancellation into our own buyout order, on the same rule the
    // worker uses: only orders that have cost us nothing are closed here.
    if (data.cancelledAt && order.wbCode?.code) {
      const internal = await db.wbOrder.findUnique({
        where: { wbCode: order.wbCode.code },
        select: { id: true, status: true, adminNote: true },
      });
      if (internal && !["COMPLETED", "REJECTED"].includes(internal.status)) {
        if (canAutoRejectInternalOrder(internal.status)) {
          const mark = `[WB ОТМЕНА ${new Date().toISOString().slice(0, 10)}] заказ WB #${order.wbOrderId} отменён (${live?.supplierStatus}/${live?.wbStatus}) — выкуп закрыт автоматически`;
          console.log(`   ↳ выкуп ${order.wbCode.code} (${internal.status}) → REJECTED`);
          internalRejected += 1;
          if (APPLY) {
            await db.wbOrder.update({
              where: { id: internal.id },
              data: {
                status: "REJECTED",
                rejectionReason: `Заказ WB #${order.wbOrderId} отменён на Wildberries (${live?.supplierStatus}/${live?.wbStatus})`,
                adminNote: internal.adminNote ? `${mark}\n${internal.adminNote}`.slice(0, 2_000) : mark,
              },
            });
          }
        } else {
          console.log(`   ↳ ⚠️ выкуп ${order.wbCode.code} в статусе ${internal.status} — РАЗБЕРИТЕ ВРУЧНУЮ`);
          needsHuman += 1;
        }
      }
    }

    if (APPLY) await db.wbMarketplaceOrder.update({ where: { id: order.id }, data });
  }

  console.log(
    `\n${APPLY ? "Применено" : "Будет изменено"}: статусов ${statusFixed}, отмен ${cancelled}, ` +
    `выкупов закрыто ${internalRejected}, требуют человека ${needsHuman}, имён ${named}`,
  );
  if (!APPLY) console.log("Ничего не записано. Повторите с --apply.");
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
