import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { accountMePayload } from "@/lib/account-session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PRIVATE = { "cache-control": "private, no-store" } as const;

/** Returns only the signed-in customer's own checkout defaults. */
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json(accountMePayload(null), { headers: PRIVATE });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { robloxUsername: true },
  });

  return NextResponse.json(accountMePayload(user), { headers: PRIVATE });
}
