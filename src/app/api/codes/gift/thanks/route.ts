import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isGiftTokenShape } from "@/lib/codes/gift";
import { noStore } from "@/lib/codes/http";
import { thankGiver } from "@/lib/codes/gift-share";

export const dynamic = "force-dynamic";

/** ♥ на открытке: одно «спасибо» дарителю письмом (19.11.2026). Токен — в теле. */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`codes-gift-thanks:${clientIp(req)}`, 6, 1 / 20);
  if (!limit.ok) return NextResponse.json({ error: "Слишком часто." }, { status: 429 });
  const body = await req.json().catch(() => null) as { token?: unknown } | null;
  if (!isGiftTokenShape(body?.token)) return NextResponse.json({ error: "Подарок не найден." }, { status: 404 });
  const result = await thankGiver(body.token);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
