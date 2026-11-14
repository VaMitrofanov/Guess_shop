import type { MessageContext } from "vk-io";
import {
  CODES_CB,
  CODES_PICK_RE,
  codePickScreen,
  codesStoreScreen,
  inviteScreen,
  parseReferralStart,
  REFERRAL_START_PREFIX,
  type CodesButton,
  type CodesScreen,
} from "../shared/codes-shop";
import { botAttachReferral, botCodeOrder, botCodesView, botOrderKey, siteUrl } from "../shared/codes-bot-api";
import { enforceVkInlineKbLimits } from "../shared/vk-kb";
import { VK_COMMUNITY_ID } from "../shared/vk-links";

/* ─────────────────────────────────────────────────────────────────────────────
   🎟 Коды Roblox и приглашения во ВКонтакте (15.11.2026) — зеркало TG
   (`bots/tg/codes-shop.ts`), тексты общие (`bots/shared/codes-shop.ts`).

   `tryVkCodesShop` зовётся в самом начале `handleMessage`: забирает только
   своё (payload `codes*`, ref `r_<код>`, текст «коды» / «/codes» / «/invite»)
   и возвращает true; всё остальное идёт по старым веткам.

   Отличия от TG: у VK нет «поделиться» через t.me — делимся через
   vk.com/share.php, а ссылку на оплату для родителя кладём текстом (её
   пересылают как сообщение). Лимиты inline-клавиатуры (≤10 кнопок, ≤6 рядов)
   соблюдаются билдерами, `enforceVkInlineKbLimits` — последний рубеж.
   ───────────────────────────────────────────────────────────────────────── */

const TEXT_STORE = new Set(["коды", "код роблокс", "/codes", "codes", "🎟 код robux — сразу"]);
const TEXT_INVITE = new Set(["/invite", "скидка за друзей", "🤝 скидка за друзей"]);

function vkKeyboard(rows: CodesButton[][]): string {
  const buttons = rows.map((row) => row.map((button) => (button.url
    ? { action: { type: "open_link", link: button.url, label: button.label.slice(0, 40) } }
    : {
        action: { type: "text", label: button.label.slice(0, 40), payload: JSON.stringify({ command: button.command ?? CODES_CB.open }) },
        color: button.primary ? "positive" : "secondary",
      })));
  return enforceVkInlineKbLimits(JSON.stringify({ inline: true, buttons }), "vk-codes");
}

/** У VK `open_link` должна быть одна в ряду — разносим по рядам, сохраняя порядок. */
function splitLinkRows(rows: CodesButton[][]): CodesButton[][] {
  const out: CodesButton[][] = [];
  for (const row of rows) {
    if (row.some((button) => button.url) && row.length > 1) for (const button of row) out.push([button]);
    else out.push(row);
  }
  return out;
}

async function send(ctx: MessageContext, screen: CodesScreen, rows = screen.rows, extra = ""): Promise<void> {
  await ctx.reply({ message: `${screen.plain}${extra}`, keyboard: vkKeyboard(splitLinkRows(rows)), dont_parse_links: 1 });
}

async function sorry(ctx: MessageContext): Promise<void> {
  await ctx.reply("Не получилось загрузить витрину кодов. Попробуй через минуту или напиши нам: https://t.me/RobloxBank_PA");
}

export async function openVkCodesStore(ctx: MessageContext, vkUserId: number): Promise<void> {
  const view = await botCodesView("VK", String(vkUserId)).catch(() => null);
  if (!view?.ok) return sorry(ctx);
  const screen = codesStoreScreen(view, siteUrl());
  // 4 ряда номиналов по 2 + «Подарок» (ссылка) и «Скидка» — подарок в отдельный ряд: 6 рядов, 10 кнопок.
  await send(ctx, screen);
}

