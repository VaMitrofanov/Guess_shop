import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import {
  cancelAtRbxruby,
  rbxrubyOverview,
  rbxrubyStates,
  rbxrubyTimeline,
  sendToRbxrubyNow,
  setRbxrubyExcluded,
  setRbxrubyMode,
} from "@/lib/rbxruby-buyout";

/**
 * RBXRUBY в админке — один обработчик на сайт (`/api/admin/rbxruby`) и TWA
 * (`/api/twa/rbxruby`).
 *   GET               — плашка: режим, баланс, сток, сутки/неделя, следующие;
 *   GET ?orderId=…    — карточка заказа: состояние + хроника;
 *   POST {action}     — mode (on/dry/off) | send | cancel | exclude | include.
 */
const noStore = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orderId = req.nextUrl.searchParams.get("orderId");
  if (orderId) {
    const [states, timeline] = await Promise.all([rbxrubyStates([orderId]), rbxrubyTimeline(orderId)]);
    return NextResponse.json({ state: states[orderId] ?? null, timeline }, { headers: noStore });
  }
  return NextResponse.json(await rbxrubyOverview(), { headers: noStore });
}

export async function POST(req: NextRequest) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; orderId?: string; mode?: string };
  const by = actor.displayName || "админ";
  switch (body.action) {
    case "mode": {
      if (body.mode !== "on" && body.mode !== "dry" && body.mode !== "off") return NextResponse.json({ error: "bad mode" }, { status: 400 });
      await setRbxrubyMode(body.mode, by);
      return NextResponse.json({ ok: true, overview: await rbxrubyOverview() });
    }
    case "send":
    case "cancel":
    case "exclude":
    case "include": {
      if (!body.orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });
      const r = body.action === "send" ? await sendToRbxrubyNow(body.orderId, by)
        : body.action === "cancel" ? await cancelAtRbxruby(body.orderId, by)
        : (await setRbxrubyExcluded(body.orderId, body.action === "exclude", by), { ok: true, message: body.action === "exclude" ? "не отдаём в RBXRUBY" : "снова можно в RBXRUBY" });
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
