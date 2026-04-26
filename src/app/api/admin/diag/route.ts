/**
 * GET /api/admin/diag
 *
 * Diagnostic endpoint — surfaces enough of the runtime configuration to
 * pinpoint why an auth/notification flow is failing in production without
 * leaking any secrets.
 *
 * Auth: Bearer token via ADMIN_SECRET env variable.
 *
 * Optional query params:
 *   ?test_tg=1         → also send a probe message to every chat in TG_CHAT_ID
 *   ?test_db=1         → also run a small SELECT against Prisma to verify DB
 *
 * Response:
 * {
 *   ok: boolean,
 *   env: { [name]: { present: boolean, hint?: string } },
 *   db?: { ok: boolean, error?: string, wbCodeCount?: number },
 *   tg?: { token: boolean, chatIds: string[], sendResults?: { chatId: string, ok: boolean, status?: number, body?: string }[] }
 * }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function envFlag(name: string, hint?: string) {
  const v = process.env[name];
  return { present: Boolean(v && v.length > 0), hint };
}

async function probeTg(token: string, chatId: string) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "✅ /api/admin/diag probe — TG notify path works.",
      }),
    });
    const body = await res.text();
    return { chatId, ok: res.ok, status: res.status, body: body.slice(0, 240) };
  } catch (err) {
    return { chatId, ok: false, body: String(err).slice(0, 240) };
  }
}

export async function GET(request: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json(
      { ok: false, error: "ADMIN_SECRET is not set on the server" },
      { status: 500 }
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${adminSecret}`;
  if (auth !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const wantTgProbe = url.searchParams.get("test_tg") === "1";
  const wantDbProbe = url.searchParams.get("test_db") === "1";

  // ── Env presence (no values exposed) ──────────────────────────────────
  const env = {
    NODE_ENV:             { present: Boolean(process.env.NODE_ENV), hint: process.env.NODE_ENV },
    NEXTAUTH_SECRET:      envFlag("NEXTAUTH_SECRET",      "Required by NextAuth — missing → 'Configuration' error"),
    NEXTAUTH_URL:         envFlag("NEXTAUTH_URL",         "Must match the public origin, e.g. https://www.robloxbank.ru"),
    DATABASE_URL:         envFlag("DATABASE_URL",         "Postgres connection string (Neon)"),
    TG_TOKEN:             envFlag("TG_TOKEN",             "Telegram bot token (@RobloxBankBot)"),
    TG_CHAT_ID:           envFlag("TG_CHAT_ID",           "Comma-separated admin chat ids"),
    NEXT_PUBLIC_VK_APP_ID:envFlag("NEXT_PUBLIC_VK_APP_ID","Public VK ID app id"),
    VK_TOKEN:             envFlag("VK_TOKEN",             "Community access token (bot-only)"),
    VK_GROUP_ID:          envFlag("VK_GROUP_ID",          "Community ID (bot-only)"),
    ADMIN_SECRET:         { present: true, hint: "validated via this very request" },
  };

  // ── DB probe (optional) ───────────────────────────────────────────────
  let dbResult: { ok: boolean; error?: string; wbCodeCount?: number } | undefined;
  if (wantDbProbe) {
    try {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "WbCode"`;
      const wbCodeCount = Number(rows?.[0]?.count ?? 0);
      dbResult = { ok: true, wbCodeCount };
    } catch (err) {
      dbResult = {
        ok: false,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      };
    }
  }

  // ── TG probe (optional) ───────────────────────────────────────────────
  let tgResult:
    | {
        token: boolean;
        chatIds: string[];
        sendResults?: Array<{ chatId: string; ok: boolean; status?: number; body?: string }>;
      }
    | undefined;

  const token   = process.env.TG_TOKEN;
  const chatIds = (process.env.TG_CHAT_ID ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  if (wantTgProbe) {
    if (token && chatIds.length > 0) {
      const sendResults = await Promise.all(chatIds.map((c) => probeTg(token, c)));
      tgResult = { token: true, chatIds, sendResults };
    } else {
      tgResult = { token: Boolean(token), chatIds, sendResults: [] };
    }
  } else {
    tgResult = { token: Boolean(token), chatIds };
  }

  return NextResponse.json({
    ok: true,
    runtime: {
      now: new Date().toISOString(),
      node: process.version,
    },
    env,
    db: dbResult,
    tg: tgResult,
  });
}
