import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  disconnectCustomerRobloxProfile,
  loadCustomerRobloxProfile,
  refreshCustomerRobloxProfile,
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
  const username = typeof body.username === "string" ? body.username : "";
  const result = await refreshCustomerRobloxProfile(userId, username);
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
  await disconnectCustomerRobloxProfile(userId);
  return NextResponse.json({ ok: true }, { headers: PRIVATE });
}
