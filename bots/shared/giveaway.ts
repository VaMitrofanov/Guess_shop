/* ─────────────────────────────────────────────────────────────────────────────
   🎁 Розыгрыши в канале (15.11.2026, владелец: «розыгрыши нужны обязательно,
   приз — самый дешёвый код»).

   Механика простая и честная:
   - админ в личке бота: `/giveaway 48` — пост в TG-канал с кнопкой
     «🎁 Участвовать», итоги через 48 часов, приз — код 100 R$;
   - участвует только подписчик канала (проверка при нажатии и ещё раз при
     выборе победителя — отписавшийся выбывает);
   - победитель — `crypto.randomInt` среди участников, итог — правкой поста
     и ответом под ним; победителю — сообщение в бот, админам — «выдать код».

   Модуль чистый: состояние и тексты. Telegram и база — `bots/tg/giveaways.ts`.
   ───────────────────────────────────────────────────────────────────────── */

import crypto from "node:crypto";

export const GIVEAWAY_STREAM = "giveaways";
export const GIVEAWAY_DEFAULT_PRIZE = 100;

export interface GiveawayParticipant {
  tgId: string;
  name: string;
  at: string;
}

export interface Giveaway {
  id: string;
  prize: number;
  endsAt: string;
  createdAt: string;
  createdBy: string;
  channelMessageId: number | null;
  participants: GiveawayParticipant[];
  status: "active" | "finished" | "cancelled";
  winner?: GiveawayParticipant | null;
}

export interface GiveawayState {
  active: Giveaway | null;
  history: Giveaway[];
}

export const GIVEAWAY_CB = {
  join: (id: string) => `gw:j:${id}`,
} as const;
export const GIVEAWAY_JOIN_RE = /^gw:j:([a-z0-9]{6,16})$/;

export function newGiveawayId(): string {
  return crypto.randomBytes(5).toString("hex");
}

function fmtEnd(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

function participantsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "участник";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "участника";
  return "участников";
}

export function giveawayPostText(g: Giveaway): string {
  return [
    `🎁 <b>РОЗЫГРЫШ: код Roblox на ${g.prize.toLocaleString("ru-RU")} Robux</b>`,
    "",
    "Условия простые:",
    "1️⃣ Быть подписанным на этот канал",
    "2️⃣ Нажать «🎁 Участвовать» под постом",
    "",
    `🗓 Итоги — <b>${fmtEnd(g.endsAt)} МСК</b>. Победителя выберет бот случайно и напишет ему в @RobloxBankBot.`,
    "",
    "<i>Расскажи друзьям — чем больше подписчиков, тем чаще разыгрываем 💜</i>",
  ].join("\n");
}

export function giveawayButtonLabel(g: Giveaway): string {
  return g.participants.length > 0 ? `🎁 Участвовать · ${g.participants.length}` : "🎁 Участвовать";
}

export function giveawayResultText(g: Giveaway): string {
  const winner = g.winner;
  return [
    `🎉 <b>Итоги розыгрыша кода на ${g.prize.toLocaleString("ru-RU")} Robux</b>`,
    "",
    winner ? `Победитель — <b>${escapeHtmlLite(winner.name)}</b>! Поздравляем 🥳 Код пришлём в @RobloxBankBot.` : "Участников не набралось — разыграем приз в следующий раз.",
    `Участвовали: ${g.participants.length} ${participantsWord(g.participants.length)}.`,
    "",
    "Следующий розыгрыш — скоро. Не отписывайся 💜",
  ].join("\n");
}

function escapeHtmlLite(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Добавить участника (идемпотентно). */
export function joinGiveaway(g: Giveaway, p: { tgId: string; name: string }, now = new Date()): { giveaway: Giveaway; added: boolean } {
  if (g.status !== "active" || new Date(g.endsAt).getTime() <= now.getTime()) return { giveaway: g, added: false };
  if (g.participants.some((x) => x.tgId === p.tgId)) return { giveaway: g, added: false };
  return {
    giveaway: { ...g, participants: [...g.participants, { tgId: p.tgId, name: p.name.slice(0, 64), at: now.toISOString() }] },
    added: true,
  };
}

/**
 * Выбрать победителя: случайный порядок, первый, кто всё ещё подписан
 * (`stillSubscribed`). Проверяем не больше `maxChecks` кандидатов.
 */
export async function pickWinner(
  g: Giveaway,
  stillSubscribed: (tgId: string) => Promise<boolean>,
  maxChecks = 30,
): Promise<GiveawayParticipant | null> {
  const pool = [...g.participants];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (const candidate of pool.slice(0, maxChecks)) {
    if (await stillSubscribed(candidate.tgId)) return candidate;
  }
  return null;
}
