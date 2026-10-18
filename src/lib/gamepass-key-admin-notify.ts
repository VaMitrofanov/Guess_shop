import { sendTelegramMessage, telegramAdminRecipients } from "@/lib/telegram";
import { formatAdminNotice, orderRef } from "../../bots/shared/notify-format";

/**
 * «Пассы созданы ключом покупателя — ключ вставил админ».
 *
 * Решение владельца 18.10.2026 (О1): после создания сначала уведомляем себя —
 * «чтобы убедиться, что реально создалось», — и только потом формируем заказ и
 * пишем клиенту. Поэтому карточка называет КАЖДЫЙ пасс и то, что про него
 * ответил Roblox: пасс, который API создал, но которого нет в продаже или у
 * которого другая цена, выкуп не возьмёт, и узнать об этом надо здесь, а не из
 * жалобы покупателя через сутки.
 *
 * Ключ в карточку не попадает ни при каком исходе (`docs/security.md`).
 */

export interface KeyCreatedPassCheck {
  gamepassId: string;
  /** Цена, которую мы просили выставить. */
  price: number;
  /** Что увидел Roblox: `null` — не ответил вовсе. */
  live: { price: number | null; isForSale: boolean } | null;
}

export interface KeyCreatedAdminInput {
  wbCode: string;
  amount: number | null;
  nick: string;
  adminName: string;
  passes: KeyCreatedPassCheck[];
  /** Машинный отказ Roblox, если набор создан не полностью. */
  error?: string | null;
  /** Привязали ли созданное к заказу (О1 — привязываем сразу). */
  attached: boolean;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Одна строка на пасс: что создали и что про это говорит Roblox. */
function passLine(pass: KeyCreatedPassCheck): string {
  const head = `• <code>${escapeHtml(pass.gamepassId)}</code> · ${pass.price} R$`;
  if (!pass.live) return `${head} — ❔ Roblox не ответил, проверь руками`;
  if (!pass.live.isForSale) return `${head} — ⚠️ НЕ в продаже`;
  if (pass.live.price != null && Math.abs(pass.live.price - pass.price) > 2) {
    return `${head} — ⚠️ цена ${pass.live.price} R$ вместо ${pass.price} R$`;
  }
  return `${head} — ✅ в продаже, цена сходится`;
}

export function passNeedsHands(pass: KeyCreatedPassCheck): boolean {
  if (!pass.live) return true;
  if (!pass.live.isForSale) return true;
  return pass.live.price != null && Math.abs(pass.live.price - pass.price) > 2;
}

export function buildKeyCreatedAdminCard(input: KeyCreatedAdminInput): string {
  const suspicious = input.passes.some(passNeedsHands) || Boolean(input.error);
  return formatAdminNotice({
    // Всё сошлось — это просто ход дела (🔵). Хоть один пасс под вопросом или
    // набор неполный — нужны руки (🟠): выкуп на такой заказ встанет.
    marker: suspicious ? "action" : "progress",
    // Зона «ВЫКУП»: практический смысл карточки — заказ теперь готов к выкупу,
    // и перед ним надо убедиться, что пассы на месте.
    zone: "ВЫКУП",
    title: "пассы созданы ключом покупателя (ключ вставил админ)",
    lines: [
      orderRef({ code: input.wbCode, denomination: input.amount }, [
        `ник <b>${escapeHtml(input.nick)}</b>`,
        `вставил ${escapeHtml(input.adminName)}`,
      ]),
      ...input.passes.map(passLine),
      input.error ? `⚠️ Набор создан не полностью: <code>${escapeHtml(input.error)}</code>` : null,
      // Карточка уходит ДО правки заказа (решение владельца О1), поэтому и
      // слова в будущем времени: «привязываем», а не «привязано».
      input.attached
        ? "📎 Привязываем к заказу и ставим в очередь выкупа"
        : "📎 К заказу НЕ привязываем — набор неполный, привяжи руками",
    ],
    next: suspicious
      ? "открыть пасс на Roblox и проверить цену/продажу до выкупа"
      : "ничего — заказ в очереди, покупателю уже написали",
  });
}

/** Разослать карточку всем админам. Возвращает, сколько реально ушло. */
export async function notifyAdminsKeyCreated(
  input: KeyCreatedAdminInput,
): Promise<{ admins: number; sent: number }> {
  const token = process.env.TG_TOKEN;
  const recipients = telegramAdminRecipients();
  if (!token || recipients.length === 0) {
    console.warn("[key-admin-notify] нет TG_TOKEN или ADMIN_IDS — карточка не ушла");
    return { admins: recipients.length, sent: 0 };
  }
  const text = buildKeyCreatedAdminCard(input);
  const results = await Promise.allSettled(recipients.map((id) => sendTelegramMessage(token, id, text)));
  const sent = results.filter((r) => r.status === "fulfilled" && r.value === true).length;
  return { admins: recipients.length, sent };
}
