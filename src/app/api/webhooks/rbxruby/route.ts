import { NextRequest, NextResponse } from "next/server";
import { verifyRbxrubySign, type RbxrubyOrder } from "@/lib/rbxruby";
import { applyRbxrubyState, orderIdByRbxrubyId } from "@/lib/rbxruby-buyout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Вебхук RBXRUBY: приходит на Completed / Error / Cancelled (+ решение по жалобе).
 * Подпись `sign` = md5(base64(JSON без sign) + apiKey). Без подписи — 401.
 * Тик бота доводит то же самое опросом, так что потеря вебхука не страшна.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!verifyRbxrubySign(body)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Решение по жалобе — не новая доставка.
  if (body.event === "report") {
    console.log("[rbxruby] report decision", body.orderId, JSON.stringify(body.report));
    return NextResponse.json({ ok: true });
  }
  const info = body as unknown as RbxrubyOrder;
  const orderId = typeof info.orderId === "string" ? await orderIdByRbxrubyId(info.orderId) : null;
  if (!orderId) return NextResponse.json({ ok: true, unknown: true });
  const result = await applyRbxrubyState(orderId, info);
  return NextResponse.json({ ok: true, result });
}
