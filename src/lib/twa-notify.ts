import { prisma } from "@/lib/prisma";
import { refreshDbsCardByCode } from "../../bots/shared/wb-dbs-thread";
import { grantDirectDiscountOnCompletion } from "../../bots/shared/direct-discount";
import { ROBUX_CONFIRM } from "../../bots/shared/robux-eta";
import {
  BUYER_STEP_COMMANDS,
  buyerStepMessage,
  stripHtml,
  type BuyerStepKind,
  type BuyerStepOrder,
} from "../../bots/shared/buyer-step";
import { notifyOrderWatchers, type WatcherEvent } from "../../bots/shared/order-contacts";
import { TG_INVITE_LABEL, TG_INVITE_TEXT, prepareTgInvite } from "../../bots/shared/bot-bind";
import { vkUploadMessagePhoto } from "../../bots/shared/vk-photo";
import { effectExtra } from "../../bots/shared/tg-flair";
import { COMPLETED_IMAGE, buildCompletedMessages, completedMsg1Keyboard, fmtDateRu } from "../../bots/shared/completed-messages";
import { telegramRequestInit } from "../../bots/shared/telegram-photo";
import { readFile } from "node:fs/promises";
import path from "node:path";

interface UserRef {
  id: string;
  tgId?: string | null;
  vkId?: string | null;
}

/**
 * 📲 Telegram первым, ВК — запасным (Э3, 18.11.2026). После склейки у человека
 * бывают оба канала: шлём в Telegram (главный), а если он не доставил (бот
 * заблокирован, чат не найден) — во ВК. Раньше при живом `tgId` отказ
 * Telegram означал «клиент ничего не узнал».
 */
async function tgThenVk(user: UserRef, tgText: string, vkText: string, tgExtra: Record<string, unknown> = {}, vkExtra: Record<string, string> = {}): Promise<"tg" | "vk" | null> {
  if (user.tgId && await tgPostWithEffect(user.tgId, tgText, tgExtra)) return "tg";
  if (user.vkId && await vkPost(user.vkId, vkText, vkExtra)) {
    if (user.tgId) console.warn(`[notify] Telegram не доставил ${user.tgId} — ушло во ВК`);
    return "vk";
  }
  return null;
}

/** true = отправка прошла (или бридж принял), false = точно не доставлено. */
async function tgPost(chatId: string, text: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
  const payload   = { token: process.env.TG_TOKEN, chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra };

  if (bridgeUrl) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.VALIDATOR_KEY) headers["x-validator-key"] = process.env.VALIDATOR_KEY;
    try {
      const r = await fetch(`${bridgeUrl}/tg-proxy`, { method: "POST", headers, body: JSON.stringify(payload) });
      const j: any = await r.json().catch(() => null);
      /* `delivered: false` мост ставит там, где Telegram отказал, а `ok` он
         оставляет true ради вызывающих, которым отказ не важен. Письму
         покупателю он важен: «чат не найден» — это не доставка. */
      if (j?.delivered === false) {
        console.warn("[twa-notify] telegram отказал:", j?.warning ?? j?.description ?? "unknown");
        return false;
      }
      return r.ok && j?.ok !== false;
    } catch (e: any) {
      console.warn("[twa-notify] bridge error:", e?.message);
      return false;
    }
  }

  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j: any = await r.json().catch(() => null);
    if (j?.ok !== true) console.warn("[twa-notify] tg send failed:", j?.description ?? r.status);
    return j?.ok === true;
  } catch (e: any) {
    console.warn("[twa-notify] tg direct error:", e?.message);
    return false;
  }
}

/** true = VK принял сообщение, false = ошибка (напр. 901 — юзер не писал сообществу). */
/**
 * 🎨 Фото с подписью (З3, 18.11.2026): картинка из `public/brand`, подпись HTML,
 * кнопки и эффект. Не вышло с эффектом — ещё раз без него; не вышло с фото —
 * текстом (`tgPost`): сообщение важнее картинки.
 */
