/* ─────────────────────────────────────────────────────────────────────────────
   Меню покупателя — один текст на TG и VK.

   Замечание владельца 18.10.2026: «с меню пользователя тоже поработать,
   расширить (но не путать), сделать более наглядным, добавить инфу по заказу
   (потому что сейчас одна строчка „выполнен“, она теряется, не особо видно)».

   Как было: `buildBuyerMenu` (TG) и `sendVkBuyerMenu` (VK) — две независимые
   копии одного экрана, и про заказ там было ровно две строки:

       📦 1000 R$ · ⌛ Ожидаем геймпасс
       ✅ Последний выполненный: 1000 R$ · 12.10.2026

   Всё остальное — что держит заказ, что нужно от человека, когда придут
   робуксы — жило в карточке «📦 Мой заказ», куда надо догадаться нажать.

   Что экран обязан отвечать теперь, тремя ярусами и без простыни:

   1. кто я и что мне причитается (статус клиента, бонусы);
   2. ЧТО С ЗАКАЗОМ и **что от меня нужно** — строка «От тебя» словами
      действия; подробно показывается ОДИН заказ (самый свежий), остальные
      уходят в кнопку (решение владельца О4);
   3. что уже готово — отдельным блоком, с датой выхода робуксов из Pending:
      это вопрос №1 после выкупа.

   Модуль чистый: ни базы, ни сети. Текст собирается в HTML (его ждёт TG), VK
   получает тот же текст через `stripHtml` — то же правило, что у
   кросс-платформенных уведомлений.
   ───────────────────────────────────────────────────────────────────────── */

import { expectedGamepassPrice } from "./gamepass-plan";
import { fmtDateRu, robuxUnlockDate } from "./completed-messages";

export interface BuyerMenuOrder {
  amount: number;
  status: string;
  wbCode?: string | null;
  isDirectOrder?: boolean | null;
  createdAt: Date | string;
  completedAt?: Date | string | null;
  robloxUsername?: string | null;
  probableNick?: string | null;
  gamepassUrl?: string | null;
  rejectionReason?: string | null;
}

export interface BuyerMenuInput {
  /** Ник Roblox из профиля покупателя (не из заказа). */
  nick?: string | null;
  /** Имя из мессенджера — когда ника ещё нет. */
  firstName?: string | null;
  orderCount: number;
  isReturning: boolean;
  /** Действующий бонус; `0` — нет или просрочен. */
  bonus?: number;
  bonusExpiresAt?: Date | null;
  rubleDiscount?: number;
  /** Живые заказы, свежие сверху. */
  active: BuyerMenuOrder[];
  lastCompleted?: BuyerMenuOrder | null;
  now?: Date;
}

export interface BuyerMenuText {
  /** HTML для TG; VK получает его через `stripHtml`. */
  text: string;
  /** Сколько заказов спрятано за кнопкой «Другие заказы». */
  othersCount: number;
  /** Заказ, который показан подробно, — к нему относятся кнопки экрана. */
  focus: BuyerMenuOrder | null;
}

const DAY_MS = 86_400_000;

