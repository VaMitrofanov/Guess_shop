#!/usr/bin/env node
/**
 * Разовый перевод автозаморозок в пометки (11.11.2026).
 *
 * Заявка WB без решения и «висяк» гейта с этого дня — пометка, а не заморозка.
 * Скрипт снимает такие автозаморозки с открытых заказов и вешает пометку:
 *   «Возврат на WB: покупатель открыл заявку…» (автозащита)  → CLAIM
 *   «заказ висит N дн. без выкупа…» (гейт выкупа)            → STALE
 * Плохой отзыв, одобренный возврат и ручные заморозки не трогает.
 *
 * Без --apply только показывает. Запускать ПОСЛЕ деплоя кода с пометками.
 *   node scripts/holds-to-flags.mjs [--apply]
 */
import fs from "fs";
import pg from "pg";

const apply = process.argv.includes("--apply");
const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? env.DATABASE_URL });
await db.connect();

const ACTOR = "пометки 11.11";
const CLAIM_HEAD = "Возврат на WB: покупатель открыл заявку";
const stamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const { rows } = await db.query(`
  SELECT o.id, o."wbCode", o."heldBy", o."heldReason", o."heldAt", o.flags, o."adminNote",
         m."claimOpenedAt", m."claimReason"
    FROM "WbOrder" o
    LEFT JOIN "WbCode" c ON c.code = o."wbCode"
    LEFT JOIN "WbMarketplaceOrder" m ON m."wbCodeId" = c.id
   WHERE o."heldAt" IS NOT NULL AND o.status NOT IN ('COMPLETED','REJECTED')
     AND ((o."heldBy" LIKE 'автозащита%' AND o."heldReason" LIKE $1)
       OR (o."heldBy" = 'гейт выкупа' AND o."heldReason" LIKE 'заказ висит %'))`, [`${CLAIM_HEAD}%`]);

for (const o of rows) {
  const kind = o.heldReason.startsWith(CLAIM_HEAD) ? "CLAIM" : "STALE";
  const detail = kind === "CLAIM"
    ? (o.claimReason ?? o.heldReason.match(/«(.*)»/)?.[1] ?? null)
    : null;
  const at = kind === "CLAIM" ? (o.claimOpenedAt ?? o.heldAt) : o.heldAt;
  console.log(`${apply ? "→" : "·"} ${o.wbCode}  ${kind}  ${detail ?? ""}`);
  if (!apply) continue;

  const flags = Array.isArray(o.flags) ? o.flags : [];
  if (!flags.some((f) => f.kind === kind)) flags.push({ kind, detail, at: new Date(at).toISOString() });
  const open = flags.filter((f) => !f.ackAt).map((f) => new Date(f.at).getTime());
  const note = `[РАЗМОРОЗКА ${stamp} · ${ACTOR}] заморозка → пометка ${kind === "CLAIM" ? "«Возврат открыт»" : "«Висит»"}`;

  await db.query("BEGIN");
  await db.query(
    `UPDATE "OrderHold" SET "releasedAt" = NOW(), "releasedBy" = $2 WHERE "wbCode" = $1 AND "releasedAt" IS NULL`,
    [o.wbCode, ACTOR],
  );
  await db.query(
    `UPDATE "WbOrder" SET "heldAt" = NULL, "heldReason" = NULL, "heldBy" = NULL,
            flags = $2::jsonb, "flaggedAt" = $3, "adminNote" = LEFT($4 || COALESCE(E'\\n' || "adminNote", ''), 2000)
      WHERE id = $1`,
    [o.id, JSON.stringify(flags), open.length ? new Date(Math.min(...open)) : null, note],
  );
  await db.query("COMMIT");
}
console.log(`${rows.length} заказов${apply ? " переведено" : " будет переведено (запусти с --apply)"}`);
await db.end();
