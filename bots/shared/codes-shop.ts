/* ─────────────────────────────────────────────────────────────────────────────
   🎟 Коды Roblox и приглашения в ботах — один текст на TG, VK и Web (15.11.2026).

   Задача владельца: «механики сайта (рефералы, коды) — в ботах, эргономично,
   и навести порядок в продажах и витрине». Как устроено:

   - Витрина кодов — один экран: 8 номиналов кнопками «800 R$ · 989 ₽», хит и
     «выгоднее всего» помечены, личная скидка видна сразу.
   - Номинал → карточка заказа с ОДНОЙ главной кнопкой «Оплатить N ₽» (страница
     оплаты сайта, тот же Т-Банк и чек) и тихой «Платит родитель? — переслать».
   - После оплаты код приходит СЮДА ЖЕ, в чат (шлёт Web: ключ склада живёт в
     одном месте), и лежит в кабинете на сайте.
   - «Скидка за друзей» — уровень, шкала, ссылка и кнопка «Отправить другу».

   Модуль чистый: ни базы, ни сети. HTML — для TG, `plain` — для VK.
   ───────────────────────────────────────────────────────────────────────── */

import {
  CODE_DENOMINATIONS,
  CODE_DISCOUNT_TIERS,
  CODE_PRICES,
  codeDiscountProgress,
  formatRubKopecks,
  quoteCode,
} from "./codes-pricing";

export const ROBLOX_REDEEM_LINK = "https://www.roblox.com/redeem";

/** Callback/payload-команды. Короткие: у TG лимит callback_data 64 байта. */
export const CODES_CB = {
  open: "codes",
  invite: "codes_inv",
  pick: (denomination: number) => `codes_p:${denomination}`,
  back: "codes",
  myCodes: "codes_my",
  /** «Я подписался» — перепроверить подписку на канал (скидка 1 %). */
  subscribed: "codes_sub",
} as const;

export const CODES_PICK_RE = /^codes_p:(\d{3,5})$/;

/** Префикс deep-link приглашения: `t.me/<бот>?start=r_<код>`, `vk.me/<группа>?ref=r_<код>`. */
export const REFERRAL_START_PREFIX = "r_";

export function parseReferralStart(payload: string | null | undefined): string | null {
  const value = (payload ?? "").trim();
  if (!value.toLowerCase().startsWith(REFERRAL_START_PREFIX)) return null;
  const code = value.slice(REFERRAL_START_PREFIX.length).toLowerCase();
  return /^[a-z0-9]{6,12}$/.test(code) ? code : null;
}

/** Номинал «ХИТ» (решение владельца 14.11: код 800, геймпасс 1 000) — настройка, не литерал. */
export function codesHitDenomination(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.CODES_HIT_DENOMINATION);
  return CODE_DENOMINATIONS.includes(value) ? value : 800;
}

export function gamepassHitAmount(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.GAMEPASS_HIT_AMOUNT);
  return Number.isInteger(value) && value >= 100 ? value : 1000;
}

/** Пакет с самой низкой ценой за 1 R$ при данной скидке. */
export function bestValueDenomination(discountPercent: number): number {
  let best = CODE_DENOMINATIONS[0];
  let bestRate = Infinity;
  for (const denomination of CODE_DENOMINATIONS) {
    const rate = quoteCode(denomination, discountPercent).finalAmountKopecks / denomination;
    if (rate < bestRate) { best = denomination; bestRate = rate; }
  }
  return best;
}

function robux(amount: number): string {
  return amount.toLocaleString("ru-RU").replace(/\u00a0/g, " ");
}

