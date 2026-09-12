import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resetPasswordWithActionToken } from "@/lib/email-account-lifecycle";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

const ResetSchema = z.object({
  token: z.string().min(1).max(256),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

export async function POST(req: NextRequest) {
  const limited = rateLimit(`password-reset:${clientIp(req)}`, 5, 1 / 60);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Слишком много попыток. Запросите новую ссылку позже." },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const parsed = ResetSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ссылка или новый пароль некорректны." }, { status: 400 });

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const result = await resetPasswordWithActionToken(parsed.data.token, passwordHash);
  if (result !== "success") {
    return NextResponse.json({ error: result === "expired" ? "Срок ссылки истёк." : "Ссылка недействительна или уже использована." }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
