import { NextRequest, NextResponse } from "next/server";
import { searchGamepassesByNick } from "@/lib/roblox";
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
    // Один поход наружу отдаёт и аккаунт, и пассы. `userExists` отделяет
    // опечатку в нике от «аккаунт есть, но пассов не видно» — вторую страница
    // лечит ручным вводом ссылки, первую нет.
    const { userExists, account, gamepasses } = await searchGamepassesByNick(q);
    if (!userExists) {
      return NextResponse.json({
        success: true,
        gamepasses: [],
        isDirect: false,
        detectedUsername: null,
        userExists: false,
        account: null,
      });
    }
    if (wbCode) await noteProbableNickByCode(wbCode, q, "site-search");
    // Аккаунт может не приехать (мост без `/roblox-user`), а пассы — приехать.
    // Ветка «пользователя нет» тут была бы ложью: страница просто рисуется без
    // карточки аккаунта, а имя берётся из того, что нашлось.
    return NextResponse.json({
      success: true,
      gamepasses,
      isDirect: false,
      detectedUsername: account?.username ?? q,
      userExists: true,
      account: account ?? null,
    });
  } catch (error) {
    console.error("[Gamepasses API] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
