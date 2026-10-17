import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { normalizeLoginEmail } from "@/lib/auth-navigation";
import { isMailerConfigured } from "@/lib/mailer";
import { sendPasswordResetEmail } from "@/lib/email-account-lifecycle";

const RequestSchema = z.object({ email: z.email().max(254) });
const GENERIC_MESSAGE = "Если такой подтверждённый email есть, ссылка придёт в течение нескольких минут.";

export async function POST(req: NextRequest) {
  const limited = rateLimit(`password-reset-request:${clientIp(req)}`, 4, 1 / 300);
  if (!limited.ok) {
    return NextResponse.json(
      { success: true, message: GENERIC_MESSAGE },
      { headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: true, message: GENERIC_MESSAGE });

  const deliveryAvailable = isMailerConfigured();
  const email = normalizeLoginEmail(parsed.data.email);
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, emailVerifiedAt: true },
  });
  if (deliveryAvailable && user?.email && user.emailVerifiedAt) {
    await sendPasswordResetEmail(user.id, user.email);
  }

  return NextResponse.json({ success: true, message: GENERIC_MESSAGE, deliveryAvailable });
}
