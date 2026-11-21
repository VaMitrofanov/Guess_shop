import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { issueBindToken } from "../../../../../bots/shared/bot-bind";

export const dynamic = "force-dynamic";

/**
 * 🔗 Ссылка «Получать статус в Telegram» (Э1, 18.11.2026): одноразовый токен
 * на 7 дней для профиля ТЕКУЩЕЙ сессии. Бот по `/start ln_…` склеивает
 * Telegram с этим профилем (`bots/shared/bot-bind.ts`).
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(`bot-bind:${clientIp(req)}`, 10, 1 / 60);
  if (!limited.ok) return NextResponse.json({ error: "Слишком много попыток" }, { status: 429 });
  const session = await auth().catch(() => null);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Войдите в кабинет" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tgId: true, role: true } });
  if (!user) return NextResponse.json({ error: "Профиль не найден" }, { status: 404 });
  if (user.role === "ADMIN") return NextResponse.json({ error: "Для админов привязка через кабинет недоступна" }, { status: 403 });
  if (user.tgId) return NextResponse.json({ linked: true, url: "https://t.me/RobloxBankBot?start=order" });
  const { url, expiresAt } = await issueBindToken(prisma, userId);
  return NextResponse.json({ linked: false, url, expiresAt: expiresAt.toISOString() });
}
