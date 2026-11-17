/* ─────────────────────────────────────────────────────────────────────────────
   Контакты заказа во ВКонтакте (17.11.2026) — зеркало `bots/tg/order-contacts-tg.ts`.

   Код занят другим VK-аккаунтом → вопрос «добавить этот аккаунт к заказу?»
   вместо тупика; кнопки `oc_add` / `oc_no` / `oc_rm` приходят payload'ом.
   Payload во ВКонтакте может прислать кто угодно, поэтому «да» засчитывается
   только для заказа, который бот сам недавно предложил этому человеку
   (`takeOffer`), а «убрать» — только владельцу заказа или самому подключённому.
   ───────────────────────────────────────────────────────────────────────── */

import type { MessageContext } from "vk-io";
import { db } from "../shared/db";
import { notifyContactOwner } from "../shared/order-contacts-notify";
import {
  CONTACT_CB, DECLINE_LABEL, STALE_OFFER_TEXT,
  addOrderContact, addedText, blockedText, declinedText, findOrdersByClues, offerButtonLabel, offerKey,
  offerText, planContactOffer, recordContactDeclined, rememberOffer, removeOrderContact, takeOffer, dropOffer,
  type FoundOrder,
} from "../shared/order-contacts";

function offerKeyboard(orders: FoundOrder[]): string {
  const many = orders.length > 1;
  return JSON.stringify({
    inline: true,
    buttons: [
      ...orders.map((o) => [{
        action: { type: "text", label: offerButtonLabel(o, many), payload: JSON.stringify({ command: CONTACT_CB.add, id: o.id }) },
        color: "positive",
      }]),
      [{ action: { type: "text", label: DECLINE_LABEL, payload: JSON.stringify({ command: CONTACT_CB.no, id: orders[0].id }) }, color: "secondary" }],
    ],
  });
}

/** Код занят другим аккаунтом этой площадки. `false` — предложить нечего. */
export async function offerInBotVk(ctx: MessageContext, vkUserId: number, code: string): Promise<boolean> {
  const vkId = String(vkUserId);
  const orders = await findOrdersByClues(db, { codes: [code], passIds: [], nicks: [] });
  if (!orders.length) return false;
  const sender = await db.user.findUnique({ where: { vkId }, select: { id: true } });
  const plan = await planContactOffer(db, { senderUserId: sender?.id ?? null, orders });
  if (plan.kind === "blocked") {
    await ctx.reply(blockedText(plan.reason));
    return true;
  }
  if (plan.kind !== "offer") return false;
  rememberOffer(offerKey("VK", vkId), plan.orders);
  await ctx.reply(offerText(plan.orders, "VK", false), { keyboard: offerKeyboard(plan.orders) } as never);
  return true;
}

/** Кнопки контактов. `true` — payload наш и обработан. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleContactPayloadVk(ctx: MessageContext, vkUserId: number, payload: any, name: string): Promise<boolean> {
  const cmd = payload?.command;
  if (cmd !== CONTACT_CB.add && cmd !== CONTACT_CB.no && cmd !== CONTACT_CB.rm) return false;
  const id = typeof payload?.id === "string" && /^[a-z0-9]{10,40}$/i.test(payload.id) ? payload.id : null;
  if (!id) return true;
  const vkId = String(vkUserId);

  try {
    if (cmd === CONTACT_CB.rm) {
      const presser = await db.user.findUnique({ where: { vkId }, select: { id: true } });
      let res = await removeOrderContact(db, { contactId: id, pressedByUserId: presser?.id ?? null, by: "owner" });
      if (!res.ok && res.reason === "forbidden") res = await removeOrderContact(db, { contactId: id, pressedByUserId: presser?.id ?? null, by: "self" });
      if (res.ok) await ctx.reply("Готово, этот аккаунт больше не получает уведомления о заказе.");
      else if (res.reason === "already") await ctx.reply("Этот аккаунт уже убран.");
      return true;
    }

    const key = offerKey("VK", vkId);
    const offer = takeOffer(key, id);
    if (!offer) {
      await ctx.reply(STALE_OFFER_TEXT);
      return true;
    }
    if (cmd === CONTACT_CB.no) {
      dropOffer(key);
      await recordContactDeclined(db, id, { platform: "VK", label: name || `vk:${vkId}`, clue: offer.clue });
      await ctx.reply(declinedText());
      return true;
    }

    const user = await db.user.upsert({
      where: { vkId },
      create: { vkId, name: name || null },
      update: {},
      select: { id: true },
    });
    const label = name || `vk:${vkId}`;
    const res = await addOrderContact(db, { orderId: id, userId: user.id, via: "bot_code", evidence: offer.evidence, platform: "VK", label });
    dropOffer(key);
    if (!res.ok) {
      await ctx.reply(blockedText(res.reason));
      return true;
    }
    await ctx.reply(addedText(res.order, { inBot: true, html: false }));
    if (res.created) await notifyContactOwner(res.order.user, res.order, res.contactId, { platform: "VK", label });
    console.log(`[order-contacts] подключён VK-аккаунт к заказу ${res.order.wbCode}`);
  } catch (err) {
    console.warn("[order-contacts] VK-кнопка упала:", err instanceof Error ? err.message : err);
    await ctx.reply("Не получилось — напишите нам: https://t.me/RobloxBank_PA").catch(() => undefined);
  }
  return true;
}
