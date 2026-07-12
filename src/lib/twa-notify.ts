import { prisma } from "@/lib/prisma";

interface UserRef {
  id: string;
  tgId?: string | null;
  vkId?: string | null;
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

// ─────────────────────────────────────────────────────────────────────────────
// Ф5 (2026-07-12): уведомление о выкупе = ДВА сообщения (операционное + бонусное).
// ЗЕРКАЛО bots/shared/completed-messages.ts — bots/ и src/ не импортируют друг
// друга, менять СИНХРОННО. Ветвление msg2: питч отзыва (2 кнопки, О2) →
// напоминание о бонусе на балансе → TIER-2 питч → благодарность (+скидка DIR<500).
// ─────────────────────────────────────────────────────────────────────────────

/** Roblox держит робуксы за геймпасс в Pending ~5 дней. */
export const ROBUX_UNLOCK_DAYS = 5;

export function robuxUnlockDate(completedAt: Date): Date {
  return new Date(completedAt.getTime() + ROBUX_UNLOCK_DAYS * 86_400_000);
}

export function fmtDateRu(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
}

type CompletedButton = {
  label: string;
  /** TG callback_data и VK payload.command — одинаковые строки. */
  command: "review_hint" | "start_direct";
};

interface CompletedMessagesInput {
  isDirectOrder: boolean;
  /** Все COMPLETED-заказы юзера (включая этот). */
  completedCount: number;
  /** Момент выкупа (WbOrder.completedAt); null у легаси-путей → сейчас. */
  completedAt: Date | null;
  /** user.reviewBonusGrantedAt — бонус сейчас на балансе (крон обнуляет по истечении). */
  bonusGrantedAt: Date | null;
  /** user.balance (R$ бонуса). */
  bonusBalance: number;
  /** WbCode этого заказа существует и reviewBonusClaimed=false (WB-код, отзыв ещё не оплачен). */
  codeUnclaimed: boolean;
  /** DIR <500 R$ — начислена скидка 60 ₽ (сайд-эффект на вызывающей стороне). */
  discountGranted: boolean;
}

interface CompletedMessages {
  kind: "review_pitch" | "bonus_reminder" | "tier2" | "thanks";
  /** HTML-версии для TG. */
  tgMsg1: string;
  tgMsg2: string;
  /** Plain-версии для VK (ссылки текстом). */
  vkMsg1: string;
  vkMsg2: string;
  buttons: CompletedButton[];
}

const BTN_REVIEW: CompletedButton = { label: "📸 Прислать отзыв", command: "review_hint" };
const BTN_DIRECT: CompletedButton = { label: "💎 Купить напрямую", command: "start_direct" };
const BTN_USE_BONUS: CompletedButton = { label: "💎 Использовать бонус", command: "start_direct" };

const BONUS_EXPIRY_DAYS = 30; // = REVIEW_BONUS_EXPIRY_DAYS (bots/shared/review-eligibility.ts)

function buildCompletedMessages(inp: CompletedMessagesInput): CompletedMessages {
  const unlockStr = fmtDateRu(robuxUnlockDate(inp.completedAt ?? new Date()));

  const tgMsg1 =
    `✅ <b>Заказ выкуплен!</b> Робуксы уже в пути 🚀\n\n` +
    `Roblox зачислит их до <b>${unlockStr}</b> — это стандартная заморозка «Pending» на их стороне.\n\n` +
    `📊 Проверить: https://www.roblox.com/transactions → строка <b>Pending</b>`;
  const vkMsg1 =
    `✅ Заказ выкуплен! Робуксы уже в пути 🚀\n\n` +
    `Roblox зачислит их до ${unlockStr} — это стандартная заморозка «Pending» на их стороне.\n\n` +
    `📊 Проверить: https://www.roblox.com/transactions → строка Pending`;

  const discountTg = inp.discountGranted ? `\n\n💰 Дарю тебе скидку <b>60 рублей</b> к следующему заказу.` : "";
  const discountVk = inp.discountGranted ? `\n\n💰 Дарю тебе скидку 60 рублей к следующему заказу.` : "";

  // 1. Питч отзыва: WB-заказ, бонуса на балансе нет, код не заклеймлен.
  if (!inp.isDirectOrder && !inp.bonusGrantedAt && inp.codeUnclaimed) {
    const tgMsg2 =
      `🎁 <b>Бонус за отзыв: +100 R$</b> к любому прямому заказу.\n\n` +
      `Как получить:\n` +
      `1. Оставь отзыв на Wildberries — с текстом и фото (только оценка не подойдёт).\n` +
      `2. Пришли скриншот сюда фотографией (не файлом).\n\n` +
      `После проверки начислим сразу. Действует ${BONUS_EXPIRY_DAYS} дней.`;
    return {
      kind: "review_pitch",
      tgMsg1, vkMsg1, tgMsg2,
      vkMsg2: tgMsg2.replace(/<\/?b>/g, ""),
      buttons: [BTN_REVIEW, BTN_DIRECT],
    };
  }

  // 2. Бонус уже на балансе — напомнить потратить.
  if (inp.bonusGrantedAt) {
    const expiresStr = fmtDateRu(new Date(inp.bonusGrantedAt.getTime() + BONUS_EXPIRY_DAYS * 86_400_000));
    const balanceStr = inp.bonusBalance > 0 ? `${inp.bonusBalance} R$` : `+100 R$`;
    const tgMsg2 =
      `🎁 У тебя бонус <b>${balanceStr}</b> — действует до <b>${expiresStr}</b>.\n\n` +
      `Он добавится к любому прямому заказу автоматически (без карточки WB).`;
    return {
      kind: "bonus_reminder",
      tgMsg1, vkMsg1, tgMsg2,
      vkMsg2: tgMsg2.replace(/<\/?b>/g, ""),
      buttons: [BTN_USE_BONUS],
    };
  }

  // 3. Повторный WB-клиент — TIER-2 питч закрытого формата (текст без изменений).
  if (!inp.isDirectOrder && inp.completedCount > 1) {
    const tgMsg2 =
      `Это уже твой <b>${inp.completedCount}-й</b> заказ в RobloxBank. Спасибо за доверие! 💛\n\n` +
      `Кстати, для постоянных клиентов у нас есть закрытый формат. Чтобы не ждать поставок на Wildberries и оформлять заказы по самому выгодному курсу (без лишних комиссий), пиши нам в поддержку напрямую: @RobloxBank_PA\n\n` +
      `Это <b>быстрее, проще и всегда выгоднее</b>. Мы закрепим за тобой персональное обслуживание.\n\n` +
      `Всё ли было удобно в этот раз? Если есть идеи по улучшению — напиши в поддержку, мы читаем каждое сообщение!`;
    const vkMsg2 = tgMsg2.replace(/<\/?b>/g, "").replace("@RobloxBank_PA", "https://t.me/RobloxBank_PA");
    return { kind: "tier2", tgMsg1, vkMsg1, tgMsg2, vkMsg2, buttons: [BTN_DIRECT] };
  }

  // 4. Прямой заказ / остальное — благодарность (+скидка для DIR <500).
  const tgMsg2 = inp.completedCount > 1
    ? `Это уже твой <b>${inp.completedCount}-й</b> заказ — спасибо за доверие! 💛${discountTg}\n\n` +
      `Всё ли было удобно? Напиши нам — мы читаем каждое сообщение.`
    : `Спасибо, что выбрал RobloxBank! Заказывай ещё — мы всегда здесь 💛${discountTg}`;
  const vkMsg2 = inp.completedCount > 1
    ? `Это уже твой ${inp.completedCount}-й заказ — спасибо за доверие! 💛${discountVk}\n\n` +
      `Всё ли было удобно? Напиши нам — мы читаем каждое сообщение.`
    : `Спасибо, что выбрал RobloxBank! Заказывай ещё — мы всегда здесь 💛${discountVk}`;
  return { kind: "thanks", tgMsg1, vkMsg1, tgMsg2, vkMsg2, buttons: [BTN_DIRECT] };
}

export async function notifyOrderCompleted(
  user: UserRef,
  orderId: string,
  amount: number,
  isDirectOrder: boolean
) {
  const [completedCount, order, dbUser] = await Promise.all([
    (prisma as any).wbOrder.count({ where: { userId: user.id, status: "COMPLETED" } }),
    (prisma as any).wbOrder.findUnique({ where: { id: orderId }, select: { wbCode: true, completedAt: true } }),
    (prisma as any).user.findUnique({ where: { id: user.id }, select: { balance: true, reviewBonusGrantedAt: true } }),
  ]);

  // Код этого заказа существует как WbCode и отзыв по нему ещё не оплачен
  // (отсекает AV-/DIR-/MN- псевдокоды — отзыв на WB там невозможен).
  const codeRow = order?.wbCode
    ? await (prisma as any).wbCode.findFirst({ where: { code: order.wbCode }, select: { reviewBonusClaimed: true } })
    : null;

  // Скидка 60 ₽ за DIR <500 — как в ботах (notifyUserCompleted); раньше
  // TWA-путь её не начислял и клиенты одного продукта получали разные условия.
  const discountGranted = isDirectOrder && amount < 500;
  if (discountGranted) {
    try {
      await (prisma as any).user.update({ where: { id: user.id }, data: { rubleDiscount: 60 } });
    } catch (err) {
      console.warn("[twa-notify] failed to set rubleDiscount:", err);
    }
  }

  const m = buildCompletedMessages({
    isDirectOrder,
    completedCount,
    completedAt: order?.completedAt ? new Date(order.completedAt) : new Date(),
    bonusGrantedAt: dbUser?.reviewBonusGrantedAt ? new Date(dbUser.reviewBonusGrantedAt) : null,
    bonusBalance: dbUser?.balance ?? 0,
    codeUnclaimed: codeRow ? codeRow.reviewBonusClaimed === false : false,
    discountGranted,
  });
  if (m.kind === "tier2") console.log(`[CRM] Direct pitch sent for order #${completedCount}`);

  if (user.tgId) {
    await tgPost(user.tgId, m.tgMsg1);
    await tgPost(user.tgId, m.tgMsg2, {
      reply_markup: { inline_keyboard: m.buttons.map((b) => [{ text: b.label, callback_data: b.command }]) },
    });
    // pendingReview (питч отзыва) восстановит сам бот: callback review_hint
    // и фолбэк в photo-handler работают без предустановленного состояния.
  } else if (user.vkId) {
    await vkPost(user.vkId, m.vkMsg1);
    const vkKb = JSON.stringify({
      inline: true,
      buttons: m.buttons.map((b) => [{
        action: { type: "text", label: b.label, payload: JSON.stringify({ command: b.command }) },
        color: b.command === "start_direct" ? "positive" : "primary",
      }]),
    });
    await vkPost(user.vkId, m.vkMsg2, { keyboard: vkKb });
  }
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
    const tgMsg = `${head}\n\nГеймпасс уже у нас — выкупим в ближайшее время и напишем, как будет готово 💛`;
    const vkMsg = tgMsg.replace(/<[^>]+>/g, "");
    if (user.tgId) return (await tgPost(user.tgId, tgMsg)) ? "tg" : null;
    if (user.vkId) return (await vkPost(user.vkId, vkMsg)) ? "vk" : null;
    return null;
  }

