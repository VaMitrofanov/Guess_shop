/**
 * Manually grant a WB review bonus to a VK user.
 * Use when the bot failed to process their screenshot.
 *
 * Usage:
 *   npx tsx scripts/grant-review-bonus.ts <vkId>
 *
 * Example:
 *   npx tsx scripts/grant-review-bonus.ts 123456789
 *
 * The script:
 *  1. Finds the user by VK ID
 *  2. Finds their latest COMPLETED WbOrder with unredeemed review bonus
 *  3. Marks WbCode.reviewBonusClaimed = true
 *  4. user.balance += 100, reviewBonusGrantedAt = now(), reviewReminderLevel = 0
 *  5. Sends the standard VK bonus notification
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "pg";

// @ts-ignore
const { Pool } = pkg;

const vkId = process.argv[2];
if (!vkId) {
  console.error("Usage: npx tsx scripts/grant-review-bonus.ts <vkId>");
  process.exit(1);
}

const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter } as any);

async function vkSend(userId: string, message: string): Promise<void> {
  const params = new URLSearchParams({
    user_id:      userId,
    message,
    random_id:    String(Date.now() + Math.floor(Math.random() * 1000)),
    access_token: process.env.VK_TOKEN ?? "",
    v:            "5.131",
  });
  const res = await fetch(`https://api.vk.com/method/messages.send`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    params.toString(),
  });
  const json = await res.json() as any;
  if (json.error) throw new Error(`VK API error: ${JSON.stringify(json.error)}`);
  console.log(`✅ VK message sent (message_id=${json.response})`);
}

async function main() {
  const user = await (prisma as any).user.findUnique({ where: { vkId } });
  if (!user) {
    console.error(`❌ User with vkId=${vkId} not found in DB`);
    process.exit(1);
  }
  console.log(`👤 User: ${user.name ?? "(no name)"} | id=${user.id} | balance=${user.balance}`);

  const order = await (prisma as any).wbOrder.findFirst({
    where:   { userId: user.id, status: "COMPLETED" },
    orderBy: { updatedAt: "desc" },
  });
  if (!order) {
    console.error(`❌ No COMPLETED order found for this user`);
    process.exit(1);
  }
  console.log(`📦 Order: ${order.id} | wbCode=${order.wbCode}`);

  const code = await (prisma as any).wbCode.findFirst({
    where: { userId: user.id, reviewBonusClaimed: false },
  });
  if (!code) {
    console.error(`❌ No eligible WbCode (reviewBonusClaimed=false) found for this user`);
    process.exit(1);
  }
  console.log(`🔑 WbCode: ${code.code} | reviewBonusClaimed=${code.reviewBonusClaimed}`);

  let paid = false;
  await (prisma as any).$transaction(async (tx: any) => {
    const result = await tx.wbCode.updateMany({
      where: { code: code.code, reviewBonusClaimed: false },
      data:  { reviewBonusClaimed: true },
    });
    if (result.count === 0) { console.warn("⚠️  Already claimed (concurrent run?)"); return; }
    await tx.user.update({
      where: { id: user.id },
      data:  { balance: { increment: 100 }, reviewBonusGrantedAt: new Date(), reviewReminderLevel: 0 },
    });
    paid = true;
  });

  if (!paid) {
    console.log("⚠️  Bonus already granted — nothing to do");
    process.exit(0);
  }

  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30);
  const expiryStr = expiryDate.toLocaleDateString("ru-RU", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow",
  });

  const bonusMsg =
    `🎁 +100 R$ зачислено на счёт!\n\n` +
    `Действуют до ${expiryStr}.\n\n` +
    `Используй на прямой заказ — без карточки WB.\n` +
    `Бонус добавится к покупке автоматически.`;

  await vkSend(vkId, bonusMsg);

  const updated = await (prisma as any).user.findUnique({ where: { id: user.id } });
  console.log(`\n✅ Done! balance: ${user.balance} → ${updated.balance} R$`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await (prisma as any).$disconnect(); await pool.end(); });
