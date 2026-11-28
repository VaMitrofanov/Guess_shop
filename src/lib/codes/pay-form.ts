/**
 * Оплата кода по ссылке без JavaScript (18.11.2026).
 *
 * Блок «Оплатить» на /pay/<токен> — обычная HTML-форма. Пока скрипты страницы
 * не загрузились или не исполнились (старый iOS, обрыв LTE, встроенный браузер),
 * она уходит POST-ом на /api/codes/pay и платёж всё равно стартует. 17.11
 * покупатель шесть раз создал заказ и ни разу не смог нажать кнопку: она была
 * выключена до гидратации, а гидратации на его телефоне не случилось.
 *
 * Ошибку форма возвращает на страницу кодом, а не текстом: текст в адресе
 * позволил бы любому подсунуть на нашу страницу оплаты свою «подсказку».
 */

import { NextResponse, type NextRequest } from "next/server";
import { isPayTokenShape } from "@/lib/codes/secrets";

export const PAY_FORM_ERRORS: Record<string, string> = {
  TERMS: "Нужно согласие с офертой — поставьте галочку и нажмите «Оплатить» ещё раз.",
  EMAIL: "Проверьте email для чека.",
  RECEIPT_EMAIL_REQUIRED: "Укажите email для чека.",
  LIMIT: "Слишком много попыток. Подождите минуту.",
  NOT_FOUND: "Ссылка не найдена.",
  ALREADY_PAID: "Этот заказ уже оплачен.",
  OFFER_EXPIRED: "Срок предложения истёк — подтвердите обновлённый заказ.",
  PAYMENT_IN_PROGRESS: "Платёж уже проходит. Обновите страницу через минуту.",
  BANK_UNAVAILABLE: "Банк временно не создал платёж. Нажмите «Оплатить» ещё раз — заказ сохранён.",
  OUT_OF_STOCK: "Коды этого номинала закончились. Попробуйте позже.",
  SALES_CLOSED: "Оплата временно недоступна. Попробуйте чуть позже.",
  FAILED: "Не получилось перейти к оплате. Попробуйте ещё раз.",
};

export function payFormErrorMessage(code: string | undefined | null): string | null {
  if (!code) return null;
  return PAY_FORM_ERRORS[code] ?? PAY_FORM_ERRORS.FAILED;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/**
 * Страница-переход на банк. Не 303: CSP держит `form-action 'self'`, а браузеры
 * применяют его и к редиректам после отправки формы, так что прямой редирект на
 * Т-Банк был бы заблокирован. Meta refresh — обычная навигация, плюс видимая
 * ссылка на случай, если автопереход отключён.
 */
export function bankHandoffHtml(paymentUrl: string): string {
  const url = escapeHtml(paymentUrl);
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<meta http-equiv="refresh" content="0;url=${url}">
<title>Переходим к оплате — RobloxBank</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 -apple-system,system-ui,sans-serif;background:#f6f4ff;color:#1d1636;padding:16px;box-sizing:border-box}
main{max-width:420px;text-align:center}a{display:inline-block;margin-top:16px;padding:14px 22px;border-radius:14px;background:#6c47ff;color:#fff;font-weight:700;text-decoration:none}
@media (prefers-color-scheme:dark){body{background:#120e22;color:#efeaff}}</style></head>
<body><main><h1 style="font-size:20px">Переходим на страницу оплаты Т-Банка…</h1>
<p>Если страница не открылась сама, нажмите кнопку.</p><a href="${url}">Перейти к оплате</a></main></body></html>`;
}

const SITE_ORIGIN = new URL(process.env.NEXT_PUBLIC_APP_URL || "https://robloxbank.ru").origin;

/** Запрос пришёл из HTML-формы (без скриптов), а не из `fetch` с JSON. */
export function isFormPost(req: NextRequest): boolean {
  const type = req.headers.get("content-type") ?? "";
  return type.startsWith("application/x-www-form-urlencoded") || type.startsWith("multipart/form-data");
}

/** Чужой сайт не должен уметь отправлять нашу форму от имени покупателя. */
export function formFromOurSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return true; // старые браузеры Origin не шлют; токен ссылки всё равно нужен
  const host = (value: string) => {
    try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return ""; }
  };
  return host(origin) === host(SITE_ORIGIN);
}

/** 303 обратно на страницу ссылки (тот же сайт — `form-action 'self'` пропускает). */
export function backToPayPage(token: string, errorCode?: string): NextResponse {
  if (!isPayTokenShape(token)) return NextResponse.redirect(new URL("/#codes", SITE_ORIGIN), { status: 303 });
  const url = new URL(`/pay/${token}`, SITE_ORIGIN);
  if (errorCode) url.searchParams.set("error", errorCode in PAY_FORM_ERRORS ? errorCode : "FAILED");
  return NextResponse.redirect(url, { status: 303, headers: { "cache-control": "private, no-store" } });
}

export async function readForm(req: NextRequest): Promise<Record<string, string>> {
  const form = await req.formData().catch(() => null);
  const out: Record<string, string> = {};
  form?.forEach((value, key) => { if (typeof value === "string") out[key] = value; });
  return out;
}
