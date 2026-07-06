/**
 * Early Roblox-nick capture → order NOTES, not the primary nick field.
 *
 * The moment the customer reveals a nick (nick search, a gamepass that failed
 * validation, site search) we note it on the order so the manager sees it
 * immediately and can attach the right gamepass from TWA («Поиск и выкуп» → 📎)
 * — case VFNCQMT, where the manager had to write the nick into adminNote by
 * hand.
 *
 * ВАЖНО (решение владельца 2026-07-03): захваченный ник — это «вероятный» ник,
 * не 100% (юзер мог опечататься). Поэтому он пишется ТОЛЬКО в `adminNote`
 * (`[НИК? дата] ник (источник)`), никогда — в `WbOrder.robloxUsername` или
 * `User.robloxUsername`. Основное поле заполняют только подтверждённые пути
 * (успешная валидация геймпасса, one-tap выбор, менеджер вручную).
 *
 * Best-effort — never throws into the calling flow.
 */
import { db } from "./db";

const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;

export async function noteProbableNick(opts: {
  nick: string;
  /** Where the nick came from — lands in the note. */
  source: string;
  /** Corridor order to annotate (skipped for DIR-/AV- synthetic codes). */
  wbCode?: string;
}): Promise<void> {
  const nick = opts.nick.trim().replace(/^@/, "");
  if (!NICK_RE.test(nick)) return;

  const code = opts.wbCode?.trim();
  if (!code || code.startsWith("DIR-") || code.startsWith("AV-")) return;

  try {
    const order = await (db as any).wbOrder.findFirst({
      where: { wbCode: { equals: code, mode: "insensitive" }, status: { not: "COMPLETED" } },
      select: { id: true, robloxUsername: true, adminNote: true },
    });
    if (!order) return;
    // Already the confirmed nick, or already noted — don't spam the note.
    if (order.robloxUsername?.toLowerCase() === nick.toLowerCase()) return;
    if (order.adminNote?.toLowerCase().includes(nick.toLowerCase())) return;

    const stamp = new Date().toISOString().slice(0, 10);
    const prefix = order.adminNote ? `${order.adminNote}\n` : "";
    await (db as any).wbOrder.update({
      where: { id: order.id },
      data: {
        adminNote: `${prefix}[НИК? ${stamp}] ${nick} (${opts.source})`.slice(0, 2000),
        // Structured mirror for the GP-watcher (+3) — last probable nick wins.
        probableNick: nick,
        probableNickAt: new Date(),
        // П3: новый вероятный ник снимает бейдж «клиент отверг ник» —
        // GP-watch возобновляется по свежему нику.
        gpWatchDeclinedAt: null,
      },
    });
  } catch (err: any) {
    console.warn(`[nick-capture] failed (${opts.source}):`, err?.message ?? err);
  }
}
