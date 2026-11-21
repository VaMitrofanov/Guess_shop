/**
 * 🧩 Раздел «Склейка» (Э7, 18.11.2026): очередь «похоже, один человек» и
 * склейка одной кнопкой. Гейт — `requireAdmin`, как у «Рисков». Обработчики в
 * lib, а не в `src/app/api/admin/…`: сборка Guide вырезает `api/admin`.
 */
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { prisma } from "@/lib/prisma";
import { linkOrMergeVerifiedIdentity } from "../../bots/shared/account-merge";
import { buildMergePairs, mergeable, pairKey, type CandidateUser, type ContactLink } from "../../bots/shared/merge-candidates";
import { notifyPersonText } from "@/lib/twa-notify";

const DISMISSED = "DISMISSED";

async function loadPairs() {
  const [users, wbCounts, codeCounts, wbContacts, codeContacts, dismissedRows] = await Promise.all([
    prisma.user.findMany({
      where: { OR: [{ tgId: { not: null } }, { vkId: { not: null } }] },
      select: { id: true, name: true, username: true, tgId: true, vkId: true, email: true, role: true, createdAt: true },
    }),
    prisma.wbOrder.groupBy({ by: ["userId"], where: { isTest: false }, _count: { _all: true } }),
    prisma.codeOrder.groupBy({ by: ["creatorUserId"], where: { status: { in: ["PAID", "ISSUED"] } }, _count: { _all: true } }),
    prisma.orderContact.findMany({ where: { removedAt: null }, select: { userId: true, via: true, order: { select: { userId: true, amount: true } } } }),
    prisma.codeOrderContact.findMany({ where: { removedAt: null }, select: { userId: true, via: true, codeOrder: { select: { creatorUserId: true, denomination: true } } } }),
    prisma.accountMergeAudit.findMany({ where: { status: DISMISSED }, select: { sourceUserId: true, targetUserId: true } }),
  ]);
  const orders = new Map<string, number>();
  for (const r of wbCounts) orders.set(r.userId, (orders.get(r.userId) ?? 0) + r._count._all);
  for (const r of codeCounts) if (r.creatorUserId) orders.set(r.creatorUserId, (orders.get(r.creatorUserId) ?? 0) + r._count._all);
  const candidates: CandidateUser[] = users.map((u) => ({ ...u, role: String(u.role), orders: orders.get(u.id) ?? 0 }));
  const contacts: ContactLink[] = [
    ...wbContacts.map((c) => ({ contactUserId: c.userId, ownerUserId: c.order.userId, via: c.via, amount: c.order.amount, kind: "wb" as const })),
    ...codeContacts.filter((c) => c.codeOrder.creatorUserId).map((c) => ({ contactUserId: c.userId, ownerUserId: c.codeOrder.creatorUserId as string, via: c.via, amount: c.codeOrder.denomination, kind: "code" as const })),
  ];
  const dismissed = new Set(dismissedRows.map((r) => pairKey(r.sourceUserId, r.targetUserId)));
  return buildMergePairs({ users: candidates, contacts, dismissed });
}

const view = (u: CandidateUser) => ({
  id: u.id, name: u.name, username: u.username, orders: u.orders, createdAt: u.createdAt.toISOString(),
  channels: [u.tgId ? "Telegram" : null, u.vkId ? "ВКонтакте" : null, u.email ? "почта" : null].filter(Boolean),
});

export async function GET(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const pairs = await loadPairs();
  if (req.nextUrl.searchParams.get("count") === "1") return NextResponse.json({ open: pairs.filter((p) => p.strong).length, total: pairs.length });
  return NextResponse.json({
    pairs: pairs.slice(0, 100).map((p) => ({ key: p.key, strong: p.strong, evidence: p.evidence, target: view(p.target), source: view(p.source) })),
    total: pairs.length,
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const targetId = typeof body?.targetId === "string" ? body.targetId : "";
  const sourceId = typeof body?.sourceId === "string" ? body.sourceId : "";
  if (!targetId || !sourceId || targetId === sourceId) return NextResponse.json({ error: "Не указаны профили" }, { status: 400 });
  const who = admin.displayName ?? "админ";

  if (body?.action === "dismiss") {
    await prisma.accountMergeAudit.create({
      data: { sourceUserId: sourceId, targetUserId: targetId, status: DISMISSED, evidence: { method: "admin-dismissed", by: who } },
    });
    return NextResponse.json({ ok: true });
  }

  const select = { id: true, name: true, username: true, tgId: true, vkId: true, email: true, role: true, createdAt: true } as const;
  const [target, source] = await Promise.all([
    prisma.user.findUnique({ where: { id: targetId }, select }),
    prisma.user.findUnique({ where: { id: sourceId }, select }),
  ]);
  if (!target || !source) return NextResponse.json({ error: "Профиль не найден" }, { status: 404 });
  const asCand = (u: typeof target) => ({ ...u!, role: String(u!.role), orders: 0 });
  if (!mergeable(asCand(target), asCand(source))) return NextResponse.json({ error: "Эти профили склеить нельзя: площадки пересекаются" }, { status: 409 });
  // Источник приносит одну площадку: её и «предъявляем» целевому профилю.
  const provider = source.tgId ? "TG" as const : "VK" as const;
  const subject = (source.tgId ?? source.vkId) as string;
  try {
    const res = await linkOrMergeVerifiedIdentity(prisma, target.id, { provider, subject, name: null }, "admin-confirmed");
    if (res.auditId) {
      // Кто склеил — дописываем к доказательствам, не затирая их.
      const audit = await prisma.accountMergeAudit.findUnique({ where: { id: res.auditId }, select: { evidence: true } }).catch(() => null);
      const prev = (audit?.evidence ?? {}) as Record<string, unknown>;
      await prisma.accountMergeAudit.update({ where: { id: res.auditId }, data: { evidence: { ...prev, by: who } } }).catch(() => undefined);
    }
    const merged = await prisma.user.findUnique({ where: { id: res.userId }, select: { id: true, tgId: true, vkId: true } });
    if (merged) {
      await notifyPersonText(merged, "🔗 Объединили ваши профили Telegram и ВКонтакте — все заказы теперь в одном месте, а статус будет приходить в Telegram.").catch(() => null);
    }
    console.log(`[merge] ${who}: ${source.id} → ${target.id} (${provider})`);
    return NextResponse.json({ ok: true, userId: res.userId, merged: res.merged });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось склеить";
    console.warn(`[merge] отказ ${source.id} → ${target.id}: ${message}`);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
