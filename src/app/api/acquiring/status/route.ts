import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { publicSiteAcquiringMode, siteAcceptsPayments, siteAcquiringDecision } from "@/lib/site-acquiring";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const decision = siteAcquiringDecision({ userId });
  return NextResponse.json(
    {
      enabled: decision.eligible,
      available: siteAcceptsPayments(decision),
      // F3: витрине нужен ответ про сайт, а не про аккаунт. `enabled` остаётся
      // ответом про аккаунт (его читает кнопка оплаты), `accepting` — про сайт.
      accepting: siteAcceptsPayments(decision),
      authenticated: Boolean(userId),
      mode: publicSiteAcquiringMode(decision),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
