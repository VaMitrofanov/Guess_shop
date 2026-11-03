#!/usr/bin/env node
/**
 * TG-only broadcast: post to channel + forward to users with pending orders.
 * VK already sent by the main script.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const DRY_RUN = process.argv.includes("--dry-run");

const { DATABASE_URL, TG_TOKEN, TG_CHANNEL_ID } = process.env;
if (!DATABASE_URL || !TG_TOKEN || !TG_CHANNEL_ID) throw new Error("DATABASE_URL, TG_TOKEN, TG_CHANNEL_ID required");

const TG_TEXT = `🚨 <b>Важное объявление для всех покупателей</b>
<b>Обновление по выдаче робуксов через геймпассы</b>

Друзья, всем привет! На связи <b>RobloxBank</b>.

В последнее время многие из вас столкнулись с задержками при выдаче заказов, а при попытке покупки геймпассов вы видите ошибку 404 или серую кнопку «Unavailable». Мы видим все ваши сообщения и хотим подробно объяснить, что сейчас происходит.

<b>Что случилось?</b>

Roblox выкатил глобальное обновление безопасности и полностью изменил систему работы геймпассов:

1. <b>Удалены прямые ссылки:</b> Ссылки на сами геймпассы больше не работают (сайт выдает ошибку 404). Теперь покупка возможна строго через вкладку Store на странице вашего плейса.
2. <b>Блокировка «пустых» плейсов:</b> Защитные алгоритмы Roblox теперь автоматически блокируют вкладку Store (ставят статус Unavailable) на плейсах, где нет игровой активности.

Ваши робуксы в полной безопасности, мы никуда не пропали, но из-за этих нововведений старые способы выдачи временно заблокированы самой платформой.

<b>Что делать прямо сейчас?</b>

Чтобы система Roblox одобрила ваш плейс и открыла кнопку покупки, его нужно «оживить»:

1. Плейс должен быть <b>публичным</b> — пройди возрастной опрос (Questionnaire) в настройках плейса (подробно описано в шаге 3 инструкции — если потерял, напиши боту и он пришлёт её снова)
2. <b>Галочка региональных цен</b> должна быть убрана (шаг 5 инструкции)

К посту прикреплены 3 скриншота — так должен выглядеть твой плейс после настройки:
• Questionnaire: 14 из 14 секций заполнены
• Плейс: статус Public
• Content Settings: Audience = Public

Мы приносим извинения за временные неудобства. Платформа усложняет жизнь всем нам, но мы адаптируемся к новым правилам и обязательно выдадим каждый заказ.

Если вы выполнили все пункты или хотите изменить способ получения — напишите в поддержку с номером заказа:

📩 Бот: @RobloxBankBot
💬 Поддержка: @RobloxBank_PA

Спасибо за ваше терпение и понимание!

🤍 Команда RobloxBank`;

const PHOTO_CAPTION = "Так должен выглядеть твой плейс после настройки (3 скриншота)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function tgApi(method) { return `https://api.telegram.org/bot${TG_TOKEN}/${method}`; }

async function tgSendText(chatId, text) {
  const res = await fetch(tgApi("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  return res.json();
}

async function tgSendMediaGroup(chatId, photoPaths, caption) {
  const fd = new FormData();
  const media = photoPaths.map((_, i) => ({
    type: "photo",
    media: `attach://photo${i}`,
    ...(i === 0 ? { caption, parse_mode: "HTML" } : {}),
  }));
  fd.append("chat_id", String(chatId));
  fd.append("media", JSON.stringify(media));
  photoPaths.forEach((p, i) => {
    const buf = readFileSync(p);
    fd.append(`photo${i}`, new Blob([buf], { type: "image/jpeg" }), `photo${i}.jpg`);
  });
  const res = await fetch(tgApi("sendMediaGroup"), { method: "POST", body: fd });
  return res.json();
}

async function tgForwardMessage(chatId, fromChatId, messageId) {
  const res = await fetch(tgApi("forwardMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, from_chat_id: fromChatId, message_id: messageId }),
  });
  return res.json();
}

async function main() {
  const photoPaths = [
    resolve(__dirname, "broadcast-photos/01-questionnaire.jpg"),
    resolve(__dirname, "broadcast-photos/02-public-place.jpg"),
    resolve(__dirname, "broadcast-photos/03-content-settings.jpg"),
  ];
  for (const p of photoPaths) { readFileSync(p); }

  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  const { rows } = await pool.query(`
    SELECT DISTINCT u."tgId"
    FROM "WbOrder" o
    JOIN "User" u ON u.id = o."userId"
    WHERE o.status NOT IN ('COMPLETED', 'REJECTED')
      AND o."isTest" = false
      AND u."tgId" IS NOT NULL
  `);
  const tgUsers = rows.map((r) => r.tgId);
  console.log(`Found ${tgUsers.length} TG users with pending orders`);

  if (DRY_RUN) { console.log("Users:", tgUsers); await pool.end(); return; }

  // 1. Post to channel
  console.log("\n📢 Posting to TG channel...");
  const textResult = await tgSendText(TG_CHANNEL_ID, TG_TEXT);
  if (!textResult.ok) { console.error("Text failed:", textResult); await pool.end(); return; }
  const channelTextMsgId = textResult.result.message_id;
  console.log(`  ✅ Text posted (msg_id: ${channelTextMsgId})`);

  const photoResult = await tgSendMediaGroup(TG_CHANNEL_ID, photoPaths, PHOTO_CAPTION);
  if (!photoResult.ok) { console.error("Photos failed:", photoResult); }
  else {
    const photoIds = photoResult.result.map((m) => m.message_id);
    console.log(`  ✅ Photos posted (msg_ids: ${photoIds.join(", ")})`);
  }
  const channelPhotoMsgIds = photoResult.ok ? photoResult.result.map((m) => m.message_id) : [];

  // 2. Forward to each user
  console.log(`\n📨 Forwarding to ${tgUsers.length} TG users...`);
  let ok = 0, fail = 0;
  for (const tgId of tgUsers) {
    try {
      const r1 = await tgForwardMessage(tgId, TG_CHANNEL_ID, channelTextMsgId);
      if (!r1.ok) throw new Error(r1.description || "forward text failed");
      for (const pmid of channelPhotoMsgIds) {
        await tgForwardMessage(tgId, TG_CHANNEL_ID, pmid);
        await sleep(35);
      }
      ok++;
    } catch (err) {
      fail++;
      console.warn(`  ❌ TG ${tgId}: ${err.message || err}`);
    }
    await sleep(50);
  }
  console.log(`\n  TG done: ${ok} sent, ${fail} failed`);
  await pool.end();
  console.log("🏁 TG broadcast complete.");
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