async function tgPhotoPost(chatId: string, photoName: string, caption: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  const bytes = await readFile(path.join(process.cwd(), "public", "brand", photoName)).catch(() => null);
  const attempt = async (fields: Record<string, unknown>): Promise<boolean> => {
    const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
    try {
      if (bridgeUrl) {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (process.env.VALIDATOR_KEY) headers["x-validator-key"] = process.env.VALIDATOR_KEY;
        const r = await fetch(`${bridgeUrl}/tg-proxy`, { method: "POST", headers, body: JSON.stringify(fields) });
        const j = await r.json().catch(() => null) as { ok?: boolean; delivered?: boolean } | null;
        return r.ok && j?.ok !== false && j?.delivered !== false;
      }
      const { chat_id, ...rest } = fields;
      const r = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendPhoto`, telegramRequestInit({ ...rest, chat_id }));
      const j = await r.json().catch(() => null) as { ok?: boolean } | null;
      return j?.ok === true;
    } catch {
      return false;
    }
  };
  if (bytes) {
    const base = { chat_id: chatId, photo_base64: bytes.toString("base64"), caption, parse_mode: "HTML", ...extra };
    if (await attempt(base)) return true;
    if ("message_effect_id" in base) {
      const { message_effect_id: _e, ...noEffect } = base;
      void _e;
      if (await attempt(noEffect)) return true;
    }
  }
  return tgPostWithEffect(chatId, caption, extra);
}

/** Текст с эффектом; отказ — ещё раз без эффекта. */
async function tgPostWithEffect(chatId: string, text: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  if (await tgPost(chatId, text, extra)) return true;
  if (!("message_effect_id" in extra)) return false;
  const { message_effect_id: _e, ...rest } = extra;
  void _e;
  return tgPost(chatId, text, rest);
}

async function vkPost(vkUserId: string, message: string, extra: Record<string, string> = {}): Promise<boolean> {
  const params = new URLSearchParams({
    user_id:      vkUserId,
    message,
    random_id:    String(Date.now() + Math.floor(Math.random() * 1000)),
    access_token: process.env.VK_TOKEN ?? "",
    v:            "5.131",
    ...extra,
  });
  try {
    const r = await fetch("https://api.vk.com/method/messages.send", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const j: any = await r.json().catch(() => null);
    if (j?.error) { console.warn("[twa-notify] vk error:", j.error.error_msg); return false; }
    return j?.response !== undefined;
  } catch (e: any) {
    console.warn("[twa-notify] vk error:", e?.message);
    return false;
  }
}

/**
 * 🔗 Копия события аккаунтам, подключённым к заказу с другого TG/VK
 * (`OrderContact`, 17.11.2026). Короткая, без кнопок и без кода ВБ; владелец
 * получает полное сообщение, как раньше. Ошибки не бросает.
 */
function copyToWatchers(ref: { orderId?: string | null; wbCode?: string | null }, ev: WatcherEvent): Promise<number> {
  return notifyOrderWatchers(prisma, ref, ev, {
    tg: (chatId, html) => tgPost(chatId, html),
    vk: (vkId, text) => vkPost(vkId, text),
  });
}

// Ф5: «выкуплено» = два сообщения. Тексты — ОДНИ на ботов и сайт
// (`bots/shared/completed-messages.ts`, 18.11.2026: копия здесь расходилась).
export { fmtDateRu };

/** Чем закончилась попытка сказать покупателю «выкуплен». */
export interface CompletedNoticeResult {
  /** Главное (операционное) сообщение дошло. */
  delivered: boolean;
  /** Второе, бонусное сообщение дошло. */
  bonusDelivered: boolean;
  /** Какой именно питч ушёл вторым сообщением. */
  kind: "review_pitch" | "bonus_reminder" | "tier2" | "thanks";
  channel: "tg" | "vk" | "none";
}

/**
 * Сказать покупателю, что заказ выкуплен.
 *
 * **Возвращает исход доставки, и его обязан проверять вызывающий.** До
 * 08.09.2026 функция ничего не возвращала, а звали её как
 * `notifyOrderCompleted(...).catch(() => {})` — недоставленное сообщение не
 * оставляло следа нигде. По 49ANALQ покупательница три дня не знала, что заказ
 * закрыт, и пришла в поддержку с «долго в обработке», а карточка показывала
 * «📸 Ждёт отзыв», как будто питч ушёл.
 */
export async function notifyOrderCompleted(
  user: UserRef,
  orderId: string,
  amount: number,
  isDirectOrder: boolean
): Promise<CompletedNoticeResult> {
  const [completedCount, order, dbUser] = await Promise.all([
    prisma.wbOrder.count({ where: { userId: user.id, status: "COMPLETED" } }),
    prisma.wbOrder.findUnique({ where: { id: orderId }, select: { wbCode: true, completedAt: true, robloxUsername: true } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { balance: true, reviewBonusGrantedAt: true } }),
  ]);

  // Код этого заказа существует как WbCode и отзыв по нему ещё не оплачен
  // (отсекает AV-/DIR-/MN- псевдокоды — отзыв на WB там невозможен).
  const codeRow = order?.wbCode
    ? await prisma.wbCode.findFirst({ where: { code: order.wbCode }, select: { reviewBonusClaimed: true } })
    : null;

  // Скидка 60 ₽ на вторую прямую покупку — общая политика с ботами
  // (bots/shared/direct-discount.ts). Здесь была вторая копия правила; копии
  // расходятся, а эта ещё и начисляла скидку по кругу.
  const discount = await grantDirectDiscountOnCompletion(prisma, {
    userId: user.id,
    orderId,
    amount,
    isDirectOrder,
  }).catch((err) => {
    console.warn("[twa-notify] failed to grant the direct discount:", err);
    return { granted: false as const, reason: "not_direct" as const };
  });
  const discountGranted = discount.granted;

  const m = buildCompletedMessages({
    isDirectOrder,
    amount,
    completedCount,
    completedAt: order?.completedAt ? new Date(order.completedAt) : new Date(),
    bonusGrantedAt: dbUser?.reviewBonusGrantedAt ? new Date(dbUser.reviewBonusGrantedAt) : null,
    bonusBalance: dbUser?.balance ?? 0,
    codeUnclaimed: codeRow ? codeRow.reviewBonusClaimed === false : false,
    discountGranted,
    nick: order?.robloxUsername ?? null,
  });
  if (m.kind === "tier2") console.log(`[CRM] Direct pitch sent for order #${completedCount}`);

  let delivered = false;
  let bonusDelivered = false;
  let channel: CompletedNoticeResult["channel"] = "none";

  if (user.tgId) {
    channel = "tg";
    // 🎉 З3: картинка «Заказ выкуплен» + подпись + кнопки + конфетти (зеркало ботов).
    delivered = await tgPhotoPost(user.tgId, COMPLETED_IMAGE, m.tgMsg1, {
      reply_markup: completedMsg1Keyboard(), ...effectExtra("party"),
    });
    bonusDelivered = await tgPost(user.tgId, m.tgMsg2, {
      reply_markup: { inline_keyboard: m.buttons.map((b) => [{ text: b.label, callback_data: b.command }]) },
    });
    // pendingReview (питч отзыва) восстановит сам бот: callback review_hint
    // и фолбэк в photo-handler работают без предустановленного состояния.
  }
  // 📲 Э3: Telegram не доставил (или его нет) — запасной канал ВК.
  if (!delivered && user.vkId) {
    if (user.tgId) console.warn(`[notify] «выкуплено»: Telegram ${user.tgId} не доставил — шлём во ВК`);
    channel = "vk";
    const doneJpg = await readFile(path.join(process.cwd(), "public", "brand", COMPLETED_IMAGE)).catch(() => null);
    const doneAttachment = doneJpg ? await vkUploadMessagePhoto(user.vkId, doneJpg) : null;
    delivered = await vkPost(user.vkId, m.vkMsg1, {
      ...(doneAttachment ? { attachment: doneAttachment } : {}),
      keyboard: JSON.stringify({ inline: true, buttons: [[{
        action: { type: "text", label: ROBUX_CONFIRM.label, payload: JSON.stringify({ command: ROBUX_CONFIRM.command }) },
        color: "positive",
      }]] }),
    });
    const vkKb = JSON.stringify({
      inline: true,
      buttons: m.buttons.map((b) => [{
        action: { type: "text", label: b.label, payload: JSON.stringify({ command: b.command }) },
        color: b.command === "start_direct" ? "positive" : "primary",
      }]),
    });
    bonusDelivered = await vkPost(user.vkId, m.vkMsg2, { keyboard: vkKb });
    // 📲 Э6: только-ВК клиента мягко зовём в Telegram (раз в 14 дней, `prepareTgInvite`).
    if (delivered && !user.tgId) await inviteToTelegramVk(user).catch(() => undefined);
  }

  // Живая карточка DBS — единственное место, где виден весь заказ целиком;
  // «выкуплен» обязан появиться и в ней, а не только в чате с покупателем.
  await refreshDbsCardByCode(prisma, order?.wbCode ?? null).catch(() => {});
  await copyToWatchers({ orderId }, { kind: "completed" });

  return { delivered, bonusDelivered, kind: m.kind, channel };
}

/** A safe full-price replacement was not found after Roblox enabled a donor-specific price. */
export async function notifyRegionalPriceNeeded(
  user: UserRef,
  wbCode: string,
  expectedPrice: number,
): Promise<boolean> {
  const tgText =
    `⚠️ <b>Нужен новый геймпасс</b>\n\n` +
    `Roblox включил региональную цену для текущего пасса заказа <b>${wbCode}</b>, поэтому мы безопасно остановили выкуп. ` +
    `Создайте новый геймпасс за <b>${expectedPrice} R$</b> без Managed/Regional Pricing и пришлите ссылку в бот — заказ продолжится.`;
  const plainText =
    `⚠️ Нужен новый геймпасс\n\nRoblox включил региональную цену для текущего пасса заказа ${wbCode}, ` +
    `поэтому мы безопасно остановили выкуп. Создайте новый геймпасс за ${expectedPrice} R$ без Managed/Regional Pricing и пришлите ссылку в бот — заказ продолжится.`;
  await copyToWatchers({ wbCode }, { kind: "new_pass_needed", price: expectedPrice });
  return (await tgThenVk(user, tgText, plainText)) !== null;
}

/**
 * Менеджер привязал заказ к аккаунту клиента (rebind из TWA — кросс-платформенный
 * логин, Авито-заказ и т.п.). Текст выглядит как обычная активация кода — клиент
 * не должен чувствовать «за меня что-то сделали руками» (запрос владельца 04.07).
 * Возвращает канал реальной доставки (как notifyGamepassAttached) — TWA показывает
 * менеджеру честный статус.
 */
export async function notifyRebind(
  user: UserRef,
  amount: number,
  wbCode: string,
  hasGamepass: boolean,
): Promise<"tg" | "vk" | null> {
  const dirty = Math.ceil(amount / 0.7);
  const instructionUrl = `https://robloxbank.ru/guide?skip=1&code=${wbCode}`;
  // AV-/DIR-/MN-коды — внутренние, клиенту их не показываем (политика
  // «идентификатор для клиента = код ВБ или ник», 2026-06-24). WB-код —
  // показываем как при активации. MN- — ручные заказы из TWA (П4).
  const isInternalCode = /^(AV|DIR|MN)-/.test(wbCode);
  const head = isInternalCode
    ? `✅ <b>Заказ на ${amount} R$ оформлен</b> · цена геймпасса <b>${dirty} R$</b>`
    : `✅ Код <b>${wbCode}</b> активирован · номинал <b>${amount} R$</b> → геймпасс <b>${dirty} R$</b>`;

  if (hasGamepass) {
    const tgMsg = `${head}\n\nГеймпасс уже у нас — выкупим, как только дойдёт очередь (сейчас у Roblox задержки — до нескольких суток), и напишем 💛`;
    const vkMsg = tgMsg.replace(/<[^>]+>/g, "");
    return tgThenVk(user, tgMsg, vkMsg);
  }

  const tgMsg = `${head}\n\nСоздайте геймпасс за <b>${dirty} R$</b> и пришлите ссылку сюда — выкупим и начислим робуксы 💛`;
  const vkMsg = tgMsg.replace(/<[^>]+>/g, "") + `\n\n📖 Инструкция: ${instructionUrl}`;

  if (user.tgId) {
    return (await tgPost(user.tgId, tgMsg, {
      reply_markup: { inline_keyboard: [[{ text: "📖 ОТКРЫТЬ ИНСТРУКЦИЮ", url: instructionUrl }]] },
    })) ? "tg" : null;
  }
  if (user.vkId) return (await vkPost(user.vkId, vkMsg)) ? "vk" : null;
  return null;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Пинг GP-watch из TWA-карточки («📣 Оповестить»): тот же текст и те же кнопки
 * ✅/❌, что шлёт воркер (gpw_ok:/gpw_no: ловят боты) — для клиента источник
 * неотличим. Возвращает канал реальной доставки.
 */
export async function notifyGpWatchPing(
  user: UserRef,
  orderId: string,
  nick: string,
  passName: string,
  priceRobux: number,
): Promise<"tg" | "vk" | null> {
  const tgMsg =
    `🎉 <b>Похоже, ваш геймпасс готов!</b>\n\n` +
    `Ник: <b>${escHtml(nick)}</b>\n` +
    `Геймпасс: <b>${escHtml(passName)}</b> · <b>${priceRobux} R$</b>\n\n` +
    `Это ваш геймпасс? Подтвердите — и мы сразу заберём его в выкуп 💛`;

  if (user.tgId) {
    const ok = await tgPost(user.tgId, tgMsg, {
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Да, это мой", callback_data: `gpw_ok:${orderId}` },
          { text: "❌ Не мой ник", callback_data: `gpw_no:${orderId}` },
        ]],
      },
    });
    return ok ? "tg" : null;
  }
  if (user.vkId) {
    const vkKb = JSON.stringify({
      inline: true,
      buttons: [[
        { action: { type: "text", label: "✅ Да, это мой", payload: JSON.stringify({ command: "gpw_ok", orderId }) }, color: "positive" },
        { action: { type: "text", label: "❌ Не мой ник", payload: JSON.stringify({ command: "gpw_no", orderId }) }, color: "negative" },
      ]],
    });
    const ok = await vkPost(
      user.vkId,
      `🎉 Похоже, ваш геймпасс готов!\n\nНик: ${nick}\nГеймпасс: ${passName} · ${priceRobux} R$\n\n` +
      `Это ваш геймпасс? Подтвердите — заберём его в выкуп 💛`,
      { keyboard: vkKb },
    );
    return ok ? "vk" : null;
  }
  return null;
}

