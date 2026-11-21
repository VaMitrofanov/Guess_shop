import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { validateProfileStyleInput } from "@/lib/profile-style";

/* 🪪 Сохранить карточку профиля (18.11.2026): имя, вид аватара, фон. */

export const dynamic = "force-dynamic";
const PRIVATE = { "cache-control": "private, no-store" } as const;

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Войдите в кабинет" }, { status: 401, headers: PRIVATE });
  const limited = rateLimit(`profile-style:${userId}:${clientIp(req)}`, 10, 1 / 20);
  if (!limited.ok) {
    return NextResponse.json({ error: "Слишком часто. Попробуйте через минуту." }, { status: 429, headers: { ...PRIVATE, "retry-after": String(limited.retryAfter) } });
  }
  const parsed = validateProfileStyleInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: PRIVATE });
  await prisma.user.update({ where: { id: userId }, data: { profileStyle: parsed.style as unknown as Prisma.InputJsonValue } });
  return NextResponse.json({ ok: true, style: parsed.style }, { headers: PRIVATE });
}
