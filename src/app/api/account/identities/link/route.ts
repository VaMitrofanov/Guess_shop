import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { verifyTelegramLogin } from "@/lib/telegram-login";
import { linkOrMergeVerifiedIdentity } from "@/lib/user-identity";

export const dynamic = "force-dynamic";

const TelegramLinkSchema = z.object({
  provider: z.literal("TG"),
  payload: z.object({
    id: z.union([z.string(), z.number()]), first_name: z.string().min(1),
    last_name: z.string().optional(), username: z.string().optional(), photo_url: z.string().optional(),
    auth_date: z.union([z.string(), z.number()]), hash: z.string().min(1),
  }),
});

export async function POST(req: NextRequest) {
  const limited = rateLimit(`identity-link:${clientIp(req)}`, 5, 1 / 60);
  if (!limited.ok) return NextResponse.json({ error: "Слишком много попыток" }, { status: 429, headers: { "retry-after": String(limited.retryAfter) } });
  const session = await auth();
  const sessionUser = session?.user as { id?: string; auth_time?: number } | undefined;
  if (!sessionUser?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sessionUser.auth_time || Date.now() / 1000 - sessionUser.auth_time > 10 * 60) {
    return NextResponse.json({ error: "Для объединения войдите заново и повторите действие", code: "FRESH_LOGIN_REQUIRED" }, { status: 403 });
  }
  const parsed = TelegramLinkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректные данные Telegram" }, { status: 400 });
  const verified = verifyTelegramLogin(parsed.data.payload, { maxAgeSeconds: 5 * 60 });
  if (!verified) return NextResponse.json({ error: "Подпись Telegram недействительна или устарела" }, { status: 401 });
  try {
    const result = await linkOrMergeVerifiedIdentity(sessionUser.id, {
      provider: "TG", subject: verified.subject, name: verified.name, image: verified.image,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[identity-link] merge rejected", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось объединить профили" }, { status: 409 });
  }
}
