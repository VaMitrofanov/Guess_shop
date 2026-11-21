import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { webLoginStatus } from "@/lib/telegram-web-login";

export const dynamic = "force-dynamic";

/**
 * Вкладка ждёт «✅ Да, войти» в боте (18.11.2026). Отвечает только статусом:
 * waiting / approved / gone. Кто одобрил — не раскрывает (вход — `telegram-handoff`).
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(`telegram-web-poll:${clientIp(req)}`, 120, 1);
  if (!limited.ok) return NextResponse.json({ status: "waiting" }, { status: 429 });
  const state = req.nextUrl.searchParams.get("state") ?? "";
  return NextResponse.json({ status: await webLoginStatus(state) }, { headers: { "cache-control": "no-store" } });
}
