import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  addCustomerRobloxAccount,
  disconnectCustomerRobloxProfile,
  loadCustomerRobloxProfile,
  selectCustomerRobloxAccount,
} from "@/lib/roblox-profile";

export const dynamic = "force-dynamic";
const PRIVATE = { "cache-control": "private, no-store" } as const;

async function ownUserId() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function GET(req: NextRequest) {
  const userId = await ownUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
  const limited = rateLimit(`account-roblox:${userId}:${clientIp(req)}`, 8, 1 / 30);
  if (!limited.ok) return NextResponse.json({ error: "Слишком много обновлений" }, { status: 429, headers: { ...PRIVATE, "retry-after": String(limited.retryAfter) } });
  return NextResponse.json(await loadCustomerRobloxProfile(userId), { headers: PRIVATE });
}

export async function PATCH(req: NextRequest) {
  const userId = await ownUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
  const limited = rateLimit(`account-roblox-change:${userId}:${clientIp(req)}`, 5, 1 / 60);
  if (!limited.ok) return NextResponse.json({ error: "Слишком много попыток. Попробуйте позже." }, { status: 429, headers: { ...PRIVATE, "retry-after": String(limited.retryAfter) } });

  const body = await req.json().catch(() => ({}));
  if (body.action === "select") {
    const accountId = typeof body.accountId === "string" ? body.accountId : "";
    const result = await selectCustomerRobloxAccount(userId, accountId);
    if (result.status === "not-found") {
      return NextResponse.json({ error: "Roblox-аккаунт не найден" }, { status: 404, headers: PRIVATE });
    }
    return NextResponse.json(result, { headers: PRIVATE });
  }
  const username = typeof body.username === "string" ? body.username : "";
  const result = await addCustomerRobloxAccount(userId, username);
  if (result.status === "not-found" || result.status === "missing-username") {
    return NextResponse.json({ error: "Пользователь Roblox не найден" }, { status: 404, headers: PRIVATE });
  }
  return NextResponse.json(result, { headers: PRIVATE });
}

export async function DELETE(req: NextRequest) {
  const userId = await ownUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
  const limited = rateLimit(`account-roblox-disconnect:${userId}:${clientIp(req)}`, 5, 1 / 60);
  if (!limited.ok) return NextResponse.json({ error: "Слишком много попыток. Попробуйте позже." }, { status: 429, headers: { ...PRIVATE, "retry-after": String(limited.retryAfter) } });
  const body = await req.json().catch(() => ({}));
  const accountId = typeof body.accountId === "string" ? body.accountId : null;
  return NextResponse.json(await disconnectCustomerRobloxProfile(userId, accountId), { headers: PRIVATE });
}
