import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const codes = await prisma.wBCode.findMany({
    where: { code: { in: ["TEST300", "TEST500"] } },
    include: {
      user: { select: { id: true, telegramId: true, vkId: true, username: true } },
      order: true,
    },
  });

  console.log("=== WB CODES ===");
  for (const c of codes) {
    console.log(`\n${c.code}: status=${c.status} isUsed=${c.isUsed} denomination=${c.denomination} userId=${c.userId ?? "null"}`);
    if (c.user) console.log(`  user: tgId=${c.user.telegramId} vkId=${c.user.vkId} username=${c.user.username}`);
    if (c.order) console.log(`  order: id=...${c.order.id.slice(-6)} status=${c.order.status} amount=${c.order.amount} passId=${c.order.gamepassId ?? "null"}`);
  }

  const orders = await prisma.wBOrder.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { wbCode: { select: { code: true } } },
  });
  console.log("\n=== RECENT ORDERS ===");
  for (const o of orders) {
    console.log(`...${o.id.slice(-6)}: code=${o.wbCode?.code ?? "?"} status=${o.status} amount=${o.amount} passId=${o.gamepassId ?? "null"} ${o.createdAt.toISOString().slice(0, 16)}`);
  }
}

main().catch(console.error).finally(() => pool.end());
