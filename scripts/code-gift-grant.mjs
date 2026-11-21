#!/usr/bin/env node
/**
 * 🎁 Подарочная скидка на коды одному человеку (19.11.2026, `CodeDiscountGrant`).
 *
 *   node scripts/code-gift-grant.mjs --user @username|<userId> --percent 5 \
 *     --reason "извинение: чужой отзыв" --by "владелец" \
 *     [--note-file note.txt] [--message-file msg.html] [--dry-run]
 *
 * --note-file    — личные слова в кабинете (карточка «Подарок от нас»).
 * --message-file — сообщение в Telegram-бот (HTML) с кнопкой «Выбрать код»;
 *                  уходит, если у человека есть tgId.
 * Повторный запуск не дублирует: если у человека уже есть действующий подарок
 * с той же причиной — скрипт останавливается.
 *
 * Тексты держим в файлах вне репозитория: репозиторий публичный.
 */
import pg from "pg";
import dotenv from "dotenv";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const who = arg("user");
const percent = Number(arg("percent") ?? 5);
const reason = arg("reason");
const by = arg("by") ?? "владелец";
const note = arg("note-file") ? readFileSync(arg("note-file"), "utf8").trim() : null;
const message = arg("message-file") ? readFileSync(arg("message-file"), "utf8").trim() : null;
if (!who || !reason || !Number.isInteger(percent) || percent < 1 || percent > 5) {
  console.error("нужны --user, --reason и --percent 1..5");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const user = (await pool.query(
  who.startsWith("@")
    ? `SELECT id, name, "tgId" FROM "User" WHERE lower(username) = lower($1)`
    : `SELECT id, name, "tgId" FROM "User" WHERE id = $1`,
  [who.replace(/^@/, "")],
)).rows[0];
if (!user) { console.error("пользователь не найден"); process.exit(2); }
console.log(`кому: ${user.name ?? "—"} (${user.id}), tg ${user.tgId ? "есть" : "нет"}`);

const dup = (await pool.query(
  `SELECT id FROM "CodeDiscountGrant" WHERE "userId" = $1 AND reason = $2 AND "usedAt" IS NULL AND "revokedAt" IS NULL`,
  [user.id, reason],
)).rows[0];
if (dup) { console.log(`уже есть действующий подарок ${dup.id} — ничего не делаю`); process.exit(0); }

if (DRY) { console.log(`[dry-run] −${percent}% · ${reason}\n${note ?? ""}\n---\n${message ?? ""}`); process.exit(0); }

const id = `cdg${crypto.randomBytes(10).toString("hex")}`;
await pool.query(
  `INSERT INTO "CodeDiscountGrant" (id, "userId", percent, reason, note, "grantedBy") VALUES ($1, $2, $3, $4, $5, $6)`,
  [id, user.id, percent, reason, note, by],
);
console.log(`подарок выдан: ${id} · −${percent}%`);

if (message && user.tgId && process.env.TG_TOKEN) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: user.tgId,
      text: message,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "🎟 Выбрать код со скидкой", callback_data: "codes" }], [{ text: "Кабинет на сайте", url: "https://robloxbank.ru/dashboard" }]] },
    }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(body.ok ? "сообщение в TG доставлено" : `TG не принял: ${body.description ?? res.status}`);
}
await pool.end();
