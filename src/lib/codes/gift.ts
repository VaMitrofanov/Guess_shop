import crypto from "node:crypto";

/**
 * 🎁 Подарок кодом открыткой (витрина 2.0, 15.11.2026).
 *
 * Отличается от обычного заказа только доставкой: оплата и выдача кода — те же.
 * Письмо получателю — открытка с номиналом и пожеланием; САМ КОД в письме не
 * виден, он открывается по ссылке «Открыть подарок» (`/gift/<токен>`). Токен
 * выводится из id заказа и серверного секрета, в базе — только его sha256.
 *
 * Пожелание — до 140 символов и БЕЗ ССЫЛОК: письмо уходит с нашего домена на
 * чужой адрес, и без запрета оно стало бы бесплатным каналом для мошенников
 * («открой подарок по ссылке …»).
 */

export const GIFT_THEMES = ["BIRTHDAY", "NEW_YEAR", "JUST"] as const;
export type GiftTheme = (typeof GIFT_THEMES)[number];

export const GIFT_MESSAGE_MAX = 140;
export const GIFT_NAME_MAX = 40;
/** Дальше двух месяцев отложенную отправку не принимаем. */
export const GIFT_SCHEDULE_MAX_MS = 62 * 24 * 60 * 60 * 1000;

export const GIFT_THEME_META: Record<GiftTheme, {
  label: string;
  greeting: (to: string | null) => string;
  tagline: string;
  /** Цвета письма: шапка (градиент), кнопка, плашка пожелания. */
  from: string;
  to: string;
  button: string;
  note: string;
  ink: string;
  image: string;
}> = {
  BIRTHDAY: {
    label: "День рождения",
    greeting: (to) => (to ? `${to}, с днём рождения!` : "С днём рождения!"),
    tagline: "Robux в подарок",
    from: "#ff6aa8",
    to: "#7556e8",
    button: "#ff4f97",
    note: "#fff3f8",
    ink: "#ffe6a6",
    image: "/gifts/birthday.png",
  },
  NEW_YEAR: {
    label: "Новый год",
    greeting: (to) => (to ? `С Новым годом, ${to}!` : "С Новым годом!"),
    tagline: "Robux под ёлкой",
    from: "#12396b",
    to: "#0b1f3d",
    button: "#2fa36b",
    note: "#eef6ff",
    ink: "#bfe6ff",
    image: "/gifts/new-year.png",
  },
  JUST: {
    label: "Просто так",
    greeting: (to) => (to ? `${to}, это тебе!` : "Это тебе!"),
    tagline: "Robux в подарок",
    from: "#ffb35c",
    to: "#ff6a3d",
    button: "#251b3f",
    note: "#fff6ec",
    ink: "#fff1d6",
    image: "/gifts/just.png",
  },
};

export function isGiftTheme(value: unknown): value is GiftTheme {
  return typeof value === "string" && (GIFT_THEMES as readonly string[]).includes(value);
}

/**
 * Ссылка в любом виде: схема, www, «точка + домен», t.me/vk.cc и @ник
 * мессенджера. Ложное срабатывание («ура.рф» в шутку) лучше, чем канал для
 * фишинга, — человек просто перепишет фразу.
 */
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(ru|рф|com|net|org|me|io|gg|su|xyz|site|online|shop|cc|ly|link|app|club|pro|info|biz|top)\b|t\.me|vk\.(com|cc|me)|@[a-z0-9_]{3,})/i;

export function giftTextHasLink(value: string): boolean {
  return LINK_RE.test(value);
}

/** Чистка короткого текста: без управляющих символов, пробелы схлопнуты. */
export function cleanGiftText(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, max);
}

export type GiftInput = {
  theme: GiftTheme;
  to: string | null;
  from: string | null;
  message: string | null;
  email: string;
  sendAt: Date | null;
};

export type GiftValidation = { ok: true; gift: GiftInput } | { ok: false; error: string };

export function validateGift(raw: {
  theme?: unknown;
  to?: unknown;
  from?: unknown;
  message?: unknown;
  email?: unknown;
  sendAt?: unknown;
}, now = Date.now()): GiftValidation {
  if (!isGiftTheme(raw.theme)) return { ok: false, error: "Выберите открытку." };
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    return { ok: false, error: "Проверьте почту получателя — в ней ошибка." };
  }
  const to = cleanGiftText(typeof raw.to === "string" ? raw.to : null, GIFT_NAME_MAX);
  const from = cleanGiftText(typeof raw.from === "string" ? raw.from : null, GIFT_NAME_MAX);
  const rawMessage = typeof raw.message === "string" ? raw.message : "";
  if (rawMessage.trim().length > GIFT_MESSAGE_MAX) {
    return { ok: false, error: `Пожелание — до ${GIFT_MESSAGE_MAX} символов.` };
  }
  const message = cleanGiftText(rawMessage, GIFT_MESSAGE_MAX);
  for (const value of [to, from, message]) {
    if (value && giftTextHasLink(value)) {
      return { ok: false, error: "В открытке нельзя ссылки и @ники — так письмо не примут за мошенническое." };
    }
  }
  let sendAt: Date | null = null;
  if (raw.sendAt !== undefined && raw.sendAt !== null && raw.sendAt !== "") {
    const parsed = new Date(String(raw.sendAt));
    if (Number.isNaN(parsed.getTime())) return { ok: false, error: "Проверьте дату отправки." };
    if (parsed.getTime() > now + GIFT_SCHEDULE_MAX_MS) return { ok: false, error: "Отправку можно запланировать не дальше чем на два месяца." };
    // Прошедшее время («сегодня в 9:00», а сейчас 11:00) = отправить сразу.
    sendAt = parsed.getTime() > now + 60_000 ? parsed : null;
  }
  return { ok: true, gift: { theme: raw.theme, to, from, message, email, sendAt } };
}

function tokenSecret(): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for gift links");
  return secret;
}

/** Токен «Открыть подарок»: другой назначенный секрет, чем у ссылки на оплату. */
export function giftOpenTokenFor(orderId: string): string {
  return crypto.createHmac("sha256", tokenSecret()).update(`code-gift-open:v1:${orderId}`).digest("base64url");
}

export function hashGiftToken(token: string): string {
  return crypto.createHash("sha256").update(`code-gift:${token}`, "utf8").digest("hex");
}

export function isGiftTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}
