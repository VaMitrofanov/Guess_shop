import { sendTelegramMessage } from "@/lib/telegram";

export type RetailBuyoutSource = "twa-order" | "twa-account";

export interface RetailBuyoutAdminInput {
  source: RetailBuyoutSource;
  gamepassId: string;
  chargedPrice: number;
  wbCode?: string | null;
  amount?: number | null;
  donorName?: string | null;
  sellerName?: string | null;
  balance?: number | null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function adminIds(): string[] {
  return [...new Set(
    (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

export function buildRetailBuyoutAdminCard(input: RetailBuyoutAdminInput): string {
  const source = input.source === "twa-order" ? "TWA · заказ" : "TWA · поиск и выкуп";
  const orderLine = input.wbCode ? `\nЗаказ: <code>${escapeHtml(input.wbCode)}</code>` : "";
  const amountLine = Number.isFinite(input.amount) ? `\nНоминал: <b>${Number(input.amount).toLocaleString("ru-RU")} R$</b>` : "";
  const sellerLine = input.sellerName ? `\nПродавец: <b>${escapeHtml(input.sellerName)}</b>` : "";
  const donorLine = input.donorName ? `\nДонор: <b>${escapeHtml(input.donorName)}</b>` : "";
  const balanceLine = Number.isFinite(input.balance)
    ? `\nОстаток: <b>${Number(input.balance).toLocaleString("ru-RU")} R$</b>`
    : "";

  return (
    `✅ <b>Выкуп подтверждён</b> · ${source}` +
    orderLine +
    `\nГеймпасс: <code>${escapeHtml(input.gamepassId)}</code>` +
    sellerLine +
    amountLine +
    `\nСписано: <b>${Number(input.chargedPrice).toLocaleString("ru-RU")} R$</b>` +
    donorLine +
    balanceLine
  );
}

/** Broadcast a confirmed TWA buyout to every configured Telegram admin. */
export async function notifyRetailBuyoutAdmins(
  input: RetailBuyoutAdminInput,
): Promise<{ admins: number; sent: number }> {
  const token = process.env.TG_TOKEN;
  const recipients = adminIds();
  if (!token || recipients.length === 0) {
    console.warn("[buyout-admin-notify] TG_TOKEN or admin IDs missing — buyout card not sent");
    return { admins: recipients.length, sent: 0 };
  }

  const text = buildRetailBuyoutAdminCard(input);
  const results = await Promise.allSettled(
    recipients.map((id) => sendTelegramMessage(token, id, text)),
  );
  const sent = results.filter((result) => result.status === "fulfilled" && result.value === true).length;
  return { admins: recipients.length, sent };
}
