import { NextRequest, NextResponse } from "next/server";
import { getSbpQrBuffer, sbpQrToken } from "@/lib/twa-direct";

/**
 * СБП-QR картинкой — для Telegram sendPhoto по URL (мост шлёт Bot API JSON,
 * сырые байты через него не передать; Telegram скачивает фото сам).
 *
 * Не публичная ссылка: без валидного `t` (HMAC от серверного секрета) — 404.
 * Токен стабильный и нигде на сайте не светится — живёт только в исходящем
 * запросе Web → мост → Telegram.
 */
export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("t") ?? "";
  if (!t || t !== sbpQrToken()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const qr = await getSbpQrBuffer();
  if (!qr) return NextResponse.json({ error: "Not configured" }, { status: 404 });

  return new NextResponse(new Uint8Array(qr), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=300",
    },
  });
}
