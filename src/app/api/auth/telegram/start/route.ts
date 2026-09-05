import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  issueTelegramWebLoginChallenge,
  telegramWebLoginStartPayload,
  type TelegramWebLoginMode,
} from "@/lib/telegram-web-login";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = rateLimit(`telegram-web-login:${clientIp(req)}`, 8, 1 / 30);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Слишком много попыток. Попробуйте позже." },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const mode: TelegramWebLoginMode = req.nextUrl.searchParams.get("mode") === "link" ? "link" : "login";
  let targetUserId: string | null = null;

  if (mode === "link") {
    const session = await auth();
    const user = session?.user as { id?: string; auth_time?: number } | undefined;
    if (!user?.id) return NextResponse.json({ error: "Сначала войдите в кабинет." }, { status: 401 });
    if (!user.auth_time || Date.now() / 1000 - user.auth_time > 10 * 60) {
      return NextResponse.json(
        { error: "Для привязки войдите заново и повторите действие." },
        { status: 403 },
      );
    }
    targetUserId = user.id;
  }

  const challenge = await issueTelegramWebLoginChallenge(mode, targetUserId);
  const username = (process.env.NEXT_PUBLIC_TG_BOT_USERNAME ?? "RobloxBankBot").replace(/^@/, "");
  const start = telegramWebLoginStartPayload(mode, challenge.state);

  return NextResponse.json({
    href: `https://t.me/${encodeURIComponent(username)}?start=${encodeURIComponent(start)}`,
    expiresAt: challenge.expiresAt.toISOString(),
  });
}
