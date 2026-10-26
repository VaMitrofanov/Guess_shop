#!/usr/bin/env node
/**
 * Разовая рассылка 26.10.2026: «проверь Pending — если робуксы там, всё ок».
 *
 * Повод: Roblox стал держать Pending дольше, чем раньше, а мы до 26.10 обещали
 * «до 7 дней» — у людей с выкупом старше недели это рождало тревогу. Срок из
 * текстов убран (`bots/shared/robux-eta.ts`), а тем, кто сейчас ждёт, пишем один
 * раз лично: где проверить и что «есть в Pending» = с нашей стороны всё.
 *
 * Аудитория: покупатели с COMPLETED-заказом за последние DAYS дней (не тест).
 * Выкуп за последние SURVEY_DAYS дней (включительно) — опрос «пришли ли
 * робуксы?» с кнопками (`robuxSurveyText`, обработчики `rbx_s_*` в ботах,
 * ответы — OrderEvent ROBUX_SURVEY_*); старше — короткое «проверь Pending».
 * Номинал в тексте — последнего выкупа. Канал: TG, иначе VK.
 * Повторный запуск безопасен: отправленные пишутся в журнал (JOURNAL), они
 * пропускаются.
 *
 * Использование: npx tsx scripts/broadcast-pending-check.mjs [--dry-run] [--days=21] [--survey-days=10]
 * (tsx нужен: текст и кнопки опроса берутся из bots/shared/robux-eta.ts)
 */

import fs from "node:fs";
import pg from "pg";
import dotenv from "dotenv";
import { robuxSurveyText, surveyButtons, SURVEY_CMD } from "../bots/shared/robux-eta.ts";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const DRY_RUN = process.argv.includes("--dry-run");
const DAYS = Number(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 21);
const SURVEY_DAYS = Number(process.argv.find((a) => a.startsWith("--survey-days="))?.split("=")[1] ?? 10);
const JOURNAL = "data/broadcast-pending-check-2026-10-26.log";
const { DATABASE_URL, TG_TOKEN, VK_TOKEN } = process.env;
if (!DATABASE_URL || !TG_TOKEN || !VK_TOKEN) throw new Error("DATABASE_URL, TG_TOKEN, VK_TOKEN required");

const TX = "https://www.roblox.com/transactions";

