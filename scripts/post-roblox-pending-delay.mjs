#!/usr/bin/env node
/**
 * Разовый пост 26.10.2026 в TG-канал и на стену VK: Roblox держит Pending
 * дольше обычного, у всех продавцов; главное — робуксы в Pending или на балансе.
 *
 * Использование: node scripts/post-roblox-pending-delay.mjs [--dry-run]
 */
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const DRY_RUN = process.argv.includes("--dry-run");
const { TG_TOKEN, TG_CHANNEL_ID, VK_TOKEN, VK_GROUP_ID } = process.env;
if (!TG_TOKEN || !TG_CHANNEL_ID || !VK_TOKEN || !VK_GROUP_ID) throw new Error("TG_TOKEN, TG_CHANNEL_ID, VK_TOKEN, VK_GROUP_ID required");

const TG_TEXT = `⚠️ <b>Про задержку робуксов в Roblox</b>

Сейчас Roblox держит робуксы за геймпассы в статусе Pending дольше обычного. Так происходит у всех без исключения — у любых продавцов и магазинов, не только у нас.

Сроков Roblox не называет, и мы знаем не больше вашего. Ускорить это не может никто — ни мы, ни поддержка. Остаётся только ждать.

<b>Главное — чтобы робуксы были в Pending или уже на балансе.</b>
🔍 Проверить: roblox.com/transactions → строка <b>Pending Robux</b>
✅ Там сумма вашего заказа (или робуксы уже на балансе) — всё в порядке. Робуксы ваши, с нашей стороны всё сделано, на баланс они перейдут сами.
❓ Ни в Pending, ни на балансе их нет — напишите боту «где робуксы?», проверим вместе.

Подробно, со схемой: robloxbank.ru/pending

Спасибо за терпение 🙏`;
const VK_TEXT = TG_TEXT.replaceAll(/<[^>]+>/g, "");

async function main() {
  if (DRY_RUN) { console.log(TG_TEXT); return; }
  const tg = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text: TG_TEXT, parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
  }).then((r) => r.json());
  console.log("TG канал:", tg.ok ? `ok, message_id ${tg.result.message_id}` : `ОШИБКА ${tg.description}`);

  const vk = await fetch("https://api.vk.com/method/wall.post", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: VK_TOKEN, v: "5.131", owner_id: `-${VK_GROUP_ID}`, from_group: "1", message: VK_TEXT }),
  }).then((r) => r.json());
  console.log("VK стена:", vk.error ? `ОШИБКА ${vk.error.error_code} ${vk.error.error_msg}` : `ok, post_id ${vk.response.post_id}`);
}

main().catch((e) => { console.error(e?.message ?? e); process.exitCode = 1; });