/**
 * «📨 Попросить у покупателя» — админка отправляет нужный шаг геймпасса.
 *
 * Текст и кнопки — из `bots/shared/buyer-step` (общие с ботами). Кнопки
 * действия ведут в обработчики самих ботов (`find_gp`, `send_gp_link`),
 * поэтому ответ покупателя обрабатывает бот так же, как на свою кнопку.
 * Возвращает канал реальной доставки.
 */
export async function notifyBuyerStep(
  user: UserRef,
  order: BuyerStepOrder,
  kind: BuyerStepKind,
  customText?: string,
): Promise<"tg" | "vk" | null> {
  const msg = buyerStepMessage(kind, order, customText);
  await copyToWatchers({ wbCode: order.wbCode }, { kind: "buyer_step" });
  if (user.tgId) {
    const inline_keyboard = msg.buttons.map((row) => row.map((b) =>
      "url" in b ? { text: b.label, url: b.url } : { text: b.label, callback_data: BUYER_STEP_COMMANDS.tg[b.action] },
    ));
    return (await tgPost(user.tgId, msg.html, { reply_markup: { inline_keyboard } })) ? "tg" : null;
  }
  if (user.vkId) {
    const buttons = msg.buttons.map((row) => row.map((b) =>
      "url" in b
        ? { action: { type: "open_link", link: b.url, label: b.label.slice(0, 40) } }
        : { action: { type: "text", label: b.label.slice(0, 40), payload: JSON.stringify({ command: BUYER_STEP_COMMANDS.vk[b.action] }) }, color: "primary" },
    ));
    const keyboard = JSON.stringify({ inline: true, buttons });
    return (await vkPost(user.vkId, stripHtml(msg.html), { keyboard })) ? "vk" : null;
  }
  return null;
}

