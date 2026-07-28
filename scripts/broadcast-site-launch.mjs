#!/usr/bin/env node
/**
 * One-time public launch announcement for the RobloxBank website.
 *
 * Safe by default: without --publish this script only prints the final TG/VK copy.
 * Live publication is allowed only when the public acquiring status reports mode=on.
 *
 * Usage:
 *   node scripts/broadcast-site-launch.mjs
 *   node scripts/broadcast-site-launch.mjs --publish
 *
 * Env for --publish: TG_TOKEN, TG_CHANNEL_ID, VK_TOKEN, VK_GROUP_ID
 */

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const PUBLISH = process.argv.includes("--publish");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--publish");
if (unknownArgs.length) throw new Error(`Unknown arguments: ${unknownArgs.join(", ")}`);

const SITE_URL = "https://robloxbank.ru/";
const STATUS_URL = new URL("api/acquiring/status", SITE_URL).toString();

const TG_TEXT = `💜 <b>RobloxBank теперь работает на собственном сайте</b>

Друзья, сейчас для RobloxBank непростое время.

Наши товары находились на складах Wildberries, пострадавших в последние дни. Практически все запасы были утрачены, поэтому карточки на WB временно недоступны для покупки. Для нас это серьёзный удар — в эти товары было вложено много сил.

Но мы не сдаёмся и открываем для вас полноценный сайт RobloxBank.

Теперь на сайте можно:

• выбрать нужное количество Robux и заранее увидеть точную стоимость;
• указать свой Roblox-ник и выбрать подходящий геймпасс;
• оплатить заказ картой или через СБП на защищённой странице Т‑Банка — в том числе из приложения Альфа‑Банка;
• отслеживать текущие и предыдущие заказы в личном кабинете;
• видеть статус выполнения и хранить историю покупок в одном месте;
• открыть пошаговую инструкцию по созданию геймпасса;
• войти через Telegram, ВКонтакте или email.

Это особенно удобно для родителей: больше не нужно переводить деньги по незнакомым реквизитам. Оплата проходит через официальную банковскую форму — привычно и понятно, как при покупке на обычном маркетплейсе.

Если раньше вы оформляли заказы через нашего Telegram-бота или ВКонтакте, войдите на сайт через тот же Telegram- или VK-профиль — история покупок будет собрана в одном кабинете.

🌐 <a href="https://robloxbank.ru/">Открыть RobloxBank</a>
👤 <a href="https://robloxbank.ru/dashboard">Войти в личный кабинет</a>
📖 <a href="https://robloxbank.ru/guide?source=site">Пошаговая инструкция</a>
💬 Поддержка: @RobloxBank_PA

Собственный сайт делает RobloxBank удобнее, надёжнее и независимее от маркетплейсов. Мы продолжим развивать его, добавлять новые возможности и улучшать процесс покупки.

Спасибо, что остаётесь с нами. Мы восстановимся, станем сильнее и продолжим двигаться вперёд вместе с вами. 💜`;

const VK_TEXT = TG_TEXT
  .replaceAll(/<a href="([^"]+)">([^<]+)<\/a>/g, "$2: $1")
  .replaceAll(/<[^>]+>/g, "");

async function assertPublicAcquiringIsOn() {
  const response = await fetch(STATUS_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Launch preflight failed: ${STATUS_URL} returned ${response.status}`);

  const status = await response.json();
  if (status.mode !== "on" || status.available !== true) {
    throw new Error(
      `Launch preflight refused publication: acquiring mode=${status.mode ?? "unknown"}, available=${String(status.available)}`,
    );
  }
}

async function tgCall(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(`Telegram publication failed: ${payload.description ?? response.status}`);
  }
  return payload.result;
}

async function vkCall(token, method, params) {
  const response = await fetch(`https://api.vk.com/method/${method}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: token, v: "5.131", ...params }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(`VK publication failed: ${payload.error?.error_msg ?? response.status}`);
  }
  return payload.response;
}

async function main() {
  if (!PUBLISH) {
    console.log("PREVIEW ONLY — nothing will be published\n");
    console.log("--- Telegram ---\n");
    console.log(TG_TEXT);
    console.log("\n--- VK ---\n");
    console.log(VK_TEXT);
    console.log("\nRun with --publish only after the public acquiring rollout.");
    return;
  }

  const { TG_TOKEN, TG_CHANNEL_ID, VK_TOKEN, VK_GROUP_ID } = process.env;
  if (!TG_TOKEN || !TG_CHANNEL_ID || !VK_TOKEN || !VK_GROUP_ID) {
    throw new Error("TG_TOKEN, TG_CHANNEL_ID, VK_TOKEN and VK_GROUP_ID are required for --publish");
  }

  await assertPublicAcquiringIsOn();

  const telegram = await tgCall(TG_TOKEN, "sendMessage", {
    chat_id: TG_CHANNEL_ID,
    text: TG_TEXT,
    parse_mode: "HTML",
    disable_web_page_preview: false,
  });
  const vk = await vkCall(VK_TOKEN, "wall.post", {
    owner_id: `-${VK_GROUP_ID}`,
    from_group: "1",
    message: VK_TEXT,
  });

  console.log(JSON.stringify({ telegramMessageId: telegram.message_id, vkPostId: vk.post_id }));
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
