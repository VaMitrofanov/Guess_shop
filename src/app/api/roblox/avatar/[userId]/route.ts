import { getRobloxAvatar } from "@/lib/roblox";

const USER_ID_RE = /^[1-9]\d{0,19}$/;
const CACHE_CONTROL = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";

/**
 * Streams a public Roblox headshot from a fixed, verified CDN host. This
 * avoids the production Next image optimizer, which can return 500 before it
 * serves a valid Roblox image. No visitor cookie or profile-private data is
 * requested or exposed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  if (!USER_ID_RE.test(userId)) return new Response(null, { status: 404 });

  try {
    const avatarUrl = await getRobloxAvatar(userId);
    if (!avatarUrl) return new Response(null, { status: 404 });

    const url = new URL(avatarUrl);
    if (url.protocol !== "https:" || url.hostname !== "tr.rbxcdn.com") {
      return new Response(null, { status: 502 });
    }

    const upstream = await fetch(url, {
      cache: "force-cache",
      next: { revalidate: 60 * 60 * 24 },
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(8_000),
    });
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !upstream.body || !contentType.toLowerCase().startsWith("image/")) {
      return new Response(null, { status: 502 });
    }

    return new Response(upstream.body, {
      headers: {
        "Cache-Control": CACHE_CONTROL,
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[Roblox avatar proxy]", error);
    return new Response(null, { status: 502 });
  }
}
