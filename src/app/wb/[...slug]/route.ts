import { NextResponse, type NextRequest } from "next/server";
import { publicAppOrigin } from "@/lib/email-account-lifecycle";

/**
 * Короткая ссылка гейта для чата Wildberries: `/wb/<код>[/key][?u=<ник>]`.
 *
 * С 16.09.2026 WB экранирует текст чата, и `&` доходит до покупателя как
 * `&amp;`. Полная ссылка `/guide?source=wb&skip=1&code=…` открывалась с
 * параметрами `amp;skip`/`amp;code`, и код в гайд не подставлялся. Здесь нет ни
 * одного `&`: код — сегмент пути, ветка ключа — сегмент `key`, ник — один
 * параметр `u`. Маршрут только разворачивает её в полный адрес гайда.
 *
 * Адрес строится от ПУБЛИЧНОГО origin: внутри контейнера `request.url` —
 * `http://0.0.0.0:3001/…` (см. `src/app/api/wb-link/route.ts`).
 */

export const dynamic = "force-dynamic";

const CODE_RE = /^[A-Z0-9]{7}$/;
const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;

export async function GET(request: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  const code = decodeURIComponent(slug?.[0] ?? "").trim().toUpperCase();
  const origin = publicAppOrigin();

  // Не код — всё равно ведём в гайд: там человек введёт код руками.
  if (!CODE_RE.test(code)) {
    return NextResponse.redirect(new URL("/guide?source=wb", origin), 307);
  }

  const query = new URLSearchParams({ source: "wb", skip: "1", code });
  const nick = request.nextUrl.searchParams.get("u")?.trim().replace(/^@/, "") ?? "";
  if (NICK_RE.test(nick)) query.set("username", nick);
  if (slug?.[1] === "key") query.set("stage", "key");

  return NextResponse.redirect(new URL(`/guide?${query.toString()}`, origin), 307);
}
