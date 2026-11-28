import { sendTelegramMessage } from "@/lib/telegram";
import { adminTargets, groupSafeMarkup, replyToRootFor } from "../../bots/shared/admin-route";
import { formatAdminNotice, orderRef } from "../../bots/shared/notify-format";
import { queueAdminDigest } from "../../bots/shared/admin-digest";
import { prisma } from "@/lib/prisma";

type RetailBuyoutSource = "twa-order" | "twa-account";

interface RetailBuyoutAdminInput {
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


export function buildRetailBuyoutAdminCard(input: RetailBuyoutAdminInput): string {
  const source = input.source === "twa-order" ? "TWA · заказ" : "TWA · поиск и выкуп";
  const sellerLine = input.sellerName ? `\nПродавец: <b>${escapeHtml(input.sellerName)}</b>` : "";
  const donorLine = input.donorName ? `\nДонор: <b>${escapeHtml(input.donorName)}</b>` : "";
  const balanceLine = Number.isFinite(input.balance)
    ? `\nОстаток: <b>${Number(input.balance).toLocaleString("ru-RU")} R$</b>`
    : "";

  // Единый язык уведомлений админам (`bots/shared/notify-format.ts`): значок
  // кодирует срочность, зона — тему, «Дальше:» — что делать. Выкуп уже
  // состоялся, делать нечего — поэтому 🟢 и без хвоста.
  return formatAdminNotice({
    marker: "done",
    zone: "ВЫКУП",
    title: "выкуп подтверждён",
    lines: [
      orderRef(
        { code: input.wbCode ?? null, denomination: Number.isFinite(input.amount) ? Number(input.amount) : null },
        [`геймпасс <code>${escapeHtml(input.gamepassId)}</code>`],
      ),
      `💸 Списано: <b>${Number(input.chargedPrice).toLocaleString("ru-RU")} R$</b>`
        + donorLine.replace("\n", " · ") + balanceLine.replace("\n", " · "),
      sellerLine.trim() ? sellerLine.replace("\n", "") : null,
      `📊 Источник: ${source}`,
    ],
    next: null,
  });
}

/** Одна строка для часовой сводки «Ленты» (15.11.2026). */
export function retailBuyoutDigestLine(input: RetailBuyoutAdminInput): string {
  return [
    "✅ выкуп",
    input.wbCode ? `<code>${escapeHtml(input.wbCode)}</code>` : `пасс <code>${escapeHtml(input.gamepassId)}</code>`,
    Number.isFinite(input.amount) ? `${Number(input.amount).toLocaleString("ru-RU")} R$` : null,
    `−${Number(input.chargedPrice).toLocaleString("ru-RU")} R$`,
    input.source === "twa-order" ? "TWA" : "поиск",
  ].filter(Boolean).join(" · ");
}

/**
 * Выкуп подтверждён — делать ничего не нужно (выкупал сам админ): с 15.11.2026
 * строкой в часовую сводку «Ленты», а не отдельной карточкой.
 */
export async function notifyRetailBuyoutAdmins(
  input: RetailBuyoutAdminInput,
): Promise<{ admins: number; sent: number }> {
  if (process.env.ADMIN_DIGEST !== "off") {
    await queueAdminDigest(prisma as never, retailBuyoutDigestLine(input));
    return { admins: 1, sent: 1 };
  }
  return sendRetailBuyoutCard(input);
}

/** Отдельная карточка — когда сводка выключена (`ADMIN_DIGEST=off`). */
async function sendRetailBuyoutCard(
  input: RetailBuyoutAdminInput,
): Promise<{ admins: number; sent: number }> {
  const token = process.env.TG_TOKEN;
  // Выкуп состоялся — делать нечего: тихо в «📦 Ленту».
  const recipients = await adminTargets("feed", { loud: false });
  if (!token || recipients.length === 0) {
    console.warn("[buyout-admin-notify] TG_TOKEN or admin IDs missing — buyout card not sent");
    return { admins: recipients.length, sent: 0 };
  }

  const text = buildRetailBuyoutAdminCard(input);
  const results = await Promise.allSettled(
    recipients.map((t) => sendTelegramMessage(token, t.chatId, text, t.extra)),
  );
  const sent = results.filter((result) => result.status === "fulfilled" && result.value === true).length;
  return { admins: recipients.length, sent };
}