/**
 * Менеджер вручную привязал геймпасс к заказу из TWA («Поиск и выкуп» → 📎).
 * Текст идентичен ботовскому «геймпасс принят», чтобы клиент не заметил разницы.
 * Возвращает канал реальной доставки — TWA показывает менеджеру честный статус.
 */
export async function notifyGamepassAttached(user: UserRef, wbCode: string): Promise<"tg" | "vk" | null> {
  await copyToWatchers({ wbCode }, { kind: "pass_accepted" });
  // Без «номера заявки» — идентификатор для клиента всегда код ВБ
  // (номера заказов убраны из клиентских сообщений 2026-06-24, de7d7fd).
  const tgMsg =
    `🎉 Отлично, геймпасс принят!\n\n` +
    `⏳ Сейчас у Roblox задержки, поэтому выкуп может занять до нескольких суток — часто получается быстрее. Как только будет готово — напишем.\n` +
    `💡 <i>После выкупа робуксы сначала попадут в Pending у Roblox — когда перевести их на баланс, решает уже Roblox.</i>\n\n` +
    `Код ВБ: <code>${wbCode}</code> · Статус и бонусы — в меню`;
  const vkMsg = tgMsg.replace(/<[^>]+>/g, "");

  // ✨ З7: 🔥 — эффект на «геймпасс принят».
  return tgThenVk(user, tgMsg, vkMsg, effectExtra("fire"));
}

