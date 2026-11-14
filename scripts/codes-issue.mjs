#!/usr/bin/env node
/**
 * 🎟 Ручная выдача кодов по оплаченным заказам (15.11.2026, `CODES_BACKORDER=true`).
 *
 *   node scripts/codes-issue.mjs queue
 *       — кто оплатил и ждёт код (+ последние выданные). Без почт и кодов.
 *   node scripts/codes-issue.mjs issue CODE-XXXXXXXX <код> [номинал]
 *       — закрепить код за заказом и доставить: письмо / открытка / чат бота.
 *         Номинал (необязательно) — сверка: не совпал с заказом → отказ.
 *
 * Нужны env: BOT_PAYMENT_API_SECRET (как у Web/ботов) и CODES_WEB_URL
 * (по умолчанию https://robloxbank.ru). Код в выводе не печатается.
 */
import crypto from "node:crypto";

const secret = process.env.BOT_PAYMENT_API_SECRET?.trim();
const base = (process.env.CODES_WEB_URL ?? "https://robloxbank.ru").replace(/\/$/, "");
if (!secret || secret.length < 32) {
  console.error("Нужен BOT_PAYMENT_API_SECRET (тот же, что в Coolify у Web).");
  process.exit(2);
}

async function call(path, payload) {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bot-payment-timestamp": timestamp, "x-bot-payment-signature": signature },
    body,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

const rub = (kopecks) => `${(kopecks / 100).toLocaleString("ru-RU")} ₽`;
const when = (iso) => (iso ? new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) + " МСК" : "—");

const [command, publicId, code, denomination] = process.argv.slice(2);

if (command === "queue") {
  const { status, data } = await call("/api/internal/codes/queue", {});
  if (status !== 200) { console.error("Отказ:", status, data); process.exit(1); }
  console.log(`Ждут код: ${data.waiting.length}`);
  for (const order of data.waiting) {
    console.log(`  ${order.publicId} · ${order.denomination} R$ · ${rub(order.finalAmountKopecks)} · ${order.channel} · ${order.deliveryMode}${order.giftSendAt ? ` · открытка ${when(order.giftSendAt)}` : ""} · оплачен ${when(order.paidAt)}`);
  }
  console.log(`\nПоследние выданные:`);
  for (const order of data.recent) {
    const mail = order.emailSentAt ? "письмо ✓" : order.emailLastError ? `письмо ✗ (${order.emailLastError})` : "письма нет";
    const chat = order.channel === "SITE" ? "" : order.chatDeliveredAt ? " · чат ✓" : " · чат ✗";
    console.log(`  ${order.publicId} · ${order.denomination} R$ · ${order.deliveryMode} · ${mail}${chat} · ${when(order.issuedAt)}`);
  }
} else if (command === "issue" && publicId && code) {
  const payload = { publicId, code, ...(denomination ? { denomination: Number(denomination) } : {}) };
  const { status, data } = await call("/api/internal/codes/issue", payload);
  if (data.ok) {
    console.log(`✅ ${data.publicId}: код выдан · письмо: ${data.email} · чат: ${data.chat === null ? "—" : data.chat ? "✓" : "✗"}`);
  } else {
    const reasons = {
      not_found: "заказа нет", not_paid: "заказ не оплачен", already: "код уже выдан (второй не выдаём)",
      refunded: "деньги возвращены", duplicate_code: "этот код уже есть в базе", bad_code: "код странной формы",
      denomination_mismatch: "номинал не совпал с заказом", bad_request: "проверь номер заказа",
    };
    console.error(`✗ ${status}: ${reasons[data.status] ?? data.status ?? "ошибка"}`);
    process.exit(1);
  }
} else {
  console.log("node scripts/codes-issue.mjs queue | issue CODE-XXXXXXXX <код> [номинал]");
  process.exit(2);
}
