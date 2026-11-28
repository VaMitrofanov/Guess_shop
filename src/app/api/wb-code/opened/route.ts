import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { GUIDE_OPENED_EVENT } from "@/lib/buyer-journey";

/**
 * Покупатель открыл свою личную ссылку на инструкцию (28.10.2026).
 *
 * Сигнал для «Пути покупателя» в карточке заказа: дошла ли инструкция, которую
 * мы ему отправили. Пишется событие `GUIDE_OPENED` в последний заказ по коду —
 * не чаще раза в час на заказ и раздел (`stage`). Публичный роут: рейт-лимит,
 * код только по формату, ответ одинаковый при любом исходе (не оракул кодов).
 */
const STAGES = new Set(["key", "passid", "place", "sale"]);

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (!rateLimit(`wb-opened:${ip}`, 6, 1 / 60).ok) return NextResponse.json({ ok: true });

  const body = await request.json().catch(() => null);
  const code = String(body?.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{7}$/.test(code)) return NextResponse.json({ ok: true });
  const rawStage = String(body?.stage ?? "");
  const stage = STAGES.has(rawStage) ? rawStage : "guide";
  const ua = request.headers.get("user-agent") ?? "";
  const device = /iphone|ipad|android|mobile/i.test(ua) ? "mobile" : "pc";

  try {
    const order = await prisma.wbOrder.findFirst({
      where: { wbCode: { equals: code, mode: "insensitive" }, status: { notIn: ["COMPLETED", "REJECTED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (order) {
      const bucket = Math.floor(Date.now() / 3_600_000);
      await prisma.orderEvent.create({
        data: {
          orderId: order.id,
          type: GUIDE_OPENED_EVENT,
          idempotencyKey: `guide-open:${order.id}:${stage}:${bucket}`,
          payload: { stage, device, at: new Date().toISOString() },
        },
      });
    }
  } catch (err: unknown) {
    // P2002 — уже отмечено в этот час. Остальное не должно мешать странице.
    if ((err as { code?: string } | null)?.code !== "P2002") {
      console.warn("[wb-code/opened] не записано:", err instanceof Error ? err.message : err);
    }
  }
  return NextResponse.json({ ok: true });
}
