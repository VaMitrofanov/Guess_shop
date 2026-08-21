import { NextRequest, NextResponse } from "next/server";
import { emailVerificationResultUrl, verifyEmailActionToken } from "@/lib/email-account-lifecycle";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const result = await verifyEmailActionToken(token);
  // Coolify terminates TLS before the standalone Next.js container. In this
  // setup req.nextUrl.origin is the internal https://0.0.0.0:3000 address,
  // which Safari refuses to open. Redirect only to the validated app origin;
  // never derive an absolute post-token URL from proxy/Host headers.
  return NextResponse.redirect(emailVerificationResultUrl(result), { status: 303 });
}
