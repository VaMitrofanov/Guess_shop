import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { verifyTelegramLogin } from "@/lib/telegram-login";
import { linkOrMergeVerifiedIdentity } from "@/lib/user-identity";
import { consumeTelegramWebLoginChallenge } from "@/lib/telegram-web-login";

export const dynamic = "force-dynamic";

const TelegramLinkSchema = z.object({
  provider: z.literal("TG"),
  state: z.string().min(1),
  payload: z.object({
    id: z.union([z.string(), z.number()]), first_name: z.string().min(1),
    last_name: z.string().optional(), username: z.string().optional(), photo_url: z.string().optional(),
    auth_date: z.union([z.string(), z.number()]), hash: z.string().min(1),
  }),
});

export async function POST(req: NextRequest) {
  const limited = rateLimit(`identity-link:${clientIp(req)}`, 5, 1 / 60);
  if (!limited.ok) return NextResponse.json({ error: "Слишком много попыток" }, { status: 429, headers: { "retry-after": String(limited.retryAfter) } });
  const parsed = TelegramLinkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректные данные Telegram" }, { status: 400 });
  const verified = verifyTelegramLogin(parsed.data.payload, { maxAgeSeconds: 5 * 60 });
  if (!verified) return NextResponse.json({ error: "Подпись Telegram недействительна или устарела" }, { status: 401 });
  const challenge = await consumeTelegramWebLoginChallenge(parsed.data.state, "link");
  if (!challenge?.targetUserId) return NextResponse.json({ error: "Ссылка привязки недействительна или уже использована" }, { status: 401 });

  // If the callback opened in the original browser, also require the same
  // account. Telegram mobile may open it in its own webview without the web
  // session; in that case the short-lived one-time challenge is the step-up
  // proof and remains bound to the account that issued it.
  const session = await auth();
  const sessionUser = session?.user as { id?: string } | undefined;
  if (sessionUser?.id && sessionUser.id !== challenge.targetUserId) {
    return NextResponse.json({ error: "Ссылка была создана для другого аккаунта" }, { status: 403 });
  }
  try {
    const result = await linkOrMergeVerifiedIdentity(challenge.targetUserId, {
      provider: "TG", subject: verified.subject, name: verified.name, image: verified.image,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[identity-link] merge rejected", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось объединить профили" }, { status: 409 });
  }
}
