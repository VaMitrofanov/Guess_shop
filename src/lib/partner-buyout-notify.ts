import { sendTelegramMessage } from "@/lib/telegram";

/**
 * Admin notification for a partner (B2B) buyout.
 *
 * Retail orders already broadcast a card to the Telegram admins (see
 * `bots/shared/admin.ts` / `src/lib/admin-card.ts`), but the partner buyout flow
 * (`/api/twa/partners/[slug]/tasks` → `purchase-task` / `mark-done`) never told
 * anyone. Владелец: любой выкуп пачки Антона обязан прилетать в админку.
 *
 * This module only formats and broadcasts — the caller (the partner route)
 * builds the input from the DB (DONE tasks + their BUYOUT ledger entries) so the
 * money figures are authoritative and cannot be spoofed by the client.
 *
 * Uses the same web→admin transport as `sendWebOrderCard` (`sendTelegramMessage`,
 * which routes through the Singapore bridge when configured), so delivery behaves
 * identically to the already-working retail admin cards.
 */

export interface PartnerBuyoutNotifyItem {
  nick: string | null;
  gamepassId: string | null;
  /** Dirty R$ paid for this gamepass. */
  robux: number;
  /** USDT actually debited from the partner ledger for this task. */
  usdt: number;
}

export interface PartnerBuyoutCardInput {
  partnerName: string;
  /** Successfully bought tasks (already filtered to DONE by the caller). */
  items: PartnerBuyoutNotifyItem[];
  totalRobux: number;
  totalUsdt: number;
  /** Partner ledger balance after the buyout. */
  balanceUsdt: number;
  /** Partner rate at debit time, USDT per 1000 R$. */
  rate: number;
  /** Failed tasks in the same batch (informational). */
  failCount?: number;
  operator?: string | null;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

/** Первые N позиций печатаем построчно, остальное сворачиваем в «…и ещё K». */
const MAX_ITEM_LINES = 12;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtUsdt(value: number): string {
  // toFixed вместо toLocaleString — детерминированно и без ICU-зависимостей.
  return value.toFixed(2);
}

function fmtRobux(value: number): string {
  return value.toLocaleString("ru-RU");
}

/** Русское склонение слова «геймпасс» по числу выкупленных позиций. */
export function pluralizeGamepass(n: number): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return "геймпассов";
  if (mod10 === 1) return "геймпасс";
  if (mod10 >= 2 && mod10 <= 4) return "геймпасса";
  return "геймпассов";
}

export function buildPartnerBuyoutCard(input: PartnerBuyoutCardInput): string {
  const n = input.items.length;
  const dateStr =
    (input.now ?? new Date()).toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }) + " МСК";

  const lines = input.items.slice(0, MAX_ITEM_LINES).map((it) => {
    const nick = it.nick ? escapeHtml(it.nick) : "—";
    const gp = it.gamepassId ? `GP ${escapeHtml(it.gamepassId)}` : "GP —";
    return `• ${nick} · ${gp} · ${fmtRobux(it.robux)} R$`;
  });
  const moreLine = n > MAX_ITEM_LINES ? `…и ещё ${n - MAX_ITEM_LINES}` : null;

  const failLine =
    input.failCount && input.failCount > 0 ? `⚠️ Ошибок в пачке: <b>${input.failCount}</b>\n` : "";
  const operatorLine = input.operator ? `👤 Оператор: ${escapeHtml(input.operator)}\n` : "";

  return (
    `🤝 <b>ВЫКУП ПАРТНЁРА · ${escapeHtml(input.partnerName)}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📦 Выкуплено: <b>${n} ${pluralizeGamepass(n)}</b>\n` +
    `💎 Сумма: <b>${fmtRobux(input.totalRobux)} R$</b> ≈ <b>${fmtUsdt(input.totalUsdt)} USDT</b>\n` +
    `💱 Курс: <b>${input.rate} USDT / 1000 R$</b>\n` +
    `👛 Остаток баланса: <b>${fmtUsdt(input.balanceUsdt)} USDT</b>\n` +
    failLine +
    operatorLine +
    (lines.length ? `\n${lines.join("\n")}\n` : "") +
    (moreLine ? `${moreLine}\n` : "") +
    `\n⏰ ${dateStr}`
  );
}

/**
 * Broadcast the buyout card to every Telegram admin.
 *
 * Returns how many admins were targeted and how many sends the transport
 * confirmed — the caller can surface this, but a zero/partial result never
 * fails the buyout itself (the money already moved).
 */
export async function notifyPartnerBuyout(
  input: PartnerBuyoutCardInput,
): Promise<{ admins: number; sent: number }> {
  const token = process.env.TG_TOKEN;
  const adminIds = (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!token || adminIds.length === 0) {
    console.warn("[partner-buyout-notify] TG_TOKEN or admin IDs missing — buyout card not sent");
    return { admins: adminIds.length, sent: 0 };
  }
  if (input.items.length === 0) return { admins: adminIds.length, sent: 0 };

  const text = buildPartnerBuyoutCard(input);
  const results = await Promise.allSettled(
    adminIds.map((id) => sendTelegramMessage(token, id, text)),
  );
  const sent = results.filter((r) => r.status === "fulfilled" && r.value === true).length;
  return { admins: adminIds.length, sent };
}
