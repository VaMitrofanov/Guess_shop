import { NextRequest, NextResponse } from "next/server";
import { verifyEmailActionToken } from "@/lib/email-account-lifecycle";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const result = await verifyEmailActionToken(token);
  const destination = new URL("/email/verified", req.nextUrl.origin);
  destination.searchParams.set("status", result);
  return NextResponse.redirect(destination, { status: 303 });
}
