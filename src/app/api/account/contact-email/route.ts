import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

/**
 * ✉️ Почта для чеков и копии кода (18.11.2026, владелец: «лучше просить»).
 * Не способ входа и без подтверждения: её вписывает сам владелец профиля.
 * Подставляется в чек следующей покупки (`defaultReceiptEmail`).
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(`contact-email:${clientIp(req)}`, 10, 1 / 60);
  if (!limited.ok) return NextResponse.json({ error: "Слишком много попыток" }, { status: 429 });
  const session = await auth().catch(() => null);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Войдите в кабинет" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Проверьте адрес почты" }, { status: 400 });
  await prisma.user.update({ where: { id: userId }, data: { contactEmail: email } });
  return NextResponse.json({ ok: true, email });
}