/** «на 1 000 R$ — 1 188 ₽», только целые рубли. */
function rub(kopecks: number): string {
  return formatRubKopecks(kopecks).replace(/ /g, " ");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export interface CodesViewer {
  discountPercent: number;
  /** 🎁 Подарочная скидка от нас (19.11.2026); >0 — она и дала `discountPercent`. */
  giftPercent?: number;
  invitedCount: number;
  /** Продажа открыта (флаг сервера). */
  salesOpen: boolean;
  /** Код уходит сам в момент оплаты (склад) или готовится вручную. */
  instant: boolean;
  /** Подписан на канал/группу (условие скидки 1 %); undefined — не знаем. */
  subscribed?: boolean;
  /** Куда подписываться: TG-канал для TG, группа для ВК. */
  channelUrl?: string;
}

export interface CodesButton {
  label: string;
  /** callback_data / payload.command. */
  command?: string;
  url?: string;
  /** VK-цвет и признак главной кнопки ряда. */
  primary?: boolean;
}

export interface CodesScreen {
  html: string;
  plain: string;
  rows: CodesButton[][];
}

/** Витрина: 8 номиналов по два в ряд + «Подарок» и «Скидка за друзей». 5 рядов × 2 = 10 кнопок (лимит VK). */
export function codesStoreScreen(viewer: CodesViewer, siteUrl: string): CodesScreen {
  const hit = codesHitDenomination();
  const best = bestValueDenomination(viewer.discountPercent);
  const lines: string[] = [];
  lines.push("🎟 <b>Коды Roblox — Robux сразу на баланс</b>");
  lines.push("");
  lines.push(viewer.instant
    ? "Оплатили → код пришёл сюда в чат → ввели на roblox.com/redeem. Никаких геймпассов и ожидания."
    : "Оплатили → пришлём код сюда в чат → ввели на roblox.com/redeem. Никаких геймпассов.");
  lines.push("🔒 Пароль от Roblox не нужен.");
  lines.push("");
  const progress = codeDiscountProgress(viewer.invitedCount);
  const needsSubscribe = viewer.subscribed === false && viewer.discountPercent === 0 && Boolean(viewer.channelUrl);
  lines.push((viewer.giftPercent ?? 0) > 0
    ? `🎁 <b>Подарок: −${viewer.giftPercent}% на один код</b> — уже в ценах ниже. Спишется только после оплаты.`
    : viewer.discountPercent > 0
    ? `💜 Ваша скидка <b>${viewer.discountPercent}%</b> — уже в ценах ниже${progress.next ? ` · до ${progress.next.percent}% — ещё ${progress.next.remaining} ${friendsWord(progress.next.remaining)}` : ""}`
    : needsSubscribe
      ? "📢 <b>Подпишитесь на наш канал — и скидка 1% на все коды</b>, навсегда. Розыгрыши кодов — тоже там."
      : "💜 Цены ниже — без скидки");
  if (!viewer.salesOpen) {
    lines.push("");
    lines.push("⏳ Продажа кодов откроется совсем скоро — цены уже здесь.");
  }
  lines.push("");
  lines.push("Выберите номинал 👇");

  const rows: CodesButton[][] = [];
  for (let index = 0; index < CODE_DENOMINATIONS.length; index += 2) {
    rows.push(CODE_DENOMINATIONS.slice(index, index + 2).map((denomination) => {
      const price = quoteCode(denomination, viewer.discountPercent).finalAmountKopecks;
      const mark = denomination === hit ? " 🔥" : denomination === best ? " 💎" : "";
      return {
        label: `${robux(denomination)} R$ · ${rub(price)}${mark}`,
        command: CODES_CB.pick(denomination),
        primary: denomination === hit,
      };
    }));
  }
  rows.push(needsSubscribe
    ? [
        { label: "📢 Подписаться", url: viewer.channelUrl! },
        { label: "✅ Я подписался", command: CODES_CB.subscribed, primary: true },
      ]
    : [
        { label: "🎁 В подарок", url: `${siteUrl}/?gift=1#codes` },
        { label: "🤝 Скидка до 5%", command: CODES_CB.invite },
      ]);
  const html = lines.join("\n");
  return { html, plain: stripTags(html).trim(), rows };
}

function friendsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "друг";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "друга";
  return "друзей";
}