  const tgMsg = `${head}\n\nСоздай геймпасс за <b>${dirty} R$</b> и пришли ссылку сюда — выкупим и начислим робуксы 💛`;
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
    `🎉 <b>Похоже, твой геймпасс готов!</b>\n\n` +
    `Ник: <b>${escHtml(nick)}</b>\n` +
    `Геймпасс: <b>${escHtml(passName)}</b> · <b>${priceRobux} R$</b>\n\n` +
    `Это твой геймпасс? Подтверди — и мы сразу заберём его в выкуп 💛`;

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
      `🎉 Похоже, твой геймпасс готов!\n\nНик: ${nick}\nГеймпасс: ${passName} · ${priceRobux} R$\n\n` +
      `Это твой геймпасс? Подтверди — заберём его в выкуп 💛`,
      { keyboard: vkKb },
    );
    return ok ? "vk" : null;
  }
  return null;
}

/**
 * Менеджер вручную привязал геймпасс к заказу из TWA («Поиск и выкуп» → 📎).
 * Текст идентичен ботовскому «геймпасс принят», чтобы клиент не заметил разницы.
 * Возвращает канал реальной доставки — TWA показывает менеджеру честный статус.
 */
export async function notifyGamepassAttached(user: UserRef, wbCode: string): Promise<"tg" | "vk" | null> {
  // Без «номера заявки» — идентификатор для клиента всегда код ВБ
  // (номера заказов убраны из клиентских сообщений 2026-06-24, de7d7fd).
  const tgMsg =
    `🎉 Отлично, геймпасс принят!\n\n` +
    `⏳ Выкупим в течение нескольких часов — обычно быстрее. Как только будет готово — напишем.\n` +
    `💡 <i>Робуксы начислит Roblox — обычно в течение 5–7 дней после выкупа.</i>\n\n` +
    `Код ВБ: <code>${wbCode}</code> · Статус и бонусы — в меню`;
  const vkMsg = tgMsg.replace(/<[^>]+>/g, "");

  if (user.tgId) return (await tgPost(user.tgId, tgMsg)) ? "tg" : null;
  if (user.vkId) return (await vkPost(user.vkId, vkMsg)) ? "vk" : null;
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
      `1. Нажми на плейс → <b>Configure → Settings</b> → Audience → выбери <b>Public</b>\n` +
      `   Не помогло? <b>Configure → Questionnaire → Restart</b> → ответь «No» на 10 вопросов\n` +
      `2. Установи цену геймпасса: <b>${Math.ceil(amount / 0.7)} R$</b>\n` +
      `3. Отправь новую ссылку:`
    : `Чаще всего причина в одном из двух:\n` +
      `• Цена геймпасса неверная — нужно ${Math.ceil(amount / 0.7)} R$\n` +
      `• Геймпасс не выставлен на продажу\n\n` +
      `Исправь и отправь ссылку заново:`;

  // Идентификатор для клиента = код ВБ, не внутренний номер (C2, 2026-07-03).
  const tgMsg = `❌ <b>Заказ отклонён</b> (код <code>${wbCode}</code>)\n\n${reasonLine}${fixTg}`;
  const vkMsg = tgMsg.replace(/<\/?[bi]>/g, "").replace(/<\/?i>/g, "");

  if (user.tgId) await tgPost(user.tgId, tgMsg);
  else if (user.vkId) await vkPost(user.vkId, vkMsg);
}