/**
 * Геймпасс создали МЫ — ключом, который покупатель прислал в чат менеджеру.
 *
 * Обычный текст привязки («геймпасс принят») здесь соврал бы дважды: человек
 * ничего не присылал боту и ничего больше делать не должен. Поэтому отдельное
 * сообщение: что сделано, на каком аккаунте и что от него больше ничего не
 * нужно (замечание владельца 18.10.2026 — «проще самим его вставить в заказ и
 * сделать все за них»).
 */
export async function notifyGamepassCreatedForBuyer(
  user: UserRef,
  wbCode: string,
  opts: { nick: string; prices: number[] },
): Promise<"tg" | "vk" | null> {
  await copyToWatchers({ wbCode }, { kind: "pass_accepted" });
  const passLine = opts.prices.length > 1
    ? `Создали геймпассы: ${opts.prices.map((price) => `${price} R$`).join(" + ")}`
    : `Создали геймпасс на ${opts.prices[0] ?? 0} R$`;
  const tgMsg =
    `🔑 <b>Сделали за вас — геймпасс готов</b>\n\n` +
    `${passLine} на аккаунте <b>${opts.nick}</b> — по ключу, который вы нам прислал.\n\n` +
    `👍 От вас больше ничего не нужно: заказ уже в очереди на выкуп.\n` +
    `⏳ Сейчас у Roblox задержки, поэтому выкуп может занять до нескольких суток — как только будет готово, напишем.\n` +
    `💡 <i>После выкупа робуксы сначала попадут в Pending у Roblox — когда перевести их на баланс, решает уже Roblox.</i>\n\n` +
    `Код ВБ: <code>${wbCode}</code> · Статус и бонусы — в меню`;
  const vkMsg = tgMsg.replace(/<[^>]+>/g, "");

  return tgThenVk(user, tgMsg, vkMsg);
  return null;
}