/** Карточка выбранного номинала до создания заказа. */
export function codePickScreen(input: {
  denomination: number;
  discountPercent: number;
  /** Цену дал подарок — так и пишем, а не «ваша скидка». */
  giftApplied?: boolean;
  instant: boolean;
  payUrl: string;
  shareUrl: string;
  publicId: string;
}): CodesScreen {
  const quote = quoteCode(input.denomination, input.discountPercent);
  const lines: string[] = [];
  lines.push(`🎟 <b>Код на ${robux(input.denomination)} Robux</b>`);
  lines.push("");
  lines.push(quote.discountPercent > 0
    ? `💳 К оплате: <s>${rub(quote.baseAmountKopecks)}</s> <b>${rub(quote.finalAmountKopecks)}</b> · ${input.giftApplied ? "🎁 подарок" : "ваша скидка"} ${quote.discountPercent}%`
    : `💳 К оплате: <b>${rub(quote.finalAmountKopecks)}</b>`);
  lines.push(input.instant
    ? "📩 Код придёт сюда, в чат, сразу после оплаты — и сохранится в кабинете на сайте."
    : "📩 Код пришлём сюда, в чат, после оплаты — и сохраним в кабинете на сайте.");
  lines.push("🧾 Картой или СБП на странице Т-Банка · чек на почту");
  lines.push("");
  lines.push(`<i>Платит родитель? Перешлите ему ссылку — он оплатит без входа, а код придёт вам.</i>`);
  const html = lines.join("\n");
  const shareText = `Оплати, пожалуйста, код Roblox на ${robux(input.denomination)} Robux — ${rub(quote.finalAmountKopecks)}. Вход не нужен:`;
  return {
    html,
    plain: stripTags(html),
    rows: [
      [{ label: `💳 Оплатить ${rub(quote.finalAmountKopecks)}`, url: input.payUrl, primary: true }],
      [{ label: "👨‍👩‍👧 Переслать родителю", url: `https://t.me/share/url?url=${encodeURIComponent(input.shareUrl)}&text=${encodeURIComponent(shareText)}` }],
      [{ label: "◀️ Другой номинал", command: CODES_CB.back }],
    ],
  };
}

export interface InviteViewer {
  invitedCount: number;
  discountPercent: number;
  siteLink: string;
  botLink: string | null;
}

/** Шкала из пяти делений: ▰▰▱▱▱. */
export function tierBar(percent: number): string {
  const max = CODE_DISCOUNT_TIERS[CODE_DISCOUNT_TIERS.length - 1].percent;
  return "▰".repeat(Math.max(0, Math.min(max, percent))) + "▱".repeat(Math.max(0, max - percent));
}

export function inviteScreen(viewer: InviteViewer): CodesScreen {
  const progress = codeDiscountProgress(viewer.invitedCount);
  const lines: string[] = [];
  lines.push("🤝 <b>Зовите друзей — скидка на коды растёт</b>");
  lines.push("");
  lines.push(`Сейчас: <b>${viewer.discountPercent}%</b> ${tierBar(viewer.discountPercent)} · засчитано ${viewer.invitedCount} ${friendsWord(viewer.invitedCount)}`);
  lines.push(progress.next
    ? `До <b>${progress.next.percent}%</b> — ещё ${progress.next.remaining} ${friendsWord(progress.next.remaining)}`
    : "🏆 У вас максимальная скидка — спасибо!");
  lines.push("");
  lines.push(CODE_DISCOUNT_TIERS.map((tier) => (tier.invited === 0 ? `${tier.percent}% сразу` : `${tier.percent}% — ${tier.invited}`)).join(" · "));
  lines.push("");
  lines.push("Друг засчитывается, когда купит код по вашей ссылке. Скидка остаётся навсегда и действует на коды — здесь и на сайте.");
  lines.push("");
  lines.push(`🔗 Ваша ссылка: ${viewer.siteLink}`);
  const shareText = "Robux кодом — сразу на баланс, без геймпассов. Держите ссылку:";
  const rows: CodesButton[][] = [
    [{ label: "📤 Отправить другу", url: `https://t.me/share/url?url=${encodeURIComponent(viewer.siteLink)}&text=${encodeURIComponent(shareText)}`, primary: true }],
  ];
  if (viewer.botLink) {
    rows.push([{ label: "🤖 Ссылка на бота", url: `https://t.me/share/url?url=${encodeURIComponent(viewer.botLink)}&text=${encodeURIComponent(shareText)}` }]);
  }
  rows.push([{ label: "🎟 Купить код", command: CODES_CB.open }]);
  const html = lines.join("\n");
  return { html, plain: stripTags(html), rows };
}

