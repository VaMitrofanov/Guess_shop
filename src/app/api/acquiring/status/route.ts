import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { publicSiteAcquiringMode, siteAcquiringDecision } from "@/lib/site-acquiring";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const decision = siteAcquiringDecision({ userId });
  return NextResponse.json(
    {
      enabled: decision.eligible,
      available: decision.masterEnabled && decision.mode !== "off",
      authenticated: Boolean(userId),
      mode: publicSiteAcquiringMode(decision),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