function textFor(amount, html) {
  const b = (s) => (html ? `<b>${s}</b>` : s);
  const link = html ? `<a href="${TX}">roblox.com/transactions</a>` : TX;
  return (
    `💎 ${b(`Про твои робуксы за заказ на ${amount} R$`)}\n\n` +
    `Roblox стал держать робуксы за геймпасс в статусе Pending дольше, чем раньше. ` +
    `Поэтому просим проверить у себя.\n\n` +
    `❗️ ${b("Важно: робуксы должны быть в одном из двух мест — в Pending или уже на балансе.")}\n\n` +
    `🔍 Открой ${link} → строка ${b("Pending Robux")}.\n\n` +
    `✅ Там число не меньше ${amount} — ${b("всё в порядке")}. С нашей стороны всё сделано: робуксы твои, ` +
    `ждём, пока Roblox переведёт их на баланс. Ускорить это не может никто — они придут сами.\n` +
    `💰 Робуксы уже на балансе — отлично, они дошли.\n` +
    `❓ Ни в Pending, ни на балансе их нет — напиши сюда «где робуксы?», поможем проверить.\n\n` +
    `📖 Как это работает: https://robloxbank.ru/pending`
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tgKeyboard(amount) {
  const btn = surveyButtons(amount);
  return { inline_keyboard: [
    [{ text: btn.got, callback_data: SURVEY_CMD.got }],
    [{ text: btn.pending, callback_data: SURVEY_CMD.pending }],
    [{ text: btn.none, callback_data: SURVEY_CMD.none }],
  ] };
}

function vkKeyboard(amount) {
  const btn = surveyButtons(amount);
  const row = (label, command, color) => [{ action: { type: "text", label, payload: JSON.stringify({ command }) }, color }];
  return JSON.stringify({ inline: true, buttons: [
    row(btn.got, SURVEY_CMD.got, "positive"),
    row(btn.pending, SURVEY_CMD.pending, "primary"),
    row(btn.none, SURVEY_CMD.none, "secondary"),
  ] });
}

async function tgSend(chatId, text, replyMarkup) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  const j = await r.json();
  return j.ok ? null : `${j.error_code} ${j.description}`;
}

async function vkSend(userId, text, keyboard) {
  const r = await fetch("https://api.vk.com/method/messages.send", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    // random_id постоянный на человека — VK сам отбросит повтор.
    body: new URLSearchParams({
      access_token: VK_TOKEN, v: "5.131", user_id: String(userId),
      random_id: String(2610_0000 + (Number(userId) % 9_000_000)), message: text, dont_parse_links: "1",
      ...(keyboard ? { keyboard } : {}),
    }),
  });
  const j = await r.json();
  return j.error ? `${j.error.error_code} ${j.error.error_msg}` : null;
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (u.id) u.id, u."tgId", u."vkId", o.amount,
            -- «до N дней включительно» = с начала МСК-дня N дней назад; completedAt — UTC без зоны
            o."completedAt" >= ((date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') - make_interval(days => $2))
                                AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'UTC' AS survey
       FROM "WbOrder" o JOIN "User" u ON u.id = o."userId"
      WHERE o.status = 'COMPLETED' AND o."isTest" = false
        AND o."completedAt" > now() - make_interval(days => $1)
        AND (u."tgId" IS NOT NULL OR u."vkId" IS NOT NULL)
      ORDER BY u.id, o."completedAt" DESC`,
    [DAYS, SURVEY_DAYS],
  );
  await pool.end();

  const done = new Set(fs.existsSync(JOURNAL) ? fs.readFileSync(JOURNAL, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t")[0]) : []);
  const todo = rows.filter((r) => !done.has(r.id));
  const tg = todo.filter((r) => r.tgId).length;
  const survey = todo.filter((r) => r.survey).length;
  console.log(`${DRY_RUN ? "DRY RUN: " : ""}${DAYS} дн.: всего ${rows.length}, уже отправлено ${rows.length - todo.length}, к отправке ${todo.length} (TG ${tg}, VK ${todo.length - tg}); опрос ${survey}, «проверь Pending» ${todo.length - survey}`);
  if (DRY_RUN) {
    console.log("\n--- опрос (TG) ---\n" + robuxSurveyText("html", 800) + "\n" + JSON.stringify(tgKeyboard(800)));
    console.log("\n--- проверь Pending (TG) ---\n" + textFor(800, true));
    return;
  }

  const res = { tgOk: 0, tgFail: 0, vkOk: 0, vkFail: 0, vkFallbackOk: 0 };
  const errors = {};
  fs.mkdirSync("data", { recursive: true });
  for (const u of todo) {
    let err = null;
    let via = null;
    if (u.tgId) {
      err = await tgSend(u.tgId, u.survey ? robuxSurveyText("html", u.amount) : textFor(u.amount, true), u.survey ? tgKeyboard(u.amount) : undefined);
      via = "tg";
      if (err) { res.tgFail++; errors[err] = (errors[err] ?? 0) + 1; } else res.tgOk++;
      await sleep(60);
    }
    if (u.vkId && (!u.tgId || err)) {
      const vErr = await vkSend(u.vkId, u.survey ? robuxSurveyText("plain", u.amount) : textFor(u.amount, false), u.survey ? vkKeyboard(u.amount) : undefined);
      if (vErr) { res.vkFail++; errors[`vk ${vErr}`] = (errors[`vk ${vErr}`] ?? 0) + 1; }
      else { if (u.tgId) res.vkFallbackOk++; else res.vkOk++; err = null; via = "vk"; }
      await sleep(350);
    }
    if (!err) fs.appendFileSync(JOURNAL, `${u.id}\t${via}\t${u.survey ? "survey" : "check"}\t${new Date().toISOString()}\n`);
  }
  console.log(JSON.stringify(res));
  console.log("ошибки:", JSON.stringify(errors));
}

main().catch((e) => { console.error(e?.message ?? e); process.exitCode = 1; });
