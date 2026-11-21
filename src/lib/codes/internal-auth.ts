import { NextRequest, NextResponse } from "next/server";
import {
  BOT_PAYMENT_SIGNATURE_HEADER,
  BOT_PAYMENT_TIMESTAMP_HEADER,
  verifyBotPaymentBody,
} from "@/lib/bot-payment-auth";

/**
 * Служебные маршруты контура кодов (`/api/internal/codes/*`, `/api/internal/bot-codes`).
 * Подпись — та же HMAC, что у оплаты из ботов (`BOT_PAYMENT_API_SECRET`, одинаков
 * на Web/TG/VK): тело + время, окно ±5 минут. Без подписи — 401 без деталей.
 */
export async function readSignedJson(req: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const raw = await req.text();
  let valid = false;
  try {
    valid = verifyBotPaymentBody({
      timestamp: req.headers.get(BOT_PAYMENT_TIMESTAMP_HEADER),
      signature: req.headers.get(BOT_PAYMENT_SIGNATURE_HEADER),
      body: raw,
    });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  try {
    return { ok: true, body: raw ? JSON.parse(raw) : {} };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "bad json" }, { status: 400 }) };
  }
}

export const internalNoStore = { "cache-control": "no-store" } as const;
