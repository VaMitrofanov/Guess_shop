/**
 * Автопроверка скриншота Transactions (27.10.2026).
 *
 * Покупатель нажал «в Pending меньше суммы / нет робуксов» и прислал скриншот
 * страницы roblox.com/transactions. Раньше его смотрел только менеджер; теперь
 * бот сам читает картинку локальным Tesseract (пакет `tesseract-ocr` в образах
 * ботов, без внешних сервисов) и ищет число в строке «Pending Robux».
 *
 *  • Pending ≥ суммы заказа → покупателю сразу «вижу N в Pending — всё в
 *    порядке»; менеджер всё равно получает скрин, с пометкой «ок».
 *  • меньше / не прочиталось → менеджер получает скрин с цифрами, как раньше.
 *
 * Решений о деньгах бот не принимает: он только закрывает очевидный случай
 * «робуксы на месте» и подготавливает цифры. Любой сбой OCR = «не прочиталось».
 */

import { spawn } from "node:child_process";

/* ── Разбор текста (чистые функции, покрыты тестами) ─────────────────────── */

/** «Pending Robux» на английском и в русской локализации Roblox. */
const PENDING_LABEL_RE = /p[ea]nd[il1]ng|ожида/i;

/** Числа строки: «1,000», «1 000», «1.000», «12500». Даты и время отсеиваются. */
export function numbersIn(line: string): number[] {
  const out: number[] = [];
  // Даты (10/27/2026, 27.10.2026) и время (12:30) — не суммы.
  const cleaned = line
    .replace(/\d{1,4}[./-]\d{1,2}[./-]\d{2,4}/g, " ")
    .replace(/\d{1,2}\/\d{1,2}/g, " ")
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, " ");
  for (const m of cleaned.matchAll(/\d{1,3}(?:[ ,.  ]\d{3})+|\d+/g)) {
    const n = Number(m[0].replace(/[ ,.  ]/g, ""));
    if (Number.isFinite(n) && n < 10_000_000) out.push(n);
  }
  return out;
}

export interface PendingRead {
  /** Нашли подпись «Pending». Без неё число не доверяем. */
  labelFound: boolean;
  /** Число в строке Pending Robux (или сразу под ней). */
  pending: number | null;
  /** Ник заказа виден на скрине (по тексту). */
  nickSeen: boolean | null;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9а-яё_]/gi, "");
}

/** Расстояние Левенштейна ≤ 1 — OCR путает одну букву (l/1, O/0). */
function nearlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function readPendingFromText(text: string, nick?: string | null): PendingRead {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let labelFound = false;
  let pending: number | null = null;
  for (let i = 0; i < lines.length && pending === null; i++) {
    if (!PENDING_LABEL_RE.test(lines[i])) continue;
    labelFound = true;
    const after = lines[i].slice(lines[i].search(PENDING_LABEL_RE));
    const same = numbersIn(after);
    if (same.length) { pending = same[same.length - 1]; break; }
    // «0» рядом со значком робукса OCR читает буквой: «Pending Robux ©o», «Oo».
    const tail = after.replace(/^\S+\s*(robux|робукс\S*)?/i, "").trim();
    if (/^[^\p{L}\p{N}]{0,2}[oOоО0Q]{1,2}$/u.test(tail)) { pending = 0; break; }
    // Значение могло уехать в соседнюю строку (колонки таблицы) — но только
    // строка из одного числа: под вкладкой «Pending Robux» идёт «Past 30 Days».
    const next = lines[i + 1];
    if (next && /^[\d\s,.\u00a0\u202f]+$/.test(next)) {
      const n = numbersIn(next);
      if (n.length === 1) pending = n[0];
    }
  }

  let nickSeen: boolean | null = null;
  const want = nick ? norm(nick) : "";
  if (want.length >= 3) {
    const flat = norm(text);
    nickSeen = flat.includes(want) ||
      text.split(/\s+/).map(norm).some((t) => t.length >= 3 && nearlyEqual(t, want));
  }
  return { labelFound, pending, nickSeen };
}

export type PendingVerdict = "ok" | "low" | "unreadable";

export function pendingVerdict(read: PendingRead, amount: number | null | undefined): PendingVerdict {
  if (!read.labelFound || read.pending === null || !amount) return "unreadable";
  return read.pending >= amount ? "ok" : "low";
}

/** Строка для менеджера: что бот увидел на скрине. */
export function pendingCheckNote(read: PendingRead, verdict: PendingVerdict, amount?: number | null): string {
  const nick = read.nickSeen === true ? "ник заказа виден" : read.nickSeen === false ? "ник заказа НЕ найден на скрине" : "";
  if (verdict === "unreadable") return `🤖 Автопроверка скрина: не прочиталось${read.labelFound ? " (строка Pending есть, числа нет)" : ""} — смотри глазами`;
  const head = verdict === "ok"
    ? `🤖 Автопроверка скрина: ✅ в Pending ${read.pending} (заказ ${amount}) — покупателю ответили, что всё в порядке`
    : `🤖 Автопроверка скрина: ❌ в Pending ${read.pending} — меньше заказа (${amount})`;
  return nick ? `${head}; ${nick}` : head;
}

