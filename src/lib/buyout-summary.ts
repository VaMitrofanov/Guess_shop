/**
 * Блок «✅ Выкуплен» в карточке заказа — общий для TWA и /admin (27.10.2026).
 *
 * До этого факт выкупа был серой строкой «💳 Выкуп: Demid · 24 окт» внизу
 * карточки, а сверху стояла шкала готовности: открыв выкупленный заказ, админ
 * не видел сразу, что он выкуплен, когда и как. Теперь всё, что известно о
 * выкупе, собрано здесь в строки «подпись · значение · тон», а экраны только
 * рисуют их — одинаково в TWA и на сайте.
 *
 * Источники: поля заказа (completedAt, pendingAt, части, adminNote с пометкой
 * `[УВЕД …]`) и журнал `OrderEvent` (кто закрыл и сколько списано — из перехода
 * в COMPLETED; ответ на опрос «пришли ли робуксы?»; обращения после выкупа).
 * Журнал читает `/api/twa/orders` через `buyoutFactsFromEvents`.
 */

/* = ORDER_STATUS_EVENT из `order-status-event.ts`. Не импортируем: тот модуль
   серверный (server-only + prisma), а этот рисуют клиентские экраны. */
const ORDER_STATUS_EVENT = "ORDER_STATUS_CHANGED";

/* ── Журнал → факты ──────────────────────────────────────────────────────── */

export const SURVEY_EVENT = {
  GOT: "ROBUX_SURVEY_GOT",
  PENDING: "ROBUX_SURVEY_PENDING",
  NONE: "ROBUX_SURVEY_NONE",
} as const;
const SUPPORT_DELIVERED = "SUPPORT_REQUEST_DELIVERED";

/** Какие события нужны блоку — один запрос на всю страницу ленты. */
export const BUYOUT_EVENT_TYPES = [ORDER_STATUS_EVENT, SURVEY_EVENT.GOT, SURVEY_EVENT.PENDING, SURVEY_EVENT.NONE, SUPPORT_DELIVERED];

export type SurveyAnswer = "GOT" | "PENDING" | "NONE";

export interface BuyoutEventRow {
  orderId: string;
  type: string;
  payload: unknown;
  createdAt: Date | string;
}

export interface BuyoutFacts {
  /** Кто закрыл (`admin:Demid` → `Demid`). */
  by: string | null;
  /** Сколько R$ списано при выкупе (из перехода в COMPLETED). */
  gross: number | null;
  survey: SurveyAnswer | null;
  surveyAt: string | null;
  /** Обращения в поддержку после выкупа: всего и про робуксы. */
  supportAfter: (completedAt: Date | string | null | undefined) => { total: number; robux: number };
}

/** События отсортированы по убыванию времени — первое встреченное и есть последнее. */
export function buyoutFactsFromEvents(rows: BuyoutEventRow[]): Map<string, BuyoutFacts> {
  const acc = new Map<string, { by: string | null; gross: number | null; survey: SurveyAnswer | null; surveyAt: string | null; support: { at: number; robux: boolean }[]; seenStatus: boolean }>();
  for (const row of rows) {
    let a = acc.get(row.orderId);
    if (!a) {
      a = { by: null, gross: null, survey: null, surveyAt: null, support: [], seenStatus: false };
      acc.set(row.orderId, a);
    }
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const at = new Date(row.createdAt);
    if (row.type === ORDER_STATUS_EVENT) {
      if (a.seenStatus || p.to !== "COMPLETED") continue;
      a.seenStatus = true;
      a.by = typeof p.actor === "string" ? p.actor.replace(/^admin:/, "") : null;
      a.gross = typeof p.gross === "number" && p.gross > 0 ? p.gross : null;
    } else if (row.type === SUPPORT_DELIVERED) {
      a.support.push({ at: at.getTime(), robux: p.robux === true });
    } else if (!a.survey) {
      const key = (Object.keys(SURVEY_EVENT) as SurveyAnswer[]).find((k) => SURVEY_EVENT[k] === row.type);
      if (key) { a.survey = key; a.surveyAt = at.toISOString(); }
    }
  }
  const out = new Map<string, BuyoutFacts>();
  for (const [id, a] of acc) {
    out.set(id, {
      by: a.by,
      gross: a.gross,
      survey: a.survey,
      surveyAt: a.surveyAt,
      supportAfter: (completedAt) => {
        const from = completedAt ? new Date(completedAt).getTime() : Infinity;
        const after = a.support.filter((s) => s.at >= from);
        return { total: after.length, robux: after.filter((s) => s.robux).length };
      },
    });
  }
  return out;
}

