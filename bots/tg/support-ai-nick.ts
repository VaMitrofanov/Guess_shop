/* Смена ника по просьбе покупателя (28.11.2026): воркер готовит, админ — ✅.
   Ник меняет только человек: робуксы уходят владельцу пасса, ошибка = чужой аккаунт. */

import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { escapeHtml } from "../shared/notify";

const STREAM = "nick-proposals";
let botRef: Telegraf | null = null;

interface NickProposal { id: string; orderId: string; wbCode: string; from: string | null; to: string; at: string; done?: string }

async function readAll(): Promise<NickProposal[]> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } }).catch(() => null);
  return ((row?.metadata ?? {}) as { items?: NickProposal[] }).items ?? [];
}
async function writeAll(items: NickProposal[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metadata = { items: items.slice(-200) } as any;
  await db.wbSyncCursor.upsert({ where: { stream: STREAM }, create: { stream: STREAM, metadata }, update: { metadata } });
}

export async function proposeNickChange(p: { orderId: string; wbCode: string; from: string | null; to: string; why: string; channel: string }): Promise<void> {
  const items = await readAll();
  // Та же просьба по заказу уже ждёт — второй карточки не надо.
  if (items.some((x) => x.orderId === p.orderId && x.to.toLowerCase() === p.to.toLowerCase() && !x.done)) return;
  const id = Math.random().toString(36).slice(2, 10);
  await writeAll([...items, { id, orderId: p.orderId, wbCode: p.wbCode, from: p.from, to: p.to, at: new Date().toISOString() }]);
  if (!botRef) return;
  const { card } = await import("./pa-ai");
  await card(botRef, [
    `✏️ <b>Сменить ник в заказе</b> · ${escapeHtml(p.wbCode)}`,
    `${escapeHtml(p.from ?? "—")} → <b>${escapeHtml(p.to)}</b>`,
    p.why ? `\n🧾 ${escapeHtml(p.why.slice(0, 400))}` : "",
    `\nПодготовил воркер (${escapeHtml(p.channel)}). Если пасс уже стоит — проверьте, что он принадлежит новому нику.`,
  ].join("\n"), [[{ text: "✅ Сменить", callback_data: `nickch:ok:${id}` }, { text: "❌ Нет", callback_data: `nickch:no:${id}` }]]);
}

const isAdmin = (id: number | undefined) => id !== undefined && ADMIN_IDS.map(String).includes(String(id));

export function registerNickProposals(bot: Telegraf): void {
  botRef = bot;
  bot.action(/^nickch:(ok|no):(\w+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("Только для админов").catch(() => undefined);
    const [, act, id] = ctx.match;
    const items = await readAll();
    const p = items.find((x) => x.id === id);
    if (!p || p.done) return ctx.answerCbQuery(p?.done ? "Уже решено" : "Устарело").catch(() => undefined);
    const who = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name ?? "админ";
    let line = "❌ Отклонено";
    if (act === "ok") {
      const r = await db.wbOrder.updateMany({
        where: { id: p.orderId, status: { in: ["AWAITING_GAMEPASS", "PENDING", "ERROR"] } },
        data: { robloxUsername: p.to },
      }).catch(() => ({ count: 0 }));
      line = r.count ? `✅ Ник сменён на ${p.to}` : "⚠️ Заказ уже в другом статусе — ник не менял";
    }
    p.done = `${act}:${who}`;
    await writeAll(items);
    await ctx.answerCbQuery(line.slice(0, 60)).catch(() => undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const old = ((ctx.callbackQuery?.message as any)?.text ?? "") as string;
    await ctx.editMessageText(`${escapeHtml(old)}\n\n${escapeHtml(line)} · ${escapeHtml(who)}`, { parse_mode: "HTML" }).catch(() => undefined);
  });
}