export async function notifyOrderRejected(
  user: UserRef,
  wbCode: string,
  reason: string,
  amount: number,
) {
  const reasonLine = reason && reason !== "не указана" ? `💬 Причина: <i>${reason}</i>\n\n` : "";
  const isPrivate  = reason.toLowerCase().includes("закрыт");

  const fixTg = isPrivate
    ? `Как исправить:\n` +
      `1. Нажмите на плейс → <b>Configure → Settings</b> → Audience → выберите <b>Public</b>\n` +
      `   Не помогло? <b>Configure → Questionnaire → Restart</b> → ответьте «No» на 10 вопросов\n` +
      `2. Установите цену геймпасса: <b>${Math.ceil(amount / 0.7)} R$</b>\n` +
      `3. Отправьте новую ссылку:`
    : `Чаще всего причина в одном из двух:\n` +
      `• Цена геймпасса неверная — нужно ${Math.ceil(amount / 0.7)} R$\n` +
      `• Геймпасс не выставлен на продажу\n\n` +
      `Исправьте и отправьте ссылку заново:`;

  // Идентификатор для клиента = код ВБ, не внутренний номер (C2, 2026-07-03).
  const tgMsg = `❌ <b>Заказ отклонён</b> (код <code>${wbCode}</code>)\n\n${reasonLine}${fixTg}`;
  const vkMsg = tgMsg.replace(/<\/?[bi]>/g, "").replace(/<\/?i>/g, "");

  await tgThenVk(user, tgMsg, vkMsg);
  await copyToWatchers({ wbCode }, { kind: "rejected", reason: reason && reason !== "не указана" ? reason : null });
}

