/**
 * Re-classifies WB orders that came from the DBS courier gate but were stored
 * with the schema default `orderSource = WB`.
 *
 * Why this exists: the source is decided once, when the order row is created,
 * and every creation path has to resolve it itself. The site's VK login was
 * missing that call, so a DBS buyer who opened the gate link before the bot
 * saw the code produced a `WB` order (5508907054 / ZM4XAW3, 16.08). The code
 * path is fixed in `src/auth.ts`; this repairs the rows already written.
 *
 * Safe to re-run: it only touches rows whose code is linked to a
 * WbMarketplaceOrder and whose source is still the default `WB`.
 *
 * Usage:
 *   node scripts/backfill-wb-dbs-order-source.mjs          # dry run
 *   node scripts/backfill-wb-dbs-order-source.mjs --apply  # write
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "pg";
import dotenv from "dotenv";

const { Pool } = pkg;
dotenv.config({ path: ".env.local" });
dotenv.config();

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

// The link lives on WbMarketplaceOrder.wbCodeId → WbCode.id, while WbOrder
// stores the bare code string, so the join has to go through WbCode.
const stale = await prisma.$queryRawUnsafe(`
  select o."id", o."wbCode", o."platform"::text as platform,
         m."wbOrderId", m."isTest",
         to_char(o."createdAt", 'YYYY-MM-DD HH24:MI:SS') as created
  from "WbOrder" o
  join "WbCode" c on c."code" = o."wbCode"
  join "WbMarketplaceOrder" m on m."wbCodeId" = c."id"
  where o."orderSource" = 'WB'
  order by o."createdAt"
`);

if (stale.length === 0) {
  console.log("✅ Нечего чинить: у всех DBS-заказов уже стоит WB_DBS.");
} else {
  console.table(stale);
  if (!apply) {
    console.log(`\nDry run: ${stale.length} заказ(ов) получат orderSource=WB_DBS. Повторите с --apply.`);
  } else {
    const result = await prisma.wbOrder.updateMany({
      where: { id: { in: stale.map((row) => row.id) } },
      data: { orderSource: "WB_DBS" },
    });
    console.log(`\n✅ Обновлено заказов: ${result.count}`);
  }
}

await prisma.$disconnect();
