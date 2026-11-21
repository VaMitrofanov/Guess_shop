import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { noStore, sessionUserId } from "@/lib/codes/http";
import { revokeSharedGift, shareIssuedCode, validateShare } from "@/lib/codes/gift-share";

export const dynamic = "force-dynamic";

/**
 * 🎁 «Подарить» купленный код из кабинета (19.11.2026): открытка + ссылка
 * (или письмо получателю). `{ action: "revoke" }` — «Вернуть себе», пока
 * подарок не открыт. Только владельцу заказа, по его сессии.
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`codes-gift-share:${clientIp(req)}`, 10, 1 / 12);
  if (!limit.ok) return NextResponse.json({ error: "Слишком часто. Попробуйте через минуту." }, { status: 429 });
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.orderId !== "string") return NextResponse.json({ error: "Код не найден." }, { status: 404 });

  if (body.action === "revoke") {
    const result = await revokeSharedGift(userId, body.orderId);
    return result.ok
      ? NextResponse.json({ ok: true }, { headers: noStore })
      : NextResponse.json({ error: result.error }, { status: result.status });
  }

  const checked = validateShare(body);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const result = await shareIssuedCode(userId, body.orderId, checked.input);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ url: result.url, emailed: result.emailed }, { headers: noStore });
}