/* ── Заказ → строки блока ────────────────────────────────────────────────── */

export type BuyoutTone = "green" | "red" | "orange" | "neutral" | "muted";

export interface BuyoutRow {
  key: "who" | "charged" | "queue" | "notice" | "robux" | "confirm" | "survey" | "support" | "review" | "sale";
  label: string;
  value: string;
  tone: BuyoutTone;
  /** Мелкие строки под значением (части разбивки). */
  sub?: string[];
}

export interface BuyoutSummary {
  /** «24 октября, 20:30 МСК» */
  when: string;
  /** «2 дня назад» */
  ago: string;
  rows: BuyoutRow[];
  /** Есть что-то, что требует внимания админа (не извещён, «нигде нет», …). */
  attention: boolean;
}

export interface BuyoutOrderInput {
  status: string;
  amount: number;
  createdAt: string | Date;
  pendingAt?: string | Date | null;
  completedAt?: string | Date | null;
  purchaserUsername?: string | null;
  completedBy?: string | null;
  adminNote?: string | null;
  orderSource?: string | null;
  isDirectOrder?: boolean | null;
  saleAmountKopecks?: number | null;
  reviewStatus?: "PENDING" | "SUBMITTED" | null;
  splitGamepasses?: { amount: number; position: number; chargedPrice: number | null; purchasedAt: string | Date | null }[];
  user?: { balance?: number | null; reviewBonusGrantedAt?: string | Date | null } | null;
  buyoutFacts?: {
    gross?: number | null;
    survey?: SurveyAnswer | null;
    surveyAt?: string | null;
    supportAfter?: { total: number; robux: number } | null;
  } | null;
}

const TZ = "Europe/Moscow";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** «24 октября, 20:30 МСК» */
export function fmtBuyoutWhen(d: Date): string {
  const day = d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: TZ });
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  return `${day}, ${time} МСК`;
}

function fmtShort(d: Date): string {
  const day = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: TZ }).replace(".", "");
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  return `${day} ${time}`;
}

/** «1 д 13 ч», «5 ч 20 мин», «12 мин» */
export function fmtSpan(ms: number): string {
  if (ms < MIN) return "меньше минуты";
  if (ms < HOUR) return `${Math.round(ms / MIN)} мин`;
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    const m = Math.round((ms % HOUR) / MIN);
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  }
  const d = Math.floor(ms / DAY);
  const h = Math.round((ms % DAY) / HOUR);
  return h ? `${d} д ${h} ч` : `${d} д`;
}