/** Ответ покупателю, когда на скрине всё на месте. */
export function pendingOkReplyText(pending: number): string {
  return (
    `🤖 Посмотрел твой скриншот: в строке Pending Robux — ${pending}. ` +
    `Значит, всё в порядке — робуксы на твоём аккаунте, с нашей стороны всё сделано. ` +
    `На баланс их переведёт сам Roblox.\n\n` +
    `Скрин я всё равно передал менеджеру. Когда робуксы появятся на балансе — нажми «✅ Робуксы поступили» 🙏`
  );
}

/* ── Запуск Tesseract ────────────────────────────────────────────────────── */

const OCR_TIMEOUT_MS = 25_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Языки: русский пакет может отсутствовать (локальная машина) — тогда только eng. */
let langs = "eng+rus";

/** Текст картинки через `tesseract`; `null` — нет бинаря/таймаут/сбой. */
export async function ocrImage(image: Buffer, psm = 6): Promise<string | null> {
  const first = await runTesseract(image, psm, langs);
  if (first !== null || langs === "eng") return first;
  const fallback = await runTesseract(image, psm, "eng");
  if (fallback !== null) langs = "eng";
  return fallback;
}

function runTesseract(image: Buffer, psm: number, lang: string): Promise<string | null> {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (v: string | null) => { if (!done) { done = true; resolve(v); } };
    try {
      const p = spawn("tesseract", ["stdin", "stdout", "-l", lang, "--psm", String(psm)], { stdio: ["pipe", "pipe", "ignore"] });
      const timer = setTimeout(() => { p.kill("SIGKILL"); finish(null); }, OCR_TIMEOUT_MS);
      p.stdout.on("data", (d) => { out += d; });
      p.on("error", () => { clearTimeout(timer); finish(null); });
      p.on("close", (code) => { clearTimeout(timer); finish(code === 0 ? out : null); });
      p.stdin.on("error", () => finish(null));
      p.stdin.end(image);
    } catch {
      finish(null);
    }
  });
}

/**
 * Скачать картинку (TG file link / VK CDN) с потолком размера. CDN VK на частые
 * запросы отвечает 429 HTML-страницей — её нельзя принять за картинку
 * (27.10.2026): проверяем тип и один раз повторяем через 2 с.
 */
export async function fetchImage(url: string, attempt = 1): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const type = r.headers.get("content-type") ?? "";
    if ((r.status === 429 || r.status >= 500) && attempt < 2) {
      await new Promise((res) => setTimeout(res, 2_000));
      return fetchImage(url, attempt + 1);
    }
    if (!r.ok || !type.startsWith("image/")) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 0 && buf.length <= MAX_IMAGE_BYTES ? buf : null;
  } catch {
    return null;
  }
}

export interface PendingCheck {
  verdict: PendingVerdict;
  read: PendingRead;
  note: string;
}

/**
 * Полная проверка: скачать → OCR (два режима разметки: таблица и разрозненный
 * текст) → разбор. Никогда не бросает.
 */
export async function checkPendingScreenshot(url: string, amount: number | null | undefined, nick?: string | null): Promise<PendingCheck> {
  const empty: PendingRead = { labelFound: false, pending: null, nickSeen: null };
  const img = await fetchImage(url);
  if (!img) return { verdict: "unreadable", read: empty, note: pendingCheckNote(empty, "unreadable") };
  let best: PendingRead = empty;
  for (const psm of [6, 11]) {
    const text = await ocrImage(img, psm);
    if (!text) continue;
    const read = readPendingFromText(text, nick);
    if (read.pending !== null) { best = read; break; }
    if (read.labelFound && !best.labelFound) best = read;
  }
  const verdict = pendingVerdict(best, amount);
  return { verdict, read: best, note: pendingCheckNote(best, verdict, amount) };
}

/**
 * На скрине нет строки Pending вообще — это не страница Transactions (часто
 * присылают магазин робуксов или профиль). Один раз просим правильный скрин.
 */
export function isWrongPage(check: PendingCheck): boolean {
  return check.verdict === "unreadable" && !check.read.labelFound;
}

export function wrongPageReplyText(fmt: "html" | "plain"): string {
  const b = (s: string) => (fmt === "html" ? `<b>${s}</b>` : s);
  const link = fmt === "html"
    ? `<a href="https://www.roblox.com/transactions">roblox.com/transactions</a>`
    : "https://www.roblox.com/transactions";
  return (
    `🤖 На скриншоте не видно строки ${b("Pending Robux")} — похоже, это другая страница.\n\n` +
    `Нужна именно страница транзакций:\n` +
    `1. Открой ${link} в браузере (в приложении Roblox её нет).\n` +
    `2. Войди в аккаунт, на который делали заказ.\n` +
    `3. Тип — ${b("Summary")}, в таблице строка ${b("Pending Robux")} с числом.\n\n` +
    `📸 Пришли скриншот этой страницы сюда — я сразу проверю.`
  );
}