/**
 * 📲 Приглашение из ВК в Telegram (Э6, 18.11.2026; владелец: «переманивать
 * аккуратно»). После радостного события, одной кнопкой-ссылкой, не чаще раза
 * в 14 дней (`User.tgInviteAt`). ВКонтакте остаётся — клиента не теряем.
 */
export async function inviteToTelegramVk(user: UserRef): Promise<boolean> {
  if (!user.vkId || user.tgId) return false;
  const url = await prepareTgInvite(prisma, user.id);
  if (!url) return false;
  // 🎨 И4: картинка «Ваши заказы уже ждут в Telegram» (public/brand/tg-invite.png,
  // scripts/render-brand-cards.mjs). Не загрузилась — то же приглашение текстом.
  const png = await readFile(path.join(process.cwd(), "public", "brand", "tg-invite.png")).catch(() => null);
  const attachment = png ? await vkUploadMessagePhoto(user.vkId, png) : null;
  return vkPost(user.vkId, TG_INVITE_TEXT, {
    ...(attachment ? { attachment } : {}),
    keyboard: JSON.stringify({ inline: true, buttons: [[{ action: { type: "open_link", link: url, label: TG_INVITE_LABEL } }]] }),
  });
}

/** Короткое сообщение человеку по правилу «Telegram, при отказе — ВК» (склейка профилей и т.п.). */
export async function notifyPersonText(user: UserRef, html: string): Promise<"tg" | "vk" | null> {
  return tgThenVk(user, html, html.replace(/<[^>]+>/g, ""));
}
