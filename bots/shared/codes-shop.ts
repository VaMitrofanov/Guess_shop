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
  CODE_REGION_NOTES,
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
  /** «👁 Показать код» под запечатанным кодом в чате (21.11.2026). */
  reveal: (publicId: string) => `codes_rv:${publicId}`,
} as const;

export const CODES_PICK_RE = /^codes_p:(\d{2,5})$/;
export const CODES_REVEAL_RE = /^codes_rv:(CODE-[A-Z0-9]{8})$/;

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

/**
 * ВК: inline-клавиатура — не больше 10 кнопок (`project_vk_keyboard_limits`).
 * 12 номиналов + 2 действия туда не влезают — в ВК кнопками 8 ходовых, а
 * остальные (10, 50, 2 000, 5 250) перечислены текстом со ссылкой на сайт.
 */
export const CODES_VK_DENOMINATIONS: readonly number[] = Object.freeze([100, 199, 500, 800, 1000, 2500, 4500, 10000]);

/** Пакет с самой низкой ценой за 1 R$ при данной скидке. */
export function bestValueDenomination(discountPercent: number, usdRub?: number, among: readonly number[] = CODE_DENOMINATIONS): number {
  let best = among[0];
  let bestRate = Infinity;
  for (const denomination of among) {
    const rate = quoteCode(denomination, discountPercent, usdRub).finalAmountKopecks / denomination;
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
  /** Курс ₽/$ для цен (из Web); нет — опорный прайс. */
  usdRub?: number;
  /** Номиналы, временно убранные из продажи. */
  unavailable?: ReadonlySet<number>;
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

/**
 * Витрина: номиналы по два в ряд + «Подарок» и «Скидка за друзей». В TG — все
 * 12; в ВК (`platform: "VK"`) — 8 ходовых, чтобы уложиться в 10 кнопок, а
 * остальные — строкой текста.
 */
export function codesStoreScreen(viewer: CodesViewer, siteUrl: string, platform: "TG" | "VK" = "TG"): CodesScreen {
  const hit = codesHitDenomination();
  const shown = platform === "VK" ? CODES_VK_DENOMINATIONS : CODE_DENOMINATIONS;
  const best = bestValueDenomination(viewer.discountPercent, viewer.usdRub, shown);
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
  const hidden = CODE_DENOMINATIONS.filter((denomination) => !shown.includes(denomination));
  if (hidden.length) {
    lines.push("");
    lines.push(`Ещё ${hidden.map((denomination) => `${robux(denomination)} R$ — ${rub(quoteCode(denomination, viewer.discountPercent, viewer.usdRub).finalAmountKopecks)}`).join(" · ")} — на сайте: ${siteUrl}/#codes`);
  }
  lines.push("");
  lines.push("Выберите номинал 👇");

  const rows: CodesButton[][] = [];
  const out = viewer.unavailable ?? new Set<number>();
  for (let index = 0; index < shown.length; index += 2) {
    rows.push(shown.slice(index, index + 2).map((denomination) => {
      if (out.has(denomination)) {
        return { label: `${robux(denomination)} R$ · нет`, command: CODES_CB.pick(denomination) };
      }
      const price = quoteCode(denomination, viewer.discountPercent, viewer.usdRub).finalAmountKopecks;
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
  /** Суммы из созданного заказа — их и спишет банк (курс мог сдвинуться). */
  baseAmountKopecks?: number;
  finalAmountKopecks?: number;
  /** Цену дал подарок — так и пишем, а не «ваша скидка». */
  giftApplied?: boolean;
  instant: boolean;
  payUrl: string;
  shareUrl: string;
  publicId: string;
}): CodesScreen {
  const computed = quoteCode(input.denomination, input.discountPercent);
  const quote = {
    discountPercent: input.discountPercent,
    baseAmountKopecks: input.baseAmountKopecks ?? computed.baseAmountKopecks,
    finalAmountKopecks: input.finalAmountKopecks ?? computed.finalAmountKopecks,
  };
  const lines: string[] = [];
  lines.push(`🎟 <b>Код на ${robux(input.denomination)} Robux</b>`);
  if (CODE_REGION_NOTES[input.denomination]) lines.push(`<i>${CODE_REGION_NOTES[input.denomination]}</i>`);
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
export function codeChatIssuedText(input: { denomination: number; code: string; publicId: string; codes?: readonly string[]; opened?: boolean }): { html: string; plain: string } {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const amount = robux(input.denomination);
  const codes = input.codes?.length ? input.codes : [input.code];
  // Набор (2 000 = 2 × 1 000, 20.11.2026): каждый код вводится отдельно.
  const several = codes.length > 1;
  const part = several ? robux(Math.round(input.denomination / codes.length)) : amount;
  const tail = [
    "",
    several
      ? `Откройте roblox.com/redeem (кнопка ниже), войдите в аккаунт, куда нужны Robux, и введите коды по очереди — каждый на ${part} Robux.`
      : "Откройте roblox.com/redeem (кнопка ниже), войдите в аккаунт, куда нужны Robux, и вставьте код.",
    "",
    several
      ? "Коды сохранены и в кабинете на сайте. Никому их не показывайте: кто ввёл, тот и получил Robux."
      : "Код сохранён и в кабинете на сайте. Никому его не показывайте: кто ввёл, тот и получил Robux.",
  ];
  // `opened` — код открыт кнопкой «👁 Показать код» (21.11.2026): второй
  // спойлер поверх уже открытого конверта был бы лишним шагом.
  const html = input.opened
    ? [
        several ? `🔓 <b>Ваши коды на ${amount} Robux</b>` : `🔓 <b>Ваш код на ${amount} Robux</b>`,
        "",
        ...codes.map((code, index) => `${several ? `${index + 1}. ` : "👉 "}<code>${escape(code)}</code>`),
        "",
        several ? "Нажмите на код — он скопируется." : "Нажмите на код — он скопируется.",
        ...tail,
      ].join("\n")
    : [
        several ? `🎉 <b>${codes.length} кода на ${amount} Robux готовы!</b>` : `🎉 <b>Код на ${amount} Robux готов!</b>`,
        "Коснитесь, чтобы показать:",
        ...codes.map((code, index) => `${several ? `${index + 1}. ` : ""}<tg-spoiler><code>${escape(code)}</code></tg-spoiler>`),
        ...tail,
      ].join("\n");
  const plain = [
    input.opened
      ? (several ? `🔓 Ваши коды на ${amount} Robux:` : `🔓 Ваш код на ${amount} Robux:`)
      : (several ? `🎉 ${codes.length} кода на ${amount} Robux готовы!` : `🎉 Код на ${amount} Robux готов!`),
    "",
    ...codes.map((code, index) => `${several ? `${index + 1}. ` : ""}${code}`),
    ...tail,
  ].join("\n");
  return { html, plain };
}

/**
 * Код в чате — запечатанный (21.11.2026). Значение не приходит в сообщении:
 * его открывает кнопка «👁 Показать код», и этот момент видят админы (спор
 * «код не работает» без него не разобрать). Для покупателя это «конверт»:
 * код ждёт, пока он будет готов ввести, и не светится в превью уведомления.
 */
export function codeChatSealedText(input: { denomination: number; publicId: string; count?: number }): { html: string; plain: string } {
  const amount = robux(input.denomination);
  const several = (input.count ?? 1) > 1;
  const head = several ? `${input.count} кода на ${amount} Robux готовы!` : `Код на ${amount} Robux готов!`;
  const steps = [
    `1. Нажмите «👁 Показать ${several ? "коды" : "код"}»`,
    "2. «🚀 Активировать на Roblox» → войдите в аккаунт, куда нужны Robux",
    several ? "3. Введите коды по очереди — и Robux на балансе 🎉" : "3. Вставьте код — и Robux на балансе 🎉",
  ];
  const html = [
    `🎉 <b>${head}</b>`,
    `🔒 ${several ? "Коды запечатаны" : "Код запечатан"} и ${several ? "ждут" : "ждёт"} вас — откройте, когда будете готовы ввести.`,
    "",
    "<b>Как получить Robux:</b>",
    ...steps,
    "",
    `<i>${several ? "Коды сохранены" : "Код сохранён"} и в кабинете на сайте. Никому не показывайте: кто ввёл, тот и получил Robux.</i>`,
  ].join("\n");
  const plain = [
    `🎉 ${head}`,
    `🔒 ${several ? "Коды запечатаны" : "Код запечатан"} и ${several ? "ждут" : "ждёт"} вас — откройте, когда будете готовы ввести.`,
    "",
    "Как получить Robux:",
    ...steps,
    "",
    `${several ? "Коды сохранены" : "Код сохранён"} и в кабинете на сайте. Никому не показывайте: кто ввёл, тот и получил Robux.`,
  ].join("\n");
  return { html, plain };
}

/** Кнопки под кодом в TG: запечатан — «Показать»; открыт — «Скопировать». */
export function codeChatTgKeyboard(input: { publicId: string; codes?: readonly string[]; count?: number }) {
  const codes = input.codes ?? [];
  const several = (codes.length || input.count || 1) > 1;
  const top = codes.length
    ? codes.map((code, index) => [{ text: codes.length > 1 ? `📋 Скопировать код ${index + 1}` : "📋 Скопировать код", copy_text: { text: code.slice(0, 256) } }])
    : [[{ text: several ? "👁 Показать коды" : "👁 Показать код", callback_data: CODES_CB.reveal(input.publicId) }]];
  return {
    inline_keyboard: [
      ...top,
      [{ text: "🚀 Активировать на Roblox", url: ROBLOX_REDEEM_LINK }],
      [{ text: "🤝 Скидка за друзей", callback_data: CODES_CB.invite }, { text: "🎟 Ещё код", callback_data: CODES_CB.open }],
    ],
  };
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
