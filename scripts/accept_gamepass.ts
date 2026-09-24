/**
 * Manually accept a gamepass link for an AWAITING_GAMEPASS order.
 * Sets gamepassUrl, isUsed=true on WbCode, status=PENDING.
 *
 * Usage:
 *   npx tsx scripts/accept_gamepass.ts <orderId> <gamepassUrl>
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "pg";
// @ts-ignore
const { Pool } = pkg;

const orderId     = process.argv[2];
const gamepassUrl = process.argv[3];

if (!orderId || !gamepassUrl) {
  console.error("Usage: npx tsx scripts/accept_gamepass.ts <orderId> <gamepassUrl>");
  process.exit(1);
}

const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db      = new PrismaClient({ adapter } as any);

async function main() {
  const order = await (db as any).wbOrder.findUnique({ where: { id: orderId } });
  if (!order) { console.error("Order not found:", orderId); process.exit(1); }

  console.log(`Order: #${order.id.slice(-6).toUpperCase()} status=${order.status} wbCode=${order.wbCode}`);

  if (order.status !== "AWAITING_GAMEPASS") {
    console.error(`Expected AWAITING_GAMEPASS, got ${order.status}`);
    process.exit(1);
  }

  await (db as any).$transaction(async (tx: any) => {
    await tx.wbOrder.update({
      where: { id: orderId },
      data:  { status: "PENDING", gamepassUrl },
    });

    if (!order.wbCode.startsWith("DIR-")) {
      await tx.wbCode.updateMany({
        where: { code: order.wbCode },
        data:  { isUsed: true },
      });
    }
  });

  console.log(`✅ Order ${orderId} → PENDING`);
  console.log(`   gamepassUrl: ${gamepassUrl}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => pool.end());
