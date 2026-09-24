import { NextRequest, NextResponse } from "next/server";
import { validateInitData, isAdmin, signTwaToken, verifyTwaLinkToken } from "@/lib/twa-auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Вход в TWA-админку.
 *
 * U1 (риск №1 в docs/security.md): раньше здесь был Path 2 — если в теле нет
 * `initData`, роут брал `userId` как есть и, если он числился в `ADMIN_IDS`,
 * подписывал полноценный admin-JWT. Telegram ID не секретен, поэтому за
 * возвраты денег, выкуп робуксов и слив баланса отвечал публичный
 * идентификатор. Path 2 удалён.
 *
 * Остались два пути, оба с проверяемой подписью:
 *   1. `initData` — HMAC Telegram над TG_TOKEN;
 *   2. `linkToken` — HMAC нашего сервера, выданный ботом в web_app-ссылке
 *      (нужен там, где iOS Telegram не отдаёт tgWebAppData).
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limited = rateLimit(`twa-auth:${ip}`, 5, 1 / 60);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Слишком много попыток входа" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = await req.json().catch(() => ({}));
  const { initData, linkToken } = body;

  // Path 1: full HMAC validation (most secure)
  if (initData) {
    const result = validateInitData(initData);
    if (!result.valid) return NextResponse.json({ error: "Invalid initData" }, { status: 401 });
    if (!isAdmin(result.userId)) return NextResponse.json({ error: "Not admin" }, { status: 403 });
    const token = await signTwaToken(result.userId!, result.firstName ?? "Admin");
    return NextResponse.json({ token, firstName: result.firstName });
  }

  // Path 2 (новый): подписанный сервером токен из web_app-ссылки бота.
  if (typeof linkToken === "string" && linkToken.length > 0) {
    const userId = verifyTwaLinkToken(linkToken);
    if (!userId) {
      console.warn(`[twa-auth] invalid link token from ip=${ip}`);
      return NextResponse.json({ error: "Invalid link token" }, { status: 401 });
    }
    const token = await signTwaToken(userId, "Admin");
    return NextResponse.json({ token, firstName: "Admin" });
  }

  console.warn(`[twa-auth] no signed credential ip=${ip} platform=${body.platform ?? "?"}`);
  return NextResponse.json({ error: "No initData" }, { status: 400 });
}