export async function openVkInvite(ctx: MessageContext, vkUserId: number): Promise<void> {
  const view = await botCodesView("VK", String(vkUserId)).catch(() => null);
  if (!view?.ok) return sorry(ctx);
  const botLink = `https://vk.me/club${VK_COMMUNITY_ID}?ref=${REFERRAL_START_PREFIX}${view.referralCode}`;
  const screen = inviteScreen({ invitedCount: view.invitedCount, discountPercent: view.discountPercent, siteLink: view.siteLink, botLink: null });
  const rows: CodesButton[][] = [
    [{ label: "📤 Поделиться ссылкой", url: `https://vk.com/share.php?url=${encodeURIComponent(view.siteLink)}` }],
    [{ label: "🎟 Купить код", command: CODES_CB.open, primary: true }],
  ];
  await send(ctx, screen, rows, `\n🤖 Ссылка на бота ВК: ${botLink}`);
}

async function pickVk(ctx: MessageContext, vkUserId: number, denomination: number): Promise<void> {
  const subject = String(vkUserId);
  const order = await botCodeOrder("VK", subject, denomination, botOrderKey("VK", subject, denomination)).catch(() => null);
  if (!order) return sorry(ctx);
  if (!order.ok) {
    await ctx.reply(order.code === "SALES_CLOSED"
      ? "⏳ Продажа кодов откроется совсем скоро — цены уже в витрине. Пока можно купить Robux через геймпасс: «💎 Купить напрямую»."
      : `⚠️ ${order.error ?? "Не получилось оформить заказ."}`);
    return;
  }
  const screen = codePickScreen({
    denomination: order.denomination,
    discountPercent: order.discountPercent,
    instant: order.instant,
    payUrl: order.payUrl,
    shareUrl: order.payUrl,
    publicId: order.publicId,
  });
  // В VK «переслать родителю» = переслать само сообщение: ссылка — текстом.
  const rows = screen.rows.filter((row) => !row.some((button) => button.url?.startsWith("https://t.me/share/")));
  await send(ctx, screen, rows, `\n\n🔗 Ссылка на оплату (можно переслать): ${order.payUrl}`);
}

/** true — сообщение обработано здесь. */
export async function tryVkCodesShop(ctx: MessageContext, vkUserId: number, rawRef: string | null | undefined): Promise<boolean> {
  const referral = parseReferralStart(rawRef);
  if (referral) {
    const result = await botAttachReferral("VK", String(vkUserId), referral).catch(() => null);
    if (result === "attached") {
      await ctx.reply("🤝 Тебя пригласил друг — добро пожаловать! Ниже коды Roblox: Robux сразу на баланс, а со скидкой 1% — уже сейчас.");
    }
    await openVkCodesStore(ctx, vkUserId);
    return true;
  }

  const payload = (ctx as unknown as { messagePayload?: { command?: unknown } }).messagePayload;
  const command = typeof payload?.command === "string" ? payload.command : null;
  if (command === CODES_CB.open) { await openVkCodesStore(ctx, vkUserId); return true; }
  if (command === CODES_CB.invite) { await openVkInvite(ctx, vkUserId); return true; }
  if (command === CODES_CB.subscribed) {
    const view = await botCodesView("VK", String(vkUserId), true).catch(() => null);
    if (!view?.ok) { await sorry(ctx); return true; }
    if (!view.subscribed) {
      await ctx.reply(`Пока не вижу подписки на группу — вступи и нажми «✅ Я подписался» ещё раз: ${view.channelUrl}`);
      return true;
    }
    await ctx.reply("✅ Подписка есть — скидка 1% уже в ценах.");
    await openVkCodesStore(ctx, vkUserId);
    return true;
  }
  const picked = command ? CODES_PICK_RE.exec(command) : null;
  if (picked) { await pickVk(ctx, vkUserId, Number(picked[1])); return true; }

  const text = (ctx.text ?? "").trim().toLowerCase();
  if (TEXT_STORE.has(text)) { await openVkCodesStore(ctx, vkUserId); return true; }
  if (TEXT_INVITE.has(text)) { await openVkInvite(ctx, vkUserId); return true; }
  return false;
}
