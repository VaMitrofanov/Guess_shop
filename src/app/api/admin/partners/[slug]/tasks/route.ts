import type { NextRequest } from "next/server";

import { GET as getPartnerTasks, POST as postPartnerTaskAction } from "@/app/api/twa/partners/[slug]/tasks/route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

/** Desktop facade over the canonical controller; no second accounting logic. */
export async function GET(request: NextRequest, context: RouteContext) {
  return getPartnerTasks(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return postPartnerTaskAction(request, context);
}