/** VK не знает t.me/share: там ссылкой делятся пересылкой — кнопки «Отправить» превращаются в открытие ссылки. */
export function vkShareFallback(rows: CodesButton[][], siteLink: string): CodesButton[][] {
  return rows.map((row) => row.map((button) => (button.url?.startsWith("https://t.me/share/") ? { ...button, url: siteLink } : button)));
}

// ─── Сообщения после оплаты (шлёт Web, `src/lib/codes/chat-notify.ts`) ───────

/**
 * 🎉 Код в чат (З1, 18.11.2026): подпись к картинке-билету (≤ 1024 символов).
 * Код — под спойлером (не подсмотрят из-за плеча), скопировать — кнопкой
 * «📋 Скопировать код» (`copyButton`). ВК спойлеров не умеет — там код текстом.
 */
export function codeChatIssuedText(input: { denomination: number; code: string; publicId: string }): { html: string; plain: string } {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const amount = robux(input.denomination);
  const html = [
    `🎉 <b>Код на ${amount} Robux готов!</b>`,
    "Коснитесь, чтобы показать:",
    `<tg-spoiler><code>${escape(input.code)}</code></tg-spoiler>`,
    "",
    "Откройте roblox.com/redeem (кнопка ниже), войдите в аккаунт, куда нужны Robux, и вставьте код.",
    "",
    "Код сохранён и в кабинете на сайте. Никому его не показывайте: кто ввёл, тот и получил Robux.",
  ].join("\n");
  const plain = [
    `🎉 Код на ${amount} Robux готов!`,
    "",
    input.code,
    "",
    "Откройте roblox.com/redeem (кнопка ниже), войдите в аккаунт, куда нужны Robux, и вставьте код.",
    "",
    "Код сохранён и в кабинете на сайте. Никому его не показывайте: кто ввёл, тот и получил Robux.",
  ].join("\n");
  return { html, plain };
}

/** Ручная выдача (З2): подпись к картинке «Готовим ваш код». Код придёт сюда же. */
export function codeChatPaidText(input: { denomination: number; publicId: string }): { html: string; plain: string } {
  const html = [
    "✅ <b>Оплата прошла — спасибо!</b>",
    "✅ Оплата → ⏳ Готовим код → ○ Код у вас",
    "",
    `Код на <b>${robux(input.denomination)} Robux</b> придёт сюда, в этот чат. Ничего делать не нужно.`,
    "",
    "Вопросы — @RobloxBank_PA",
  ].join("\n");
  return { html, plain: stripTags(html) };
}

/** Строка про коды для меню покупателя (`buyer-menu.ts`). */
export const CODES_MENU_LINE = "🎟 <b>Код Roblox</b> — Robux сразу на баланс, без геймпасса · скидка до 5% за друзей";

/** Подписи кнопок нижнего меню TG. */
export const CODES_MENU_BTN = {
  // Было «🎟 Код Robux — сразу»: при ручной выдаче (CODES_BACKORDER) читалось
  // как «код придёт сразу», а он приходил спустя часы (16.11.2026).
  codes: "🎟 Код Robux",
  invite: "🤝 Скидка за друзей",
} as const;

/** Старые подписи — у людей остаётся прежняя клавиатура, нажатие должно работать. */
export const CODES_MENU_BTN_LEGACY = ["🎟 Код Robux — сразу"] as const;

export { CODE_PRICES };
