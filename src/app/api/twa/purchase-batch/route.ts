import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { prisma } from "@/lib/prisma";

/**
 * Durable record + optional Telegram report for a "Выкупить всё" batch.
 * The actual buyout is orchestrated client-side (looping the existing
 * `purchase` action with random pauses); this endpoint only persists the
 * outcome and, on request, DMs the report to the admin who ran it.
 */

interface BatchItem {
  orderId: string;
  nick: string;
  wbCode: string;
  gross: number;
  ok: boolean;
  reason?: string;
}

async function tgPost(chatId: string, text: string) {
  const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
  const payload = { token: process.env.TG_TOKEN, chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (bridgeUrl) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.VALIDATOR_KEY) headers["x-validator-key"] = process.env.VALIDATOR_KEY;
    await fetch(`${bridgeUrl}/tg-proxy`, { method: "POST", headers, body: JSON.stringify(payload) })
      .catch(e => console.warn("[purchase-batch] bridge error:", e?.message));
    return;
  }
  await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(e => console.warn("[purchase-batch] tg direct error:", e?.message));
}

function buildReport(accountName: string | null, items: BatchItem[], totalGross: number, okCount: number, failCount: number): string {
  const lines = items.slice(0, 40).map(it => {
    const mark = it.ok ? "✅" : "❌";
    const tail = it.ok ? `− ${it.gross.toLocaleString("ru-RU")} R$` : (it.reason ?? "ошибка");
    return `${mark} ${it.nick} · ${it.wbCode} · ${tail}`;
  });
  const more = items.length > 40 ? `\n…и ещё ${items.length - 40}` : "";
  return (
    `🧾 <b>Выкуп пачки завершён</b>\n` +
    `Аккаунт: <b>${accountName ?? "—"}</b>\n` +
    `Успешно: <b>${okCount}</b> · Ошибок: <b>${failCount}</b>\n` +
    `Списано: <b>${totalGross.toLocaleString("ru-RU")} R$</b> (грязных)\n\n` +
    lines.join("\n") + more
  );
}

export async function GET(req: NextRequest) {
  if (!await requireAdmin(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const batches = await (prisma as any).purchaseBatch.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ batches });
}

export async function POST(req: NextRequest) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.action)
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  // ── Прогрессивная запись пачки (2026-07-05) ────────────────────────────────
  // Раньше батч создавался одним fire-and-forget fetch'ем в КОНЦЕ клиентского
  // цикла — закрытие TWA сразу после пачки (типично при смене cookie-аккаунта)
  // убивало запрос, и отчёт терялся («пришёл 1 раз, а акков было 3»).
  // Теперь: start (батч с finishedAt=null) → item после каждой покупки →
  // finish (финализация + отчёт). Свипер в TG-crons дошлёт отчёт по батчам,
  // у которых finish так и не случился.

  if (body.action === "start") {
    const batch = await (prisma as any).purchaseBatch.create({
      data: {
        accountName: body.accountName ? String(body.accountName) : null,
        startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
        finishedAt: null,
        items: [],
      },
    });
    return NextResponse.json({ ok: true, batchId: batch.id });
  }

  if (body.action === "item") {
    const batchId = String(body.batchId ?? "");
    const item = body.item as BatchItem | undefined;
    if (!batchId || !item?.orderId)
      return NextResponse.json({ error: "batchId и item обязательны" }, { status: 400 });
    const batch = await (prisma as any).purchaseBatch.findUnique({ where: { id: batchId } });
    if (!batch) return NextResponse.json({ error: "Батч не найден" }, { status: 404 });
    // Клиент шлёт item'ы последовательно (await) — read-modify-write безопасен.
    const items: BatchItem[] = Array.isArray(batch.items) ? batch.items : [];
    items.push(item);
    await (prisma as any).purchaseBatch.update({ where: { id: batchId }, data: { items } });
    return NextResponse.json({ ok: true, count: items.length });
  }

  if (body.action === "finish") {
    const batchId = String(body.batchId ?? "");
    if (!batchId) return NextResponse.json({ error: "batchId обязателен" }, { status: 400 });
    const batch = await (prisma as any).purchaseBatch.findUnique({ where: { id: batchId } });
    if (!batch) return NextResponse.json({ error: "Батч не найден" }, { status: 404 });
    // Клиентский список item'ов авторитетен (мог не долететь какой-то item-POST).
    const items: BatchItem[] = Array.isArray(body.items) && body.items.length > 0
      ? body.items
      : (Array.isArray(batch.items) ? batch.items : []);
    const okCount = items.filter(i => i.ok).length;
    const failCount = items.length - okCount;
    const totalGross = items.filter(i => i.ok).reduce((s, i) => s + (Number(i.gross) || 0), 0);
    await (prisma as any).purchaseBatch.update({
      where: { id: batchId },
      data: { finishedAt: new Date(), items, okCount, failCount, totalGross },
    });
    // Отчёт уходит в Telegram тому, кто запустил пачку. Это TG ID из
    // `ADMIN_IDS` (`actor.telegramId`), а НЕ внутренний `User.id`: у запасного
    // входа Telegram может отсутствовать — тогда отчёт просто не шлём.
    if (body.notify && actor.via === "telegram") {
      await tgPost(actor.telegramId, buildReport(batch.accountName, items, totalGross, okCount, failCount));
    }
    return NextResponse.json({ ok: true, batchId, okCount, failCount, totalGross });
  }

  // Легаси-путь: батч одним запросом (фолбэк клиента, если start не долетел).
  if (body.action !== "save")
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const items: BatchItem[] = Array.isArray(body.items) ? body.items : [];
  const okCount = items.filter(i => i.ok).length;
  const failCount = items.length - okCount;
  const totalGross = items.filter(i => i.ok).reduce((s, i) => s + (Number(i.gross) || 0), 0);
  const accountName = body.accountName ? String(body.accountName) : null;

  const batch = await (prisma as any).purchaseBatch.create({
    data: {
      accountName,
      startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
      finishedAt: new Date(),
      totalGross,
      okCount,
      failCount,
      items,
    },
  });

  if (body.notify && actor.via === "telegram") {
    await tgPost(actor.telegramId, buildReport(accountName, items, totalGross, okCount, failCount));
  }

  return NextResponse.json({ ok: true, batchId: batch.id, okCount, failCount, totalGross });
}
