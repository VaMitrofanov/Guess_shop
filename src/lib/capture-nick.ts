import { prisma } from "@/lib/prisma";

/**
 * Early Roblox-nick capture → order NOTES (web side; mirrors `bots/shared/nick.ts`).
 *
 * The on-site nick search reveals the customer's probable nick before any
 * order materialises — note it on the order so the manager sees it and can
 * attach the right gamepass from TWA («Поиск и выкуп» → 📎), case VFNCQMT.
 *
 * ВАЖНО (решение владельца 2026-07-03): захваченный ник — «вероятный», не 100%
 * (юзер мог опечататься). Пишется ТОЛЬКО в `WbOrder.adminNote`
 * (`[НИК? дата] ник (источник)`), никогда — в `robloxUsername`. Основное поле
 * заполняют только подтверждённые пути (валидация геймпасса, one-tap выбор).
 *
 * Best-effort — never throws into the calling flow.
 */
const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;

export async function noteProbableNickByCode(wbCode: string, rawNick: string, source: string): Promise<void> {
  const nick = rawNick.trim().replace(/^@/, "");
  const code = wbCode.trim().toUpperCase();
  if (!NICK_RE.test(nick) || !/^[A-Z0-9]{7}$/.test(code)) return;
  try {
    const order = await (prisma as any).wbOrder.findFirst({
      where: { wbCode: { equals: code, mode: "insensitive" }, status: { not: "COMPLETED" } },
      select: { id: true, robloxUsername: true, adminNote: true },
    });
    if (!order) return;
    // Already the confirmed nick, or already noted — don't spam the note.
    if (order.robloxUsername?.toLowerCase() === nick.toLowerCase()) return;
    if (order.adminNote?.toLowerCase().includes(nick.toLowerCase())) return;

    const stamp = new Date().toISOString().slice(0, 10);
    const prefix = order.adminNote ? `${order.adminNote}\n` : "";
    await (prisma as any).wbOrder.update({
      where: { id: order.id },
      data: { adminNote: `${prefix}[НИК? ${stamp}] ${nick} (${source})`.slice(0, 2000) },
    });
  } catch (err: any) {
    console.warn(`[nick-capture] failed (${source}):`, err?.message ?? err);
  }
}
