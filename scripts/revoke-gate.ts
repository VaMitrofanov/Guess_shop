/**
 * 🚫 Аннулировать / вернуть код гейта — из терминала.
 *
 * Кнопка «Аннулировать код» в консоли DBS делает то же самое, и в обычной
 * жизни аннулирование выполняет сам воркер, как только WB подтвердит отмену.
 * Этот скрипт нужен для двух случаев, которых в консоли нет намеренно:
 *
 *  1. разбор задним числом — код отменённого заказа, выданный до 12.09.2026,
 *     когда аннулирования не существовало вовсе;
 *  2. ОТМЕНА аннулирования. Кнопки для неё нет специально: отмена заказа на WB
 *     означает возвращённые деньги, и возврат кода в оборот — это решение
 *     владельца, а не операторский клик.
 *
 * Правила берутся из `bots/shared/wb-code-revocation.ts` — тем же импортом,
 * что и у воркера, чтобы скрипт и прод не могли разойтись.
 *
 *   node --import tsx scripts/revoke-gate.ts --code XKFFJUU
 *   node --import tsx scripts/revoke-gate.ts --code XKFFJUU --apply
 *   node --import tsx scripts/revoke-gate.ts --code XKFFJUU --release --apply
 *
 * Без `--apply` только показывает, что изменится.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { restoreGateCode, revokeGateCode } from "../bots/shared/wb-code-revocation";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const code = (arg("code") ?? "").trim().toUpperCase();
const actor = (arg("by") ?? "скрипт").trim();
const release = args.includes("--release");
const apply = args.includes("--apply");

if (!code) {
  console.error("Укажите --code XXXXXXX");
  process.exit(1);
}

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (!url.hostname.includes("-pooler.")) {
    url.hostname = url.hostname.replace(/^(ep-[^.]+)(\.)/, "$1-pooler$2");
  }
  url.searchParams.delete("channel_binding");
  const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url.toString() })) });

  const order = await db.wbMarketplaceOrder.findFirst({
    where: { wbCode: { code } },
    select: {
      id: true, wbOrderId: true, cancelledAt: true, gateState: true,
      denominationSnapshot: true, buyerName: true,
      wbCode: { select: { code: true, status: true, isUsed: true } },
    },
  });

  if (!order) {
    console.error(`Заказ WB по коду ${code} не найден (аннулирование живёт только у DBS-заказов).`);
    process.exit(1);
  }

  const internal = await db.wbOrder.findUnique({ where: { wbCode: code }, select: { status: true } });

  console.log(`\nКод:    ${code} · ${order.denominationSnapshot ?? "—"} R$ · статус ${order.wbCode?.status}`);
  console.log(`Заказ:  WB #${order.wbOrderId} · ${order.buyerName ?? "покупатель неизвестен"}`);
  console.log(`Отмена: ${order.cancelledAt ? order.cancelledAt.toISOString() : "НЕТ — заказ живой"}`);
  console.log(`Гейт:   ${order.gateState}`);
  console.log(`Выкуп:  ${internal?.status ?? "заказа по коду нет"}`);
  console.log(`\nДействие: ${release ? "ВЕРНУТЬ код в оборот" : "АННУЛИРОВАТЬ код"} (${actor})`);

  if (!apply) {
    console.log("\n(dry-run; добавь --apply, чтобы записать)\n");
    await db.$disconnect();
    process.exit(0);
  }

  const input = { marketplaceOrderId: order.id, wbOrderId: order.wbOrderId, actor };
  const result = release ? await restoreGateCode(db, input) : await revokeGateCode(db, input);

  if (!result.ok) {
    console.error(`\n❌ ${result.error}\n`);
    await db.$disconnect();
    process.exit(1);
  }

  const after = await db.wbCode.findUnique({ where: { code }, select: { status: true } });
  console.log(`\n✅ Готово. Статус кода: ${after?.status}\n`);
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
