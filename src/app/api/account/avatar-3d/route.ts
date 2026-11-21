import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { loadAvatar3d } from "@/lib/roblox-avatar-3d";
import { loadCustomerRobloxProfile } from "@/lib/roblox-profile";

/* 🧊 Адрес 3D-модели персонажа для карточки кабинета (19.11.2026).
   Только свой персонаж: id Roblox берём из профиля сессии, не из запроса —
   служебная сессия Roblox не должна работать как открытый прокси. */

export const dynamic = "force-dynamic";
const PRIVATE = { "cache-control": "private, no-store" } as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ status: "off" }, { status: 401, headers: PRIVATE });
  const limited = rateLimit(`avatar-3d:${userId}:${clientIp(req)}`, 20, 1 / 10);
  if (!limited.ok) return NextResponse.json({ status: "off" }, { status: 429, headers: PRIVATE });
  const { profile } = await loadCustomerRobloxProfile(userId);
  const result = await loadAvatar3d(profile?.id ?? null);
  return NextResponse.json(result, { headers: PRIVATE });
}
