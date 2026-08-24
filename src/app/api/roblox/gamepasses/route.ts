import { NextRequest, NextResponse } from "next/server";
import { getRobloxAvatar, getUserGamepasses, getRobloxUser } from "@/lib/roblox";
import { noteProbableNickByCode } from "@/lib/capture-nick";
import { parseGamepassRef } from "@/lib/gamepass-id";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { ok, retryAfter } = rateLimit(`roblox-gamepasses:${clientIp(req)}`, 20, 0.5);
  if (!ok) {
    return NextResponse.json(
      { error: "Слишком много запросов. Попробуйте через минуту." },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    );
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("query")?.trim() ?? "";
  // Optional WB code — lets us stamp the searched nick on the order right away
  // (early nick capture), even if the user never completes the one-tap.
  const wbCode = searchParams.get("code")?.trim() ?? "";

  if (!q) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  try {
    const gamepassId = parseGamepassRef(q);

    // ── Direct ID or URL lookup ──────────────────────────────────────
    if (gamepassId) {
      const { getGamepassById } = await import("@/lib/roblox");
      const gp = await getGamepassById(gamepassId);
      // Ручной ввод ссылки — запасной вход, когда поиск по нику ничего не нашёл
      // (скрытый плейс, свежий пасс, лаг Roblox). Ник владельца берём у самого
      // геймпасса: он надёжнее того, что покупатель напечатал, и им же
      // помечаем заказ, чтобы менеджер видел вероятного получателя.
      if (gp && wbCode && gp.creatorName) {
        await noteProbableNickByCode(wbCode, gp.creatorName, "site-gp-link");
      }
      return NextResponse.json({
        success: true,
        gamepasses: gp ? [gp] : [],
        isDirect: true,
        detectedUsername: gp?.creatorName ?? null,
      });
    }

    // ── Username lookup ──────────────────────────────────────────────
    const user = await getRobloxUser(q);
    if (!user) {
      return NextResponse.json({
        success: true,
        gamepasses: [],
        isDirect: false,
        detectedUsername: null,
        userExists: false,
        account: null,
      });
    }
    const [gamepasses, avatarUrl] = await Promise.all([
      getUserGamepasses(user.name ?? q, user.id),
      getRobloxAvatar(user.id),
    ]);
    const account = {
      id: String(user.id),
      username: user.name ?? q,
      displayName: user.displayName ?? user.name ?? q,
      avatarUrl,
    };
    if (gamepasses.length > 0) {
      if (wbCode) await noteProbableNickByCode(wbCode, q, "site-search");
      return NextResponse.json({
        success: true,
        gamepasses,
        isDirect: false,
        detectedUsername: account.username,
        userExists: true,
        account,
      });
    }
    // Empty — distinguish "no such user on Roblox" (likely a typo) from
    // "user exists but has no public for-sale gamepasses" (place closed / not
    // created). Mirrors the bot's searchGamepassesByNick branching. We only pay
    // for this extra resolve when the fast path returned nothing.
    if (wbCode) await noteProbableNickByCode(wbCode, q, "site-search");
    return NextResponse.json({
      success: true,
      gamepasses: [],
      isDirect: false,
      detectedUsername: account.username,
      userExists: true,
      account,
    });
  } catch (error) {
    console.error("[Gamepasses API] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
