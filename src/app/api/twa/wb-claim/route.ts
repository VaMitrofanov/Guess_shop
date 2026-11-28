import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { prisma } from "@/lib/prisma";
import { holdForProblem } from "@/lib/order-hold";
import { answerWbClaim, findWbClaimBySrid, type WbClaim } from "@/lib/wb-api";
import { pickClaimActions } from "@/lib/wb-claim-actions";
import { ackFlags } from "../../../../../bots/shared/order-flags";

/* ─────────────────────────────────────────────────────────────────────────────
   ↩ Ответ на заявку покупателя о возврате — прямо из карточки заказа
   (27.11.2026, мокап https://claude.ai/artifact/MUiwNghNKnnW6wCo6NE3zC).

   GET  ?code=XXXXXXX — заявка WB по заказу и что по ней можно сделать.
   POST { code, decision: "reject" | "refund" | "keep", comment? }.
   «keep» (владелец 27.11.2026): просто выкупить, в WB ничего не отправлять —
   пометка гасится, заявку админ решает сам, как считает лучше.

   Кнопки строятся из `actions`, которые WB отдаёт по ЭТОЙ заявке: сами мы
   действие не выдумываем. Отказ гасит пометку «Возврат открыт» — заказ
   остаётся в очереди выкупа. Возврат морозит заказ сразу (деньги уходят),
   не дожидаясь, пока WB проведёт отмену.
   ───────────────────────────────────────────────────────────────────────── */

const MIN_COMMENT = 10;

async function loadClaim(code: string): Promise<{ mp: { id: string; rid: string | null; wbOrderId: string }; order: { id: string } | null; claim: WbClaim | null } | null> {
  const mp = await prisma.wbMarketplaceOrder.findFirst({
    where: { wbCode: { code }, claimOpenedAt: { not: null } },
    orderBy: { claimOpenedAt: "desc" },
    select: { id: true, rid: true, wbOrderId: true },
  });
  if (!mp) return null;
  const order = await prisma.wbOrder.findUnique({ where: { wbCode: code }, select: { id: true } });
  const claim = mp.rid ? await findWbClaimBySrid(mp.rid) : null;
  return { mp, order, claim };
}

function view(claim: WbClaim | null) {
  if (!claim) return null;
  const a = pickClaimActions(claim.actions ?? []);
  return {
    id: claim.id,
    openedAt: claim.dt ?? null,
    reason: claim.user_comment ?? null,
    decided: claim.status === 2,
    refunded: claim.status === 2 && claim.status_ex === 5,
    canReject: Boolean(a.reject),
    canRefund: Boolean(a.refund),
    rejectNeedsComment: a.rejectNeedsComment,
  };
}

export async function GET(req: NextRequest) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const code = (req.nextUrl.searchParams.get("code") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{5,12}$/.test(code)) return NextResponse.json({ error: "code required" }, { status: 400 });
  const found = await loadClaim(code);
  return NextResponse.json({ claim: found ? view(found.claim) : null });
}

export async function POST(req: NextRequest) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { code?: string; decision?: string; comment?: string } | null;
  const code = String(body?.code ?? "").trim().toUpperCase();
  const decision = body?.decision;
  const comment = String(body?.comment ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!/^[A-Z0-9]{5,12}$/.test(code) || (decision !== "reject" && decision !== "refund" && decision !== "keep")) {
    return NextResponse.json({ error: "code и decision обязательны" }, { status: 400 });
  }
  if (decision === "keep") {
    const order = await prisma.wbOrder.findUnique({ where: { wbCode: code }, select: { id: true } });
    if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    await ackFlags(prisma, { orderId: order.id, actor: actor.displayName, kind: "CLAIM" });
    const mp = await prisma.wbMarketplaceOrder.findFirst({ where: { wbCode: { code } }, orderBy: { claimOpenedAt: "desc" }, select: { id: true } });
    if (mp) {
      await prisma.wbMarketplaceEvent.create({
        data: { marketplaceOrderId: mp.id, type: "CLAIM_KEPT_BY_ADMIN", idempotencyKey: `claim-keep:${mp.id}:${Date.now()}`, actor: actor.displayName, payload: {} },
      }).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, decision });
  }
  const found = await loadClaim(code);
  if (!found?.claim) return NextResponse.json({ error: "Заявка на WB не найдена — решите её в кабинете" }, { status: 404 });
  const a = pickClaimActions(found.claim.actions ?? []);
  const action = decision === "reject" ? a.reject : a.refund;
  if (!action) {
    return NextResponse.json({ error: decision === "reject" ? "WB не даёт отклонить эту заявку — только кабинет" : "WB не даёт вернуть по этой заявке — только кабинет" }, { status: 409 });
  }
  if (decision === "reject" && a.rejectNeedsComment && comment.length < MIN_COMMENT) {
    return NextResponse.json({ error: `Комментарий для WB — не короче ${MIN_COMMENT} символов` }, { status: 400 });
  }
  const res = await answerWbClaim(found.claim.id, action, decision === "reject" ? comment || undefined : undefined);
  if (!res.ok) return NextResponse.json({ error: `WB не принял: ${res.error}` }, { status: 502 });

  const who = actor.displayName;
  await prisma.wbMarketplaceEvent.create({
    data: {
      marketplaceOrderId: found.mp.id,
      type: decision === "reject" ? "CLAIM_REJECTED_BY_ADMIN" : "CLAIM_APPROVED_BY_ADMIN",
      idempotencyKey: `claim-answer:${found.claim.id}:${decision}`,
      actor: who,
      payload: { action, comment: comment || null },
    },
  }).catch(() => undefined);
  if (found.order) await ackFlags(prisma, { orderId: found.order.id, actor: who, kind: "CLAIM" }).catch(() => undefined);
  if (decision === "refund") {
    await holdForProblem(prisma, { wbCode: code, kind: "WB_CLAIM_REFUNDED", detail: `вернули по заявке (${who})`, actor: who }).catch(() => undefined);
  }
  return NextResponse.json({ ok: true, decision });
}
