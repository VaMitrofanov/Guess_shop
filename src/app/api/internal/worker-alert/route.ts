import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";

export const runtime = "nodejs";

const bodySchema = z.object({
  kind: z.enum(["worker_stale", "worker_recovered", "backlog_stale", "backlog_recovered"]),
  text: z.string().min(1).max(2_000),
});

function authorized(request: NextRequest) {
  const expected = process.env.VALIDATOR_KEY?.trim();
  const received = request.headers.get("x-worker-alert-key")?.trim();
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

function subject(kind: z.infer<typeof bodySchema>["kind"]) {
  switch (kind) {
    case "worker_stale": return "🚨 RobloxBank: payment worker остановлен";
    case "worker_recovered": return "✅ RobloxBank: payment worker восстановлен";
    case "backlog_stale": return "🚨 RobloxBank: payment outbox застрял";
    case "backlog_recovered": return "✅ RobloxBank: payment outbox разобран";
  }
}

function plainText(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const adminSubjects = [...new Set((process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
    .split(",").map((id) => id.trim()).filter(Boolean))];
  if (adminSubjects.length === 0) return NextResponse.json({ delivered: false }, { status: 503 });

  const owners = await prisma.user.findMany({
    where: {
      email: { not: null },
      emailVerifiedAt: { not: null },
      identities: { some: { provider: "TG", subject: { in: adminSubjects } } },
    },
    select: { email: true },
  });
  const recipients = [...new Set(owners.map((owner) => owner.email).filter((email): email is string => Boolean(email)))];
  if (recipients.length === 0) return NextResponse.json({ delivered: false }, { status: 503 });

  const results = await Promise.all(recipients.map((to) => sendMail({
    to,
    subject: subject(parsed.data.kind),
    text: `${plainText(parsed.data.text)}\n\nАвтоматический независимый алерт RobloxBank.`,
  })));
  const delivered = results.some((result) => result.ok);
  return NextResponse.json({ delivered }, { status: delivered ? 202 : 503 });
}
