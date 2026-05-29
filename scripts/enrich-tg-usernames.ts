/**
 * Backfill User.username (TG @handle) for existing users.
 *
 * Run on the SG host where the TG bot lives (TG API is reachable from there).
 * For each User with tgId but no username, calls getChat(tgId) and writes
 * the returned username + an updated name back to the row.
 *
 * Usage (inside the TG bot container or anywhere with TG_TOKEN + DATABASE_URL):
 *   tsx scripts/enrich-tg-usernames.ts
 *   tsx scripts/enrich-tg-usernames.ts --force   # also re-check users that already have a username
 *
 * Safe to re-run; updates are no-op if nothing changed.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "pg";

// @ts-ignore
const { Pool } = pkg;

const TG_TOKEN = process.env.TG_TOKEN;
if (!TG_TOKEN) { console.error("TG_TOKEN missing"); process.exit(1); }

const FORCE = process.argv.includes("--force");

const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter } as any);

interface ChatResult {
  ok: boolean;
  result?: { id: number; username?: string; first_name?: string; last_name?: string };
  description?: string;
}

async function getChat(tgId: string): Promise<ChatResult> {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getChat?chat_id=${tgId}`);
  return r.json() as Promise<ChatResult>;
}

async function main() {
  const where: any = FORCE
    ? { tgId: { not: null } }
    : { tgId: { not: null }, OR: [{ username: null }, { name: null }] };

  const users = await (prisma as any).user.findMany({
    where, select: { id: true, tgId: true, username: true, name: true },
  });
  console.log(`📋 Found ${users.length} TG users to enrich`);

  let touched = 0, blocked = 0, unchanged = 0, errors = 0;
  for (const u of users) {
    try {
      const chat = await getChat(u.tgId);
      if (!chat.ok) {
        // 403 "bot was blocked" / "chat not found" — non-fatal, common after the user removes the bot
        if (/blocked|not found|deactivated/i.test(chat.description ?? "")) blocked++;
        else errors++;
        continue;
      }
      const newUsername = chat.result?.username ?? null;
      const newName     = [chat.result?.first_name, chat.result?.last_name].filter(Boolean).join(" ") || null;

      const patch: any = {};
      if (newUsername !== u.username) patch.username = newUsername;
      if (newName && newName !== u.name) patch.name = newName;
      if (Object.keys(patch).length === 0) { unchanged++; continue; }

      await (prisma as any).user.update({ where: { id: u.id }, data: patch });
      console.log(`✓ ${u.tgId} → ${patch.username ? `@${patch.username}` : ""} ${patch.name ?? ""}`);
      touched++;
    } catch (e: any) {
      errors++;
      console.error(`  err ${u.tgId}: ${e.message}`);
    }
    // soft rate-limit — getChat is cheap but we still respect ~30 req/s
    await new Promise(r => setTimeout(r, 40));
  }

  console.log(`\nDone. touched=${touched} blocked=${blocked} unchanged=${unchanged} errors=${errors}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await (prisma as any).$disconnect(); await pool.end(); });