/** «только что», «3 ч назад», «2 дня назад» */
export function fmtAgo(ms: number): string {
  if (ms < HOUR) return ms < 2 * MIN ? "только что" : `${Math.round(ms / MIN)} мин назад`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} ч назад`;
  const d = Math.floor(ms / DAY);
  return `${d} ${plural(d, ["день", "дня", "дней"])} назад`;
}

export interface NoticeState {
  state: "ok" | "partial" | "wb" | "failed" | "unknown";
  /** «TG», «VK» — кто доставил. */
  via: string | null;
  /** «2026-10-24 17:30» из пометки (UTC, как пишет сервер). */
  stamp: string | null;
}

/**
 * Дошло ли «заказ выкуплен». Сервер дописывает в `adminNote` строку
 * `[УВЕД <stamp>] …` или `[УВЕД-НЕ-ДОШЛО <stamp>] …` (bots/shared/notice-delivery.ts);
 * смотрим последнюю.
 */
export function parseNotice(adminNote: string | null | undefined): NoticeState {
  const lines = (adminNote ?? "").split("\n").filter((l) => /^\[УВЕД(-НЕ-ДОШЛО)? /.test(l));
  const last = lines.at(-1);
  if (!last) return { state: "unknown", via: null, stamp: null };
  const m = /^\[(УВЕД(?:-НЕ-ДОШЛО)?) ([^\]]+)\]\s*(.*)$/.exec(last);
  const failed = m?.[1] === "УВЕД-НЕ-ДОШЛО";
  const stamp = m?.[2] ?? null;
  const rest = m?.[3] ?? "";
  const via = /^(TG|VK)\b/.exec(rest)?.[1] ?? null;
  if (failed) return { state: "failed", via, stamp };
  if (/чат WB/.test(rest)) return { state: "wb", via: "чат WB", stamp };
  if (/второе сообщение/.test(rest)) return { state: "partial", via, stamp };
  return { state: "ok", via, stamp };
}

/** Пометка пишется в UTC («2026-10-24 17:30») — показываем по Москве. */
function stampToMsk(stamp: string | null): string | null {
  if (!stamp) return null;
  const d = new Date(stamp.replace(" ", "T") + ":00Z");
  return Number.isNaN(d.getTime()) ? null : fmtShort(d);
}

const SOURCE_LABEL: Record<string, string> = {
  WB_DBS: "WB DBS",
  WB: "Wildberries",
  SITE: "сайт",
  TG: "Telegram",
  VK: "VK",
  AVITO: "Авито",
};

export function buildBuyoutSummary(order: BuyoutOrderInput, now: Date = new Date()): BuyoutSummary | null {
  if (order.status !== "COMPLETED" || !order.completedAt) return null;
  const doneAt = new Date(order.completedAt);
  const facts = order.buyoutFacts ?? {};
  const rows: BuyoutRow[] = [];
  let attention = false;

  // Кто и как
  if (order.purchaserUsername) {
    rows.push({ key: "who", label: "Кто", value: `автовыкуп · аккаунт ${order.purchaserUsername}`, tone: "neutral" });
  } else {
    rows.push({ key: "who", label: "Кто", value: order.completedBy ? `${order.completedBy} · вручную` : "вручную (кто — не записано)", tone: order.completedBy ? "neutral" : "muted" });
  }

  // Сколько списано и части
  const parts = [...(order.splitGamepasses ?? [])].sort((a, b) => a.position - b.position);
  const partsCharged = parts.reduce((s, p) => s + (p.chargedPrice ?? 0), 0);
  const gross = facts.gross ?? (partsCharged > 0 ? partsCharged : null);
  const sub = parts.length > 1
    ? parts.map((p, i) => `${p.purchasedAt ? "✓" : "○"} часть ${i + 1} · ${p.amount} R$${p.chargedPrice ? ` за ${p.chargedPrice}` : ""}${p.purchasedAt ? ` · ${fmtShort(new Date(p.purchasedAt))}` : " · не отмечена"}`)
    : undefined;
  rows.push({
    key: "charged",
    label: "Списано",
    value: gross
      ? `${gross.toLocaleString("ru-RU")} R$${parts.length > 1 ? ` · ${parts.length} ${plural(parts.length, ["часть", "части", "частей"])}` : ""}`
      : "не записано",
    tone: gross ? "neutral" : "muted",
    sub,
  });

  // Сколько ждал
  const queueFrom = order.pendingAt ? new Date(order.pendingAt) : null;
  const created = new Date(order.createdAt);
  const queue = queueFrom && doneAt.getTime() >= queueFrom.getTime() ? fmtSpan(doneAt.getTime() - queueFrom.getTime()) : null;
  const total = fmtSpan(Math.max(0, doneAt.getTime() - created.getTime()));
  rows.push({
    key: "queue",
    label: "Очередь",
    value: queue ? `${queue} от пасса до выкупа · всего ${total}` : `всего ${total} с создания заказа`,
    tone: "neutral",
  });

  // Дошло ли до покупателя
  const n = parseNotice(order.adminNote);
  const nAt = stampToMsk(n.stamp);
  if (n.state === "failed") {
    attention = true;
    rows.push({ key: "notice", label: "Клиент", value: `📵 НЕ извещён${n.via ? ` (${n.via} не принял)` : ""}${nAt ? ` · ${nAt}` : ""}`, tone: "red" });
  } else if (n.state === "unknown") {
    rows.push({ key: "notice", label: "Клиент", value: "нет следа уведомления", tone: "muted" });
  } else {
    const how = n.state === "wb" ? "в чате WB" : n.via ? `в ${n.via}` : "";
    rows.push({
      key: "notice",
      label: "Клиент",
      value: `📨 извещён ${how}${nAt ? ` · ${nAt}` : ""}`.replace(/\s+·/, " ·").trim(),
      tone: n.state === "partial" ? "orange" : "green",
      sub: n.state === "partial" ? ["второе сообщение (бонус/отзыв) не дошло"] : undefined,
    });
  }

  // Робуксы и ответ покупателя. «✅ Робуксы поступили» — та же кнопка, что
  // ответ опроса «уже на балансе» (ROBUX_SURVEY_GOT): главное для владельца.
  rows.push({ key: "robux", label: "Робуксы", value: "💎 в Pending у Roblox — с нашей стороны всё", tone: "neutral" });
  const surveyAt = facts.surveyAt ? ` · ${fmtShort(new Date(facts.surveyAt))}` : "";
  if (facts.survey === "GOT") {
    rows.push({ key: "confirm", label: "Подтверждение", value: `✅ покупатель подтвердил: робуксы поступили${surveyAt}`, tone: "green" });
  } else {
    rows.push({ key: "confirm", label: "Подтверждение", value: "покупатель ещё не нажал «Робуксы поступили»", tone: "muted" });
    if (facts.survey === "PENDING") {
      rows.push({ key: "survey", label: "Опрос", value: `⏳ «в Pending»${surveyAt}`, tone: "neutral" });
    } else if (facts.survey === "NONE") {
      attention = true;
      rows.push({ key: "survey", label: "Опрос", value: `❌ «ни в Pending, ни на балансе» — проверить${surveyAt}`, tone: "red" });
    }
  }

  // Обращения после выкупа
  const sup = facts.supportAfter;
  if (sup && sup.total > 0) {
    rows.push({
      key: "support",
      label: "Поддержка",
      value: `${sup.total} ${plural(sup.total, ["обращение", "обращения", "обращений"])} после выкупа${sup.robux ? ` · ${sup.robux} про робуксы` : ""}`,
      tone: "orange",
    });
  }

  // Отзыв и бонус
  if (order.reviewStatus) {
    const granted = order.user?.reviewBonusGrantedAt;
    const bal = order.user?.balance ?? 0;
    rows.push(order.reviewStatus === "PENDING"
      ? { key: "review", label: "Отзыв", value: "📸 ждём отзыв · скрин = +100 R$", tone: "orange" }
      : granted && bal > 0
        ? { key: "review", label: "Отзыв", value: `🎁 +100 R$ начислен · баланс ${bal} R$`, tone: "green" }
        : { key: "review", label: "Отзыв", value: "🎁 бонус за отзыв использован", tone: "muted" });
  }

  // Продажа
  const source = order.orderSource ? SOURCE_LABEL[order.orderSource] ?? order.orderSource : null;
  if (order.saleAmountKopecks && order.saleAmountKopecks > 0) {
    rows.push({ key: "sale", label: "Продажа", value: `${Math.round(order.saleAmountKopecks / 100).toLocaleString("ru-RU")} ₽${source ? ` · ${source}` : ""}`, tone: "neutral" });
  } else if (source) {
    rows.push({ key: "sale", label: "Источник", value: source, tone: "neutral" });
  }

  return {
    when: fmtBuyoutWhen(doneAt),
    ago: fmtAgo(Math.max(0, now.getTime() - doneAt.getTime())),
    rows,
    attention,
  };
}
