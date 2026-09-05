import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { accountMePayload } from "@/lib/account-session";
import { prisma } from "@/lib/prisma";
import { loadCustomerRobloxProfile } from "@/lib/roblox-profile";

export const dynamic = "force-dynamic";

const PRIVATE = { "cache-control": "private, no-store" } as const;

/** Returns only the signed-in customer's own checkout defaults. */
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json(accountMePayload(null), { headers: PRIVATE });
  }

  const [user, roblox] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    }),
    loadCustomerRobloxProfile(userId),
  ]);

  return NextResponse.json(accountMePayload({
    robloxUsername: roblox.profile?.username ?? null,
    selectedRobloxAccountId: roblox.profile?.accountId ?? null,
    robloxAccounts: roblox.accounts.map((account) => ({
      accountId: account.accountId,
      username: account.username,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      source: account.source,
      orderCount: account.orderCount,
      selected: account.selected,
    })),
    email: user?.email ?? null,
    emailVerifiedAt: user?.emailVerifiedAt ?? null,
  }), { headers: PRIVATE });
}