function plural(value: number, forms: [string, string, string]): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/** Возраст человеческими словами — без светофора, он для админов. */
export function humanAge(from: Date | string, now: Date | number = Date.now()): string {
  const fromMs = new Date(from).getTime();
  const nowMs = now instanceof Date ? now.getTime() : now;
  const diff = Math.max(0, (Number.isFinite(fromMs) ? nowMs - fromMs : 0));
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 5) return "только что";
  if (minutes < 60) return `${minutes} ${plural(minutes, ["минуту", "минуты", "минут"])} назад`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours} ${plural(hours, ["час", "часа", "часов"])} назад`;
  const days = Math.floor(diff / DAY_MS);
  return `${days} ${plural(days, ["день", "дня", "дней"])} назад`;
}

/** Статус словами покупателя — ровно те же ярлыки, что были в обоих ботах. */
const STATUS_WORD: Record<string, string> = {
  AWAITING_PAYMENT: "⏳ Готовим реквизиты",
  PAYMENT_PENDING: "💳 Ждём оплату",
  AWAITING_GAMEPASS: "⌛ Ждём геймпасс",
  PENDING: "⏳ В очереди на выкуп",
  IN_PROGRESS: "🔧 Выкупаем",
  COMPLETED: "✅ Выкуплен",
  REJECTED: "❌ Отклонён",
  ERROR: "⏳ Разбираемся",
};

/**
 * «От тебя» — единственное, чего мы ждём от человека, словами действия.
 *
 * Самая нужная строка экрана: до неё покупатель видел статус («Ожидаем
 * геймпасс») и должен был сам догадаться, что это его ход.
 */
export function nextStepLine(order: BuyerMenuOrder): string {
  const nick = order.robloxUsername ?? order.probableNick ?? null;
  switch (order.status) {
    case "AWAITING_GAMEPASS": {
      const price = expectedGamepassPrice(order.amount);
      return nick
        ? `👉 <b>От тебя:</b> создать геймпасс на <b>${price} R$</b> и прислать ссылку`
        : `👉 <b>От тебя:</b> прислать ник Roblox — найдём твои геймпассы и скажем, что создать`;
    }
    case "PAYMENT_PENDING":
      return "👉 <b>От тебя:</b> оплатить заказ по реквизитам из чата";
    case "AWAITING_PAYMENT":
      return "⏳ <b>От тебя:</b> ничего — пришлём реквизиты сюда";
    case "PENDING":
    case "IN_PROGRESS":
      return "✅ <b>От тебя:</b> ничего — выкупаем и сразу напишем";
    case "ERROR":
      return "✅ <b>От тебя:</b> ничего — разбираемся сами, напишем";
    case "REJECTED":
      return "👉 <b>От тебя:</b> прислать новый геймпасс — заказ ждёт";
    default:
      return "✅ <b>От тебя:</b> ничего";
  }
}

/** Код ВБ — идентификатор САМОГО покупателя, в отличие от номера заказа. */
function codeLine(order: BuyerMenuOrder): string | null {
  const code = order.wbCode ?? "";
  if (!code || code.startsWith("DIR-") || order.isDirectOrder) return null;
  return `🔑 Код ВБ: <code>${code}</code>`;
}

export function buildBuyerMenuText(input: BuyerMenuInput): BuyerMenuText {
  const now = input.now ?? new Date();
  const nick = input.nick?.trim() || null;
  const tier = input.orderCount >= 5 ? "👑 VIP-клиент" : input.isReturning ? "💛 Постоянный клиент" : "🌱 Новый клиент";

  const lines: string[] = [];
  lines.push(nick
    ? `🎮 <b>RobloxBank</b> · ${nick}`
    : `👤 <b>Твоё меню</b>${input.firstName ? `, ${input.firstName}` : ""} · RobloxBank`);
  lines.push("");

  const perks: string[] = [];
  if ((input.bonus ?? 0) > 0) {
    const until = input.bonusExpiresAt ? ` (до ${fmtDateRu(input.bonusExpiresAt)})` : "";
    perks.push(`🎁 ${input.bonus} R$${until}`);
  }
  if ((input.rubleDiscount ?? 0) > 0) perks.push(`💰 Скидка ${input.rubleDiscount} ₽`);
  const orders = input.orderCount > 0
    ? `${input.orderCount} ${plural(input.orderCount, ["заказ", "заказа", "заказов"])}`
    : "первый заказ";
  lines.push([tier, orders, ...perks].join(" · "));

  // ── Ярус 2: твой заказ ────────────────────────────────────────────────────
  const focus = input.active[0] ?? null;
  const othersCount = Math.max(0, input.active.length - 1);
  if (focus) {
    lines.push("");
    lines.push("━━ <b>ТВОЙ ЗАКАЗ</b> ━━");
    lines.push(`📦 <b>${focus.amount} R$</b> · ${STATUS_WORD[focus.status] ?? focus.status} · создан ${humanAge(focus.createdAt, now)}`);
    const code = codeLine(focus);
    if (code) lines.push(code);
    if (focus.status === "REJECTED" && focus.rejectionReason) lines.push(`💬 Причина: ${focus.rejectionReason}`);
    lines.push(nextStepLine(focus));
    // Ключ — самый быстрый путь, и именно его люди не знают: он закрывает
    // заказ без ручной возни с ценой пасса.
    if (focus.status === "AWAITING_GAMEPASS") {
      lines.push("💡 Не хочешь возиться — пришли ключ Roblox, создадим пасс сами");
    }
    if (othersCount > 0) {
      lines.push("");
      lines.push(`📦 Ещё ${othersCount} ${plural(othersCount, ["заказ", "заказа", "заказов"])} — кнопка «Другие заказы» ниже`);
    }
  }

  // ── Ярус 3: что уже готово ────────────────────────────────────────────────
  const done = input.lastCompleted;
  if (done) {
    lines.push("");
    lines.push("━━ <b>ГОТОВО</b> ━━");
    const when = done.completedAt ?? done.createdAt;
    lines.push(`✅ ${fmtDateRu(new Date(when))} · <b>${done.amount} R$</b> — выкуплен`);
    if (done.completedAt) {
      const unlock = robuxUnlockDate(new Date(done.completedAt));
      lines.push(unlock.getTime() > now.getTime()
        ? `💎 Робуксы выйдут из Pending <b>${fmtDateRu(unlock)}</b> — Roblox держит их 5 дней`
        : `💎 Робуксы разблокированы ${fmtDateRu(unlock)} — проверь раздел Transactions`);
    }
  }

  lines.push("");
  lines.push(nick && !focus
    ? `💎 Ещё робуксы <b>напрямую</b> на <b>${nick}</b> — без карты WB, быстрее и выгоднее 👇`
    : `💎 Робуксы <b>напрямую</b> — без карты WB, быстрее и выгоднее 👇`);

  return { text: lines.join("\n"), othersCount, focus };
}
