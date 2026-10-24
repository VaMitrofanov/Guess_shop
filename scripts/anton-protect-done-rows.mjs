#!/usr/bin/env node
/**
 * Этап 5.8: бэкфилл/ремонт защит выполненных строк таблицы Антона (addProtectedRange).
 *
 * Инвариант: DONE-задача GOOGLE_SHEETS с живой строкой = строка A:D залочена
 * (редакторы — владелец таблицы + сервисный аккаунт бота). Обычно защиту ставит
 * сам бот (write-back «готово» / sync), скрипт нужен для:
 *   - бэкфилла строк, выкупленных до деплоя 5.8;
 *   - ремонта после сбоев Google (упавший addProtectedRange);
 *   - аудита: показывает и «осиротевшие» защиты бота без DONE-задачи (не трогает их).
 *
 * Без флагов — dry-run: печатает план, ничего не меняет. `--apply` — выполняет.
 *
 * Env: DATABASE_URL, GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON,
 *      GOOGLE_SHEETS_PROTECTED_EDITORS (email владельца таблицы, через запятую).
 *
 * Usage: node scripts/anton-protect-done-rows.mjs [--apply]
 */
import { createSign } from "crypto";
import pg from "pg";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const APPLY = process.argv.includes("--apply");
const PROTECTION_PREFIX = "Заблокировано ботом";
const PROTECTION_END_COLUMN = 4; // A:D (E — канал комментариев, не лочится)

// --- Google service account auth (тот же флоу, что src/lib/google-sheets.ts) ---

const rawAccount = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON?.trim();
if (!rawAccount) {
  console.error("GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON не задан (нужен локально для этого скрипта)");
  process.exit(1);
}
const account = JSON.parse(rawAccount);

const editors = [...new Set([
  account.client_email,
  ...(process.env.GOOGLE_SHEETS_PROTECTED_EDITORS || "").split(",").map((v) => v.trim()).filter(Boolean),
])];
if (editors.length < 2) {
  console.warn("⚠️ GOOGLE_SHEETS_PROTECTED_EDITORS пуст — в редакторах защиты будет только сервисный аккаунт");
}

const base64Url = (value) => Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

async function getAccessToken() {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: account.token_uri || "https://oauth2.googleapis.com/token",
    exp: issuedAt + 3600,
    iat: issuedAt,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const assertion = `${header}.${payload}.${base64Url(signer.sign(account.private_key))}`;
  const response = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const json = await response.json();
  if (!response.ok || !json.access_token) {
    throw new Error(`Google OAuth failed: ${json.error_description || json.error || response.status}`);
  }
  return json.access_token;
}

const token = await getAccessToken();

async function googleFetch(path, init = {}) {
  const response = await fetch(`https://sheets.googleapis.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google Sheets API ${response.status}: ${data.error?.message || "request failed"}`);
  return data;
}

// --- Задачи из БД ---

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows: partners } = await client.query(`SELECT id FROM "Partner" WHERE slug = 'anton'`);
if (partners.length !== 1) {
  console.error("Партнёр anton не найден");
  process.exit(1);
}

const { rows: tasks } = await client.query(
  `SELECT id, "gamepassId" AS gp, "robloxUsername" AS nick, "sheetRaw" AS raw
   FROM "PartnerBuyoutTask"
   WHERE "partnerId" = $1 AND "externalSource" = 'GOOGLE_SHEETS' AND status = 'DONE'
   ORDER BY "createdAt"`,
  [partners[0].id],
);

const spreadsheetIds = [...new Set(tasks.map((t) => t.raw?.spreadsheetId).filter(Boolean))];
if (spreadsheetIds.length === 0) {
  console.log("DONE-задач Google Sheets нет — делать нечего");
  process.exit(0);
}

