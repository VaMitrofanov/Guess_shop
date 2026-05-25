import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "pg";
// @ts-ignore
const { Pool } = pkg;
const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db      = new PrismaClient({ adapter } as any);
async function main() {
  const order = await (db as any).wbOrder.findFirst({
    where: { id: { contains: "mitcj2" } },
    select: { id: true, status: true, gamepassUrl: true, amount: true, updatedAt: true },
  });
  console.log(JSON.stringify(order, null, 2));
  await pool.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
