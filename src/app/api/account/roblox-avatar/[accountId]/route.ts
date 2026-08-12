import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/**
 * Streams the signed-in customer's saved public Roblox avatar. The URL comes
 * only from the customer's server-side account row, then is pinned to Roblox's
 * image CDN before fetch, so this cannot become an arbitrary URL proxy.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return new Response(null, { status: 401, headers: PRIVATE });

  const { accountId } = await params;
  if (!ACCOUNT_ID_RE.test(accountId)) return new Response(null, { status: 404, headers: PRIVATE });

  const account = await prisma.userRobloxAccount.findFirst({
    where: { id: accountId, userId, hiddenAt: null },
    select: { avatarUrl: true },
  });
  if (!account?.avatarUrl) return new Response(null, { status: 404, headers: PRIVATE });

  try {
    const url = new URL(account.avatarUrl);
    if (url.protocol !== "https:" || url.hostname !== "tr.rbxcdn.com") {
      return new Response(null, { status: 502, headers: PRIVATE });
    }
    const upstream = await fetch(url, {
      cache: "force-cache",
      next: { revalidate: 60 * 60 * 24 },
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(8_000),
    });
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !upstream.body || !contentType.toLowerCase().startsWith("image/")) {
      return new Response(null, { status: 502, headers: PRIVATE });
    }

    return new Response(upstream.body, {
      headers: { ...PRIVATE, "Content-Type": contentType, "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    console.error("[Roblox account avatar proxy]", error);
    return new Response(null, { status: 502, headers: PRIVATE });
  }
}