for (const spreadsheetId of spreadsheetIds) {
  console.log(`\n=== Таблица ${spreadsheetId} ===`);
  const meta = await googleFetch(
    `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent("sheets(properties(sheetId,title),protectedRanges(protectedRangeId,description,range))")}`,
  );
  const sheetIdByTitle = new Map();
  const protections = [];
  for (const sheet of meta.sheets || []) {
    if (sheet.properties?.title) sheetIdByTitle.set(sheet.properties.title, sheet.properties.sheetId);
    for (const p of sheet.protectedRanges || []) {
      if (typeof p.protectedRangeId === "number") protections.push(p);
    }
  }
  const botProtections = protections.filter((p) => (p.description || "").startsWith(PROTECTION_PREFIX));
  console.log(`Защит всего: ${protections.length}, из них бота: ${botProtections.length}`);

  const findRowProtection = (sheetId, rowNumber) => botProtections.find((p) => p.range?.sheetId === sheetId
    && p.range?.startRowIndex === rowNumber - 1 && p.range?.endRowIndex === rowNumber) || null;

  const requests = [];
  const pendingTasks = [];
  const matchedProtectionIds = new Set();
  let ok = 0;
  let healed = 0;
  let skipped = 0;

  for (const task of tasks) {
    const raw = task.raw || {};
    if (raw.spreadsheetId !== spreadsheetId) continue;
    const label = `${task.nick || "?"} / GP ${task.gp || "?"} (${raw.sheetTitle}:${raw.rowNumber})`;
    if (raw.rowDeletedFromSheet || raw.rowReusedForNewOrder) {
      skipped += 1;
      console.log(`  – пропуск (строки больше нет/переиспользована): ${label}`);
      continue;
    }
    const sheetId = typeof raw.sheetId === "number" ? raw.sheetId : sheetIdByTitle.get(raw.sheetTitle);
    const rowNumber = Number(raw.rowNumber);
    if (sheetId == null || !Number.isInteger(rowNumber) || rowNumber < 1) {
      skipped += 1;
      console.log(`  – пропуск (нет sheetId/rowNumber): ${label}`);
      continue;
    }
    const existing = findRowProtection(sheetId, rowNumber);
    if (existing) matchedProtectionIds.add(existing.protectedRangeId);
    if (typeof raw.protectedRangeId === "number" && existing?.protectedRangeId === raw.protectedRangeId) {
      ok += 1;
      continue;
    }
    if (existing) {
      healed += 1;
      console.log(`  ~ защита уже стоит, дописываю id задаче: ${label}`);
      if (APPLY) {
        await client.query(
          `UPDATE "PartnerBuyoutTask"
           SET "sheetRaw" = "sheetRaw" || jsonb_build_object('protectedRangeId', $2::int, 'protectedAt', $3::text, 'protectError', null)
           WHERE id = $1`,
          [task.id, existing.protectedRangeId, new Date().toISOString()],
        );
      }
      continue;
    }
    console.log(`  + ставлю защиту: ${label}`);
    pendingTasks.push({ taskId: task.id, requestIndex: requests.length });
    requests.push({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: PROTECTION_END_COLUMN },
          description: `${PROTECTION_PREFIX} (строка ${rowNumber})`,
          warningOnly: false,
          editors: { users: editors },
        },
      },
    });
  }

  const orphans = botProtections.filter((p) => !matchedProtectionIds.has(p.protectedRangeId));
  if (orphans.length > 0) {
    console.log(`  ⚠️ Осиротевшие защиты бота без DONE-задачи (не трогаю): ${orphans.map((p) => `#${p.protectedRangeId} ${p.description}`).join("; ")}`);
  }

  console.log(`Итог: уже ок ${ok} · дописать id ${healed} · поставить ${pendingTasks.length} · пропуск ${skipped}`);
  if (!APPLY) {
    console.log("Dry-run: изменений нет. Запусти с --apply для выполнения.");
    continue;
  }
  if (requests.length === 0) continue;

  const result = await googleFetch(`/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
  for (const pending of pendingTasks) {
    const id = result.replies?.[pending.requestIndex]?.addProtectedRange?.protectedRange?.protectedRangeId;
    await client.query(
      `UPDATE "PartnerBuyoutTask"
       SET "sheetRaw" = "sheetRaw" || jsonb_build_object('protectedRangeId', $2::int, 'protectedAt', $3::text, 'protectError', null)
       WHERE id = $1`,
      [pending.taskId, id ?? null, new Date().toISOString()],
    );
  }
  console.log(`Поставлено защит: ${pendingTasks.length} ✅`);
}

await client.end();
