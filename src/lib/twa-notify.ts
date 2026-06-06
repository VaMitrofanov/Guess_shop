import { prisma } from "@/lib/prisma";

interface UserRef {
  id: string;
  tgId?: string | null;
  vkId?: string | null;
}

async function tgPost(chatId: string, text: string, extra: Record<string, unknown> = {}) {
  const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
  const payload   = { token: process.env.TG_TOKEN, chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra };

  if (bridgeUrl) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.VALIDATOR_KEY) headers["x-validator-key"] = process.env.VALIDATOR_KEY;
    await fetch(`${bridgeUrl}/tg-proxy`, { method: "POST", headers, body: JSON.stringify(payload) })
      .catch(e => console.warn("[twa-notify] bridge error:", e?.message));
    return;
  }

  await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(e => console.warn("[twa-notify] tg direct error:", e?.message));
}

async function vkPost(vkUserId: string, message: string) {
  const params = new URLSearchParams({
    user_id:      vkUserId,
    message,
    random_id:    String(Date.now() + Math.floor(Math.random() * 1000)),
    access_token: process.env.VK_TOKEN ?? "",
    v:            "5.131",
  });
  await fetch("https://api.vk.com/method/messages.send", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  }).catch(e => console.warn("[twa-notify] vk error:", e?.message));
}

export async function notifyOrderCompleted(
  user: UserRef,
  orderId: string,
  amount: number,
  isDirectOrder: boolean
) {
  const completedCount = await (prisma as any).wbOrder.count({
    where: { userId: user.id, status: "COMPLETED" },
  });
  const wbCompletedCount = isDirectOrder
    ? await (prisma as any).wbOrder.count({
        where: { userId: user.id, status: "COMPLETED", isDirectOrder: false },
      })
    : completedCount;

  const pendingLineTg  = `\n\n📊 Проверить зачисление: <a href="https://www.roblox.com/transactions">roblox.com/transactions</a> → строка <b>Pending</b>`;
  const pendingLineVk  = `\n\n📊 Проверить зачисление: https://www.roblox.com/transactions → строка Pending`;

  let tgMsg: string;
  let vkMsg: string;

  if (isDirectOrder) {
    if (completedCount <= 1) {
      tgMsg = `✅ <b>Заказ выкуплен!</b> Робуксы уже в пути 🚀\n\nRoblox зачислит их в течение 5–7 дней — это их стандартный процесс.` + pendingLineTg + `\n\nСпасибо, что выбрал RobloxBank! Заказывай ещё — мы всегда здесь 💛`;
    } else {
      tgMsg = `✅ Заказ выкуплен! Это уже твой <b>${completedCount}-й</b> заказ — спасибо за доверие! 💛\n\nРобуксы появятся в течение 5–7 дней.` + pendingLineTg + `\n\nВсё ли было удобно? Напиши нам — мы читаем каждое сообщение.`;
    }
    vkMsg = tgMsg.replace(/<\/?b>/g, "").replace(pendingLineTg, pendingLineVk).replace(/<a href="[^"]+">([^<]+)<\/a>/g, "$1");
  } else if (wbCompletedCount === 1) {
    tgMsg =
      `✅ <b>Заказ выкуплен!</b> Робуксы уже в пути 🚀\n\n` +
      `Roblox зачислит их в течение 5–7 дней — это их стандартный процесс.` +
      pendingLineTg + `\n\n` +
      `🎁 <b>Оставь отзыв и получи +100 R$ в подарок!</b>\n` +
      `Бонус применяется к прямому заказу от 1000 R$.\n` +
      `Напиши отзыв на Wildberries, сделай скриншот и отправь его сюда (фотографией, не файлом). После проверки бонус начислим сразу!`;
    vkMsg =
      `✅ Заказ выкуплен! Робуксы уже в пути 🚀\n\n` +
      `Roblox зачислит их в течение 5–7 дней — это их стандартный процесс.` +
      pendingLineVk + `\n\n` +
      `Оставь отзыв и получи +100 R$ в подарок!\n` +
      `Бонус применяется к прямому заказу от 1000 R$.\n` +
      `Напиши отзыв на Wildberries, сделай скриншот и отправь его в этот чат. После проверки бонус начислим сразу!`;
  } else {
    tgMsg =
      `✅ Заказ выкуплен! Это уже твой <b>${completedCount}-й</b> заказ в RobloxBank. Спасибо за доверие! 💛\n\n` +
      `Робуксы появятся в течение 5–7 дней.` +
      pendingLineTg + `\n\n` +
      `Кстати, для постоянных клиентов у нас есть закрытый формат. Чтобы не ждать поставок на Wildberries и оформлять заказы по самому выгодному курсу (без лишних комиссий), пиши нам в поддержку напрямую: @RobloxBank_PA\n\n` +
      `Это <b>быстрее, проще и всегда выгоднее</b>. Мы закрепим за тобой персональное обслуживание.\n\n` +
      `Всё ли было удобно в этот раз? Если есть идеи по улучшению — напиши в поддержку, мы читаем каждое сообщение!`;
    vkMsg =
      `✅ Заказ выкуплен! Это уже твой ${completedCount}-й заказ в RobloxBank. Спасибо за доверие! 💛\n\n` +
      `Робуксы появятся в течение 5–7 дней.` +
      pendingLineVk + `\n\n` +
      `Кстати, для постоянных клиентов у нас есть закрытый формат. Чтобы не ждать поставок на Wildberries и оформлять заказы по самому выгодному курсу (без лишних комиссий), пиши нам в поддержку напрямую: https://t.me/RobloxBank_PA\n\n` +
      `Это быстрее, проще и всегда выгоднее. Мы закрепим за тобой персональное обслуживание.\n\n` +
      `Всё ли было удобно в этот раз? Если есть идеи по улучшению — напиши в поддержку, мы читаем каждое сообщение!`;
  }

  if (user.tgId) await tgPost(user.tgId, tgMsg);
  else if (user.vkId) await vkPost(user.vkId, vkMsg);
}

export async function notifyOrderRejected(
  user: UserRef,
  orderId: string,
  reason: string,
  amount: number,
) {
  const shortId    = orderId.slice(-6).toUpperCase();
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

  const tgMsg = `❌ <b>Заказ отклонён</b> [${shortId}]\n\n${reasonLine}${fixTg}`;
  const vkMsg = tgMsg.replace(/<\/?[bi]>/g, "").replace(/<\/?i>/g, "");

  if (user.tgId) await tgPost(user.tgId, tgMsg);
  else if (user.vkId) await vkPost(user.vkId, vkMsg);
}
