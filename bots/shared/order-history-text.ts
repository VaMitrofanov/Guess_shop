/* ─────────────────────────────────────────────────────────────────────────────
   История заказа человеческим языком — для ассистента админов (26.11.2026).

   Ассистенту отдавали сырой журнал (`OrderEvent` с JSON-payload), и он угадывал:
   `SUPPORT_REQUEST_DELIVERED` с `contextKey: robux_low_pending_retry` назвал
   «возможно, подтверждение оплаты», а правку от «Claude» приписал спрашивающему
   («ты перевёл»). Здесь всё переводится заранее: время — по Москве строкой,
   событие — фразой с тем, КТО это сделал, сценарий обращения — подписью из
   поддержки. Модели остаётся пересказать, а не расшифровывать.
   ───────────────────────────────────────────────────────────────────────── */

import { SUPPORT_CONTEXT_LABELS } from "./support-context-labels";

const MSK_OFFSET_MS = 3 * 3600_000;

/** «03.11.2026 16:37 МСК» — без часовых поясов в голове модели. */
export function mskText(at: Date | string | null | undefined): string | null {
  if (!at) return null;
  const d = new Date(new Date(at).getTime() + MSK_OFFSET_MS);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} МСК`;
}

/** Кто сделал: `admin:Demid` → «админ Demid», Claude → ИИ-помощник, бот/воркер — автоматика. */
export function actorText(actor: unknown): string {
  const raw = typeof actor === "string" ? actor.trim() : "";
  if (!raw) return "неизвестно кто";
  const name = raw.replace(/^admin:/, "");
  if (/^claude$/i.test(name)) return "ИИ-помощник Claude (по поручению владельца)";
  if (raw.startsWith("admin:")) return `админ ${name}`;
  if (/^(bot|worker|system|cron)$/i.test(raw)) return "автоматика";
  if (raw === "client") return "покупатель";
  return name;
}

const VIA: Record<string, string> = {
  "site-search": "поиск по нику на сайте",
  "site-gp-link": "ссылка на пасс на сайте",
  "site-one-tap": "выбор пасса на сайте",
  "site-api-key": "автосоздание по ключу на сайте",
  "nick-search": "поиск по нику",
  "tg-bot": "TG-бот",
  "vk-bot": "VK-бот",
  site: "сайт",
};
const via = (v: unknown) => (typeof v === "string" ? VIA[v] ?? v : null);

const SURVEY: Record<string, string> = {
  ROBUX_SURVEY_GOT: "покупатель подтвердил: робуксы пришли на баланс",
  ROBUX_SURVEY_PENDING: "покупатель ответил: робуксы видны в Pending, ещё не на балансе",
  ROBUX_SURVEY_NONE: "покупатель ответил: робуксов не видно (ни на балансе, ни в Pending)",
};

/** Служебные записи, которые ничего не говорят о заказе. */
const SERVICE = new Set(["ADMIN_CARD_ROOT", "ORDER_PIN", "POST_PURCHASE_TG_NOTIFICATIONS_OPENED", "POST_PURCHASE_VK_COMMUNITY_OPENED"]);

type P = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Одна фраза о событии или null, если событие служебное. */
export function describeEvent(type: string, payload: unknown, statusRu: Record<string, string> = {}): string | null {
  if (SERVICE.has(type)) return null;
  const p = (payload && typeof payload === "object" ? payload : {}) as P;
  const st = (v: unknown) => statusRu[s(v)] ?? s(v);
  switch (type) {
    case "ORDER_STATUS_CHANGED": {
      const what = p.why === "rebuy" ? "ПЕРЕВЫКУП: заказ возвращён из «выкуплен» в очередь" : `статус «${st(p.from)}» → «${st(p.to)}»`;
      return `${what}; сделал: ${actorText(p.actor)}${p.reason ? `; причина: ${s(p.reason)}` : ""}${p.gross ? `; списано ${s(p.gross)} R$` : ""}`;
    }
    case "AUDIT_NICK_ENTERED":
      return `покупатель вводил ник «${s(p.nick)}» (${via(p.via) ?? "?"}) — это попытка, не обязательно итоговый ник`;
    case "AUDIT_GAMEPASS_SUBMITTED":
      return `покупатель выбрал пасс ${s(p.gamepassId)} за ${s(p.price)} R$, владелец пасса ${s(p.creatorName) || "?"} (${via(p.via) ?? "?"})`;
    case "AUDIT_GAMEPASS_AUTOCREATED":
      return `пасс ${s(p.gamepassId)} за ${s(p.price)} R$ создан автоматически на аккаунте ${s(p.robloxUsername) || "?"}`;
    case "GUIDE_OPENED":
      return "покупатель открыл инструкцию";
    case "SUPPORT_REQUEST_DELIVERED": {
      const topic = SUPPORT_CONTEXT_LABELS[s(p.contextKey)] ?? (p.contextKey ? s(p.contextKey) : "общий вопрос");
      const body = p.text
        ? `его текст: «${s(p.text).slice(0, 200)}»${p.photo ? " + фото" : ""}`
        : p.photo ? "своего текста нет, прислал фото" : "своего текста нет";
      return `обращение покупателя в поддержку через ${via(p.via) ?? "?"}, сценарий бота: ${topic} (это подпись сценария, не слова покупателя); ${body}${p.ocr === "unreadable" ? "; текст на фото бот не распознал" : ""}`;
    }
    case "ROBUX_QUESTION_SELF_SERVED":
      return `покупатель спросил «где робуксы», бот ответил сам (${via(p.via) ?? "?"})`;
    case "ROBUX_SURVEY_GOT":
    case "ROBUX_SURVEY_PENDING":
    case "ROBUX_SURVEY_NONE":
      return SURVEY[type];
    case "BOT_NO_PLACE_HELP":
      return `у покупателя не нашёлся плейс для пасса (ник ${s(p.nick) || "?"}), бот показал помощь`;
    case "BOT_DEAD_END":
      return `покупатель застрял в боте: ${s(p.reason) || "?"}`;
    case "REMINDER_MSG":
      return `бот отправил покупателю напоминание №${s(p.level) || "?"}`;
    case "BUYER_STEP_SENT":
      return `админ ${s(p.by) || "?"} отправил покупателю подсказку «${s(p.kind)}»`;
    case "CONTACT_ADDED":
      return `к заказу привязан ещё один контакт: ${s(p.who) || "?"} (${s(p.via)})`;
    case "BOT_ORDER_CREATED":
    case "WEB_ORDER_CREATED":
      return `заказ создан (${type === "WEB_ORDER_CREATED" ? "сайт" : "бот"})`;
    case "MANUAL_PAYMENT_CONFIRMED":
      return "админ вручную подтвердил оплату";
    case "BENEFITS_REVERTED":
      return `бонусы заказа отменены (${s(p.reason)})`;
    default:
      if (type.startsWith("PAYMENT_")) return `оплата: ${type.slice(8).toLowerCase().replace(/_/g, " ")}`;
      return `${type}: ${JSON.stringify(p).slice(0, 160)}`;
  }
}

/** Дата из пометки: «2026-11-10», «03.11.2026» или «03.11» (год — ближайший не в будущем). */
function noteDate(line: string, now: number): number | null {
  const iso = line.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const ru = line.match(/\b(\d{2})\.(\d{2})(?:\.(20\d{2}))?\b/);
  if (!ru) return null;
  const [d, m] = [+ru[1], +ru[2]];
  if (d < 1 || d > 31 || m < 1 || m > 12) return null;
  if (ru[3]) return Date.UTC(+ru[3], m - 1, d);
  const year = new Date(now).getUTCFullYear();
  const t = Date.UTC(year, m - 1, d);
  return t > now + 86_400_000 ? Date.UTC(year - 1, m - 1, d) : t;
}

/**
 * Пометки админов (`adminNote`) по времени, старые сверху. В базе порядок
 * смешанный: одни пути дописывают строку в конец (`appendOrderAudit`), другие —
 * в начало, и модель принимала раннюю пометку за последнее слово. Строка без
 * даты держится за соседкой сверху; одинаковые даты сохраняют исходный порядок.
 */
export function notesByTime(adminNote: string | null | undefined, now = Date.now()): string[] {
  const lines = (adminNote ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  let last = 0;
  const keyed = lines.map((line, i) => {
    const t = noteDate(line, now);
    if (t !== null) last = t;
    return { line, t: t ?? last, i };
  });
  // Пометки, вписанные в начало, идут от новых к старым — у одной даты обратный
  // порядок значения не имеет, поэтому сортируем по дате, а внутри даты — как было.
  return keyed.sort((a, b) => a.t - b.t || a.i - b.i).map((k) => k.line);
}
