import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isMailerConfigured } from "@/lib/mailer";
import { sendVerificationEmail } from "@/lib/email-account-lifecycle";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = rateLimit(`email-resend:${clientIp(req)}`, 3, 1 / 300);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Повторить отправку можно позже." },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerifiedAt: true },
  });
  if (!user?.email || user.emailVerifiedAt) return NextResponse.json({ success: true });
  if (!isMailerConfigured()) {
    return NextResponse.json({ error: "Отправка писем ещё настраивается." }, { status: 503 });
  }

  const sent = await sendVerificationEmail(userId, user.email);
  if (!sent.ok) return NextResponse.json({ error: "Письмо временно не отправилось." }, { status: 503 });
  return NextResponse.json({ success: true });
}
