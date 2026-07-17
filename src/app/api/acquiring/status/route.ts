import { NextResponse } from "next/server";
import { isSiteAcquiringEnabled } from "@/lib/site-acquiring";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { enabled: isSiteAcquiringEnabled() },
    { headers: { "cache-control": "no-store" } },
  );
}
