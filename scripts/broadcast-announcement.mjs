#!/usr/bin/env node
/**
 * One-time broadcast: gamepass update announcement to TG channel, VK wall,
 * and all users with non-completed WbOrders.
 *
 * Usage:
 *   node scripts/broadcast-announcement.mjs [--dry-run]
 *
 * Env: DATABASE_URL, TG_TOKEN, VK_TOKEN, TG_CHANNEL_ID, VK_GROUP_ID
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

const { DATABASE_URL, TG_TOKEN, VK_TOKEN, TG_CHANNEL_ID, VK_GROUP_ID } = process.env;
if (!DATABASE_URL || !TG_TOKEN) throw new Error("DATABASE_URL and TG_TOKEN required");

// ── Message texts ────────────────────────────────────────────────────────────

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

const VK_TEXT = `🚨 Важное объявление для всех покупателей
Обновление по выдаче робуксов через геймпассы

Друзья, всем привет! На связи RobloxBank.

В последнее время многие из вас столкнулись с задержками при выдаче заказов, а при попытке покупки геймпассов вы видите ошибку 404 или серую кнопку «Unavailable». Мы видим все ваши сообщения и хотим подробно объяснить, что сейчас происходит.

Что случилось?

Roblox выкатил глобальное обновление безопасности и полностью изменил систему работы геймпассов:

1. Удалены прямые ссылки: Ссылки на сами геймпассы больше не работают (сайт выдает ошибку 404). Теперь покупка возможна строго через вкладку Store на странице вашего плейса.
2. Блокировка «пустых» плейсов: Защитные алгоритмы Roblox теперь автоматически блокируют вкладку Store (ставят статус Unavailable) на плейсах, где нет игровой активности.

Ваши робуксы в полной безопасности, мы никуда не пропали, но из-за этих нововведений старые способы выдачи временно заблокированы самой платформой.

Что делать прямо сейчас?

Чтобы система Roblox одобрила ваш плейс и открыла кнопку покупки, его нужно «оживить»:

1. Плейс должен быть публичным — пройди возрастной опрос (Questionnaire) в настройках плейса (подробно описано в шаге 3 инструкции — если потерял, напиши боту и он пришлёт её снова)
2. Галочка региональных цен должна быть убрана (шаг 5 инструкции)

К посту прикреплены 3 скриншота — так должен выглядеть твой плейс после настройки:
• Questionnaire: 14 из 14 секций заполнены
• Плейс: статус Public
• Content Settings: Audience = Public

Мы приносим извинения за временные неудобства. Платформа усложняет жизнь всем нам, но мы адаптируемся к новым правилам и обязательно выдадим каждый заказ.

Если вы выполнили все пункты или хотите изменить способ получения — напишите нам в сообщения группы https://vk.ru/bankroblox или в Telegram: https://t.me/RobloxBank_PA

Спасибо за ваше терпение и понимание!

🤍 Команда RobloxBank`;

const PHOTO_CAPTION = "Так должен выглядеть твой плейс после настройки (3 скриншота)";

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tgApi(method) {
  return `https://api.telegram.org/bot${TG_TOKEN}/${method}`;
}

function vkApi(method) {
  return `https://api.vk.com/method/${method}`;
}

// ── TG API ───────────────────────────────────────────────────────────────────

async function tgSendText(chatId, text, extra = {}) {
  const res = await fetch(tgApi("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra,
    }),
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
    body: JSON.stringify({
      chat_id: chatId,
      from_chat_id: fromChatId,
      message_id: messageId,
    }),
  });
  return res.json();
}

// ── VK API ───────────────────────────────────────────────────────────────────

async function vkCall(method, params) {
  const body = new URLSearchParams({
    access_token: VK_TOKEN,
    v: "5.131",
    ...params,
  });
  const res = await fetch(vkApi(method), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return res.json();
}

async function vkUploadWallPhoto(groupId, photoPath) {
  const srv = await vkCall("photos.getWallUploadServer", { group_id: groupId });
  const uploadUrl = srv?.response?.upload_url;
  if (!uploadUrl) throw new Error("VK getWallUploadServer failed: " + JSON.stringify(srv));

  const fd = new FormData();
  fd.append("photo", new Blob([readFileSync(photoPath)], { type: "image/jpeg" }), "photo.jpg");
  const upRes = await fetch(uploadUrl, { method: "POST", body: fd });
  const up = await upRes.json();
  if (!up?.photo || up.photo === "[]") throw new Error("VK wall photo upload failed: " + JSON.stringify(up));

  const saved = await vkCall("photos.saveWallPhoto", {
    group_id: groupId,
    server: String(up.server),
    photo: up.photo,
    hash: up.hash,
  });
  const ph = saved?.response?.[0];
  if (!ph) throw new Error("VK saveWallPhoto failed: " + JSON.stringify(saved));
  return `photo${ph.owner_id}_${ph.id}`;
}

async function vkUploadMessagePhoto(userId, photoPath) {
  const srv = await vkCall("photos.getMessagesUploadServer", { peer_id: userId });
  const uploadUrl = srv?.response?.upload_url;
  if (!uploadUrl) throw new Error("VK getMessagesUploadServer failed: " + JSON.stringify(srv));

  const fd = new FormData();
  fd.append("photo", new Blob([readFileSync(photoPath)], { type: "image/jpeg" }), "photo.jpg");
  const upRes = await fetch(uploadUrl, { method: "POST", body: fd });
  const up = await upRes.json();
  if (!up?.photo || up.photo === "[]") throw new Error("VK msg photo upload failed: " + JSON.stringify(up));

  const saved = await vkCall("photos.saveMessagesPhoto", {
    server: String(up.server),
    photo: up.photo,
    hash: up.hash,
  });
  const ph = saved?.response?.[0];
  if (!ph) throw new Error("VK saveMessagesPhoto failed: " + JSON.stringify(saved));
  return `photo${ph.owner_id}_${ph.id}`;
}

// ── DB ───────────────────────────────────────────────────────────────────────

async function getAffectedUsers(pool) {
  const { rows } = await pool.query(`
    SELECT DISTINCT u."tgId", u."vkId"
    FROM "WbOrder" o
    JOIN "User" u ON u.id = o."userId"
    WHERE o.status NOT IN ('COMPLETED', 'REJECTED')
      AND o."isTest" = false
  `);
  return rows;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const photoPaths = [
    resolve(__dirname, "broadcast-photos/01-questionnaire.jpg"),
    resolve(__dirname, "broadcast-photos/02-public-place.jpg"),
    resolve(__dirname, "broadcast-photos/03-content-settings.jpg"),
  ];

  // Verify photos exist
  for (const p of photoPaths) {
    try { readFileSync(p); } catch { throw new Error(`Photo not found: ${p}`); }
  }

  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== LIVE BROADCAST ===");

  // 1. Get affected users
  const users = await getAffectedUsers(pool);
  const tgUsers = users.filter((u) => u.tgId).map((u) => u.tgId);
  const vkUsers = users.filter((u) => u.vkId).map((u) => u.vkId);
  console.log(`Found ${users.length} users: ${tgUsers.length} TG, ${vkUsers.length} VK`);

  if (DRY_RUN) {
    console.log("TG users:", tgUsers);
    console.log("VK users:", vkUsers);
    await pool.end();
    return;
  }

  // ── TG: post to channel ────────────────────────────────────────────────
  let channelTextMsgId = null;
  let channelPhotoMsgIds = [];

  if (TG_CHANNEL_ID) {
    console.log("\n📢 Posting to TG channel...");

    // Send text first
    const textResult = await tgSendText(TG_CHANNEL_ID, TG_TEXT);
    if (!textResult.ok) {
      console.error("TG channel text failed:", textResult);
    } else {
      channelTextMsgId = textResult.result.message_id;
      console.log(`  ✅ Text posted (msg_id: ${channelTextMsgId})`);
    }

    // Send photos as media group
    const photoResult = await tgSendMediaGroup(TG_CHANNEL_ID, photoPaths, PHOTO_CAPTION);
    if (!photoResult.ok) {
      console.error("TG channel photos failed:", photoResult);
    } else {
      channelPhotoMsgIds = photoResult.result.map((m) => m.message_id);
      console.log(`  ✅ Photos posted (msg_ids: ${channelPhotoMsgIds.join(", ")})`);
    }
  }

  // ── TG: forward to users ───────────────────────────────────────────────
  if (tgUsers.length && channelTextMsgId && TG_CHANNEL_ID) {
    console.log(`\n📨 Forwarding to ${tgUsers.length} TG users...`);
    let ok = 0, fail = 0;
    for (const tgId of tgUsers) {
      try {
        // Forward the text message
        const r1 = await tgForwardMessage(tgId, TG_CHANNEL_ID, channelTextMsgId);
        if (!r1.ok) throw new Error(r1.description || "forward failed");
        // Forward the first photo from the media group (all 3 are grouped)
        if (channelPhotoMsgIds.length) {
          for (const pmid of channelPhotoMsgIds) {
            await tgForwardMessage(tgId, TG_CHANNEL_ID, pmid);
            await sleep(35); // micro-throttle within group
          }
        }
        ok++;
      } catch (err) {
        fail++;
        console.warn(`  ❌ TG ${tgId}: ${err.message || err}`);
      }
      await sleep(50); // ~20 msgs/sec
    }
    console.log(`  TG done: ${ok} sent, ${fail} failed`);
  }

  // ── VK: post to wall ──────────────────────────────────────────────────
  if (VK_TOKEN && VK_GROUP_ID) {
    console.log("\n📢 Posting to VK wall...");
    try {
      const attachments = [];
      for (const p of photoPaths) {
        const att = await vkUploadWallPhoto(VK_GROUP_ID, p);
        attachments.push(att);
        console.log(`  ✅ Photo uploaded: ${att}`);
      }
      const wallResult = await vkCall("wall.post", {
        owner_id: `-${VK_GROUP_ID}`,
        from_group: "1",
        message: VK_TEXT,
        attachments: attachments.join(","),
      });
      console.log(`  ✅ Wall post:`, wallResult?.response);
    } catch (err) {
      console.error("  ❌ VK wall post failed:", err.message || err);
    }

    // ── VK: send to users ────────────────────────────────────────────────
    if (vkUsers.length) {
      console.log(`\n📨 Sending to ${vkUsers.length} VK users...`);
      // Upload photos for messages once (reuse across users)
      let msgAttachments = [];
      try {
        // Upload to the first user's dialog, then reuse attachment strings
        for (const p of photoPaths) {
          const att = await vkUploadMessagePhoto(vkUsers[0], p);
          msgAttachments.push(att);
        }
        console.log(`  ✅ Message photos uploaded: ${msgAttachments.join(", ")}`);
      } catch (err) {
        console.warn(`  ⚠️ Photo upload for messages failed, sending text only: ${err.message}`);
      }

      let ok = 0, fail = 0;
      for (const vkId of vkUsers) {
        try {
          const params = {
            user_id: vkId,
            message: VK_TEXT,
            random_id: String(Date.now() + Math.floor(Math.random() * 10000)),
          };
          if (msgAttachments.length) {
            params.attachment = msgAttachments.join(",");
          }
          const r = await vkCall("messages.send", params);
          if (r.error) throw new Error(r.error.error_msg || JSON.stringify(r.error));
          ok++;
        } catch (err) {
          fail++;
          console.warn(`  ❌ VK ${vkId}: ${err.message || err}`);
        }
        await sleep(55); // VK limit ~20/sec
      }
      console.log(`  VK done: ${ok} sent, ${fail} failed`);
    }
  }

  await pool.end();
  console.log("\n🏁 Broadcast complete.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
