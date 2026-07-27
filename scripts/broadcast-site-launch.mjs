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

const TG_TEXT = `🚀 <b>Представляем robloxbank.ru — новый сайт RobloxBank</b>

RobloxBank — сервис покупки Robux через геймпассы. Теперь весь путь собран в одном месте:

• выбери нужное количество Robux и сразу узнай стоимость;
• найди свой Roblox-аккаунт и подходящий геймпасс;
• оплати заказ доступным способом на защищённой странице Т‑Банка;
• следи за заказом и историей покупок в личном кабинете;
• если нужна помощь — открой пошаговую инструкцию или напиши поддержке.

🌐 <a href="https://robloxbank.ru/">Открыть сайт</a>
📖 <a href="https://robloxbank.ru/guide?source=site">Как купить Robux</a>
💬 Поддержка: @RobloxBank_PA

Сайт уже открыт. Первые заказы мы контролируем особенно внимательно. Если появится вопрос, пришли поддержке номер заказа — так мы быстрее всё проверим.

RobloxBank не является банком и не связан с Roblox Corporation.

🤍 Команда RobloxBank`;

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
    console.log("\nRun with --publish only after secret rotation and the public acquiring rollout.");
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
