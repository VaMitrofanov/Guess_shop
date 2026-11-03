/* ─────────────────────────────────────────────────────────────────────────────
   «Путь покупателя» в карточке заказа (28.10.2026, макет «Карточка заказа v2»).

   Один раздел, в котором видно: на каком шаге человек, чего мы от него ждём и
   сколько, что мы ему отправляли, что он сделал в ответ и где бот его не понял.
   Плюс «Следующий шаг» — самое полезное действие под ситуацию (замена кнопки
   «Напомнить»: повтор того же сообщения почти ничего не даёт).

   Чистая функция без Prisma и React: её читают TWA, досье сайта и тесты. Сервер
   отдаёт события заказа (`JOURNEY_EVENT_TYPES`), клиент добавляет живую
   проверку пасса (цена / в продаже) — она есть только у него.

   Слова: не «ход за ним», а ЧЕГО ждём («Ждём ключ · 2 ч»). Цвет говорит, от
   кого зависит: wait — от покупателя, us — от нас, bad — что-то сломалось.
   Имя админа в касаниях не показываем — только во «Всей истории» мелко.
   ───────────────────────────────────────────────────────────────────────── */

import { BUYER_STEP_OPTIONS, BUYER_STEP_EVENT, DEAD_END_REASONS, type BuyerStepKind } from "../../bots/shared/buyer-step";
import { PLACE_HELP_EVENT } from "../../bots/shared/no-place";

/** Покупатель открыл свою личную ссылку на инструкцию (пишет Guide). */
export const GUIDE_OPENED_EVENT = "GUIDE_OPENED";

/** События, из которых складывается путь. Сервер выбирает ровно их. */
export const JOURNEY_EVENT_TYPES = [
  "AUDIT_NICK_ENTERED",
  "AUDIT_GAMEPASS_SUBMITTED",
  "AUDIT_GAMEPASS_AUTOCREATED",
  BUYER_STEP_EVENT.SENT,
  BUYER_STEP_EVENT.DEAD_END,
  PLACE_HELP_EVENT,
  GUIDE_OPENED_EVENT,
  "ORDER_STATUS_CHANGED",
  "PAYMENT_CONFIRMED",
  "MANUAL_PAYMENT_CONFIRMED",
] as const;

/** Поля payload, которые нужны пути. Остальное в ленту не везём. */
const KEEP_PAYLOAD = ["kind", "channel", "reason", "stage", "device", "nick", "gamepassId", "price", "to", "from", "by", "via", "verdict"] as const;

export function trimJourneyPayload(payload: unknown): Record<string, unknown> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of KEEP_PAYLOAD) {
    const value = p[key];
    if (value === undefined || value === null) continue;
    out[key] = typeof value === "string" ? value.slice(0, 160) : value;
  }
  return out;
}

export interface JourneyEventRow {
  type: string;
  payload?: unknown;
  createdAt: string | Date;
}

export interface JourneyOrder {
  status: string;
  wbCode: string;
  createdAt: string | Date;
  isDirectOrder?: boolean | null;
  paidAt?: string | Date | null;
  robloxUsername?: string | null;
  probableNick?: string | null;
  probableNickAt?: string | Date | null;
  gamepassUrl?: string | null;
  gamepassId?: string | null;
  splitCount?: number;
  completedAt?: string | Date | null;
  heldAt?: string | Date | null;
  heldReason?: string | null;
  buyoutErrorCode?: string | null;
  orderSource?: string | null;
  channel?: "tg" | "vk" | null;
}

/** Живая проверка пасса (у клиента). */
export interface JourneyLive {
  isForSale?: boolean | null;
  priceMismatch?: boolean | null;
  livePrice?: number | null;
  expected?: number | null;
}

export type JourneyWho = "buyer" | "us" | "problem";
export type JourneyTone = "wait" | "us" | "bad" | "done" | "muted";
export type JourneyStepState = "done" | "current" | "bad" | "todo";
export type JourneyGroup = "Код и ник" | "Геймпасс" | "Выкуп";

export interface JourneyItem {
  who: JourneyWho;
  text: string;
  sub?: string;
  at: string;
  group: JourneyGroup;
  /** Есть только во «Всей истории»: кто из админов отправил. */
  by?: string;
}

export type JourneyNext =
  | { kind: "nick-passes"; title: string; reason: string }
  | { kind: "step"; step: BuyerStepKind; title: string; reason: string }
  | { kind: "contact"; title: string; reason: string };

export interface BuyerJourney {
  steps: { key: "code" | "nick" | "pass" | "buyout" | "robux"; label: string; state: JourneyStepState }[];
  now: { text: string; tone: JourneyTone; since: string | null; detail?: string };
  /** Три последних касания, новые сверху. */
  touches: JourneyItem[];
  /** Вся история по порядку. */
  history: JourneyItem[];
  next: JourneyNext | null;
}

const HOUR = 3_600_000;
const iso = (value: string | Date) => new Date(value).toISOString();
const ms = (value: string | Date) => new Date(value).getTime();

const STAGE_WORD: Record<string, string> = {
  key: "по ключу", passid: "про Pass ID", sale: "про продажу и цену", place: "по плейсу",
};

/** Что ждём, когда последним мы отправили этот пункт. */
const WAIT_FOR_STEP: Record<BuyerStepKind, string> = {
  create: "пасс", key: "ключ", link: "ссылку на пасс", passid: "Pass ID",
  sale: "цену и продажу", nick: "ник", place: "плейс", custom: "ответ",
};

/** Где бот не понял → какую часть инструкции дать. */
const STEP_FOR_DEAD_END: Record<string, BuyerStepKind> = {
  key_format: "key", link_format: "passid", nick_format: "nick", key_no_nick: "nick",
};

const STEP_STATUSES = ["AWAITING_GAMEPASS", "REJECTED", "PENDING"];

function stepLabel(kind: unknown): string {
  return BUYER_STEP_OPTIONS.find((o) => o.kind === kind)?.label ?? String(kind ?? "инструкцию");
}

function channelWord(channel: unknown): string {
  return channel === "tg" ? "Telegram" : channel === "vk" ? "VK" : "";
}

/** Событие → строка истории. `null` — событие пути не касается. */
export function journeyItem(event: JourneyEventRow): JourneyItem | null {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const at = iso(event.createdAt);
  switch (event.type) {
    case "AUDIT_NICK_ENTERED":
      return { who: "buyer", text: `Ввёл ник ${String(p.nick ?? "")}`.trim(), at, group: "Код и ник" };
    case "AUDIT_GAMEPASS_SUBMITTED":
      return {
        who: "buyer", text: "Прислал геймпасс",
        sub: [p.gamepassId ? String(p.gamepassId) : null, p.price ? `${Number(p.price).toLocaleString("ru-RU")} R$` : null].filter(Boolean).join(" · ") || undefined,
        at, group: "Геймпасс",
      };
    case "AUDIT_GAMEPASS_AUTOCREATED":
      return { who: "us", text: "🔑 Создали пасс по его ключу", sub: p.gamepassId ? String(p.gamepassId) : undefined, at, group: "Геймпасс" };
    case BUYER_STEP_EVENT.SENT: {
      const delivered = p.channel === "tg" || p.channel === "vk";
      return {
        who: delivered ? "us" : "problem",
        text: `📨 Отправили: ${stepLabel(p.kind)}`,
        sub: delivered ? `${channelWord(p.channel)} ✓` : "не доставлено — бот закрыт",
        at, group: "Геймпасс",
        by: typeof p.by === "string" ? p.by : undefined,
      };
    }
    case BUYER_STEP_EVENT.DEAD_END: {
      const reason = DEAD_END_REASONS[p.reason as keyof typeof DEAD_END_REASONS] ?? String(p.reason ?? "");
      return { who: "problem", text: "😵 Бот не понял", sub: reason, at, group: "Геймпасс" };
    }
    case PLACE_HELP_EVENT:
      return { who: "problem", text: "🆕 Нет игры на аккаунте", sub: "показали шаги Roblox Studio", at, group: "Геймпасс" };
    case GUIDE_OPENED_EVENT: {
      const where = STAGE_WORD[String(p.stage ?? "")];
      return {
        who: "buyer", text: `👀 Открыл инструкцию${where ? ` ${where}` : ""}`,
        sub: p.device === "mobile" ? "с телефона" : p.device === "pc" ? "с компьютера" : undefined,
        at, group: "Геймпасс",
      };
    }
    case "PAYMENT_CONFIRMED":
    case "MANUAL_PAYMENT_CONFIRMED":
      return { who: "buyer", text: "Оплатил", at, group: "Код и ник" };
    case "ORDER_STATUS_CHANGED": {
      const to = String(p.to ?? "");
      if (to === "PENDING") return { who: "us", text: "Встал в очередь на выкуп", at, group: "Выкуп" };
      if (to === "COMPLETED") return { who: "us", text: "✅ Выкуплен — робуксы в Pending", at, group: "Выкуп" };
      if (to === "ERROR") return { who: "problem", text: "⚠️ Ошибка выкупа", sub: p.reason ? String(p.reason) : undefined, at, group: "Выкуп" };
      if (to === "REJECTED") return { who: "problem", text: "Заказ отменён", sub: p.reason ? String(p.reason) : undefined, at, group: "Выкуп" };
      return null;
    }
    default:
      return null;
  }
}

function fmtWait(fromMs: number, nowMs: number): string {
  const min = Math.max(0, Math.round((nowMs - fromMs) / 60_000));
  if (min < 60) return `${Math.max(1, min)} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  return `${Math.floor(h / 24)} д`;
}

export { fmtWait as journeyWaitText };

export function buyerJourney(
  order: JourneyOrder,
  events: readonly JourneyEventRow[],
  live?: JourneyLive | null,
  nowMs: number = Date.now(),
): BuyerJourney {
  const status = order.status;
  const direct = !!order.isDirectOrder;
  const hasPass = !!order.gamepassUrl || !!order.gamepassId || (order.splitCount ?? 0) > 0;
  const nick = order.robloxUsername ?? null;
  const guess = !nick ? order.probableNick ?? null : null;

  /* ── История ─────────────────────────────────────────────────────────── */
  const sorted = [...events].sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const history: JourneyItem[] = [];
  const channel = channelWord(order.channel);
  history.push({
    who: "buyer",
    text: direct ? "Оформил прямой заказ" : order.orderSource === "SITE" ? "Оформил заказ на сайте" : "Ввёл код",
    sub: !direct && order.orderSource !== "SITE" && channel ? channel : undefined,
    at: iso(order.createdAt), group: "Код и ник",
  });
  if (guess && order.probableNickAt) {
    history.push({ who: "us", text: `Ник ${guess}`, sub: "вероятный, из поиска", at: iso(order.probableNickAt), group: "Код и ник" });
  }
  for (const event of sorted) {
    const item = journeyItem(event);
    if (item) history.push(item);
  }
  history.sort((a, b) => ms(a.at) - ms(b.at));
  const touches = history.slice(1).reverse().slice(0, 3);

  /* ── Шаги ────────────────────────────────────────────────────────────── */
  const unpaid = status === "AWAITING_PAYMENT" || status === "PAYMENT_PENDING";
  const passBad = live?.isForSale === false || (!!live?.priceMismatch && live.livePrice != null) || order.buyoutErrorCode === "REGIONAL_PRICE";
  const completed = status === "COMPLETED";
  const rejected = status === "REJECTED" && !hasPass;
  const first: JourneyStepState = unpaid ? "current" : "done";
  // Вероятный ник считаем пройденным шагом: он и так подсвечен жёлтым, а два
  // оранжевых отрезка подряд читались как «застрял на двух шагах сразу».
  const nickState: JourneyStepState = unpaid ? "todo" : nick || guess || hasPass ? "done" : "current";
  const passState: JourneyStepState = completed ? "done"
    : !hasPass ? (nickState === "done" || guess ? "current" : "todo")
      : passBad || status === "ERROR" ? "bad" : "done";
  const buyoutState: JourneyStepState = completed ? "done"
    : status === "ERROR" && hasPass ? "bad"
      : hasPass && !passBad && ["PENDING", "IN_PROGRESS"].includes(status) ? "current" : "todo";
  const robuxState: JourneyStepState = completed ? "done" : "todo";
  const steps: BuyerJourney["steps"] = [
    { key: "code", label: direct || order.orderSource === "SITE" ? "Оплата" : "Код", state: first },
    { key: "nick", label: "Ник", state: rejected ? "todo" : nickState },
    { key: "pass", label: "Пасс", state: rejected ? "todo" : passState },
    { key: "buyout", label: "Выкуп", state: buyoutState },
    { key: "robux", label: "Робуксы", state: robuxState },
  ];

  /* ── Чего ждём ──────────────────────────────────────────────────────── */
  const lastEvent = history[history.length - 1];
  const lastSent = [...sorted].reverse().find((e) => e.type === BUYER_STEP_EVENT.SENT);
  const lastSentAt = lastSent ? ms(lastSent.createdAt) : null;
  const lastSentKind = (lastSent?.payload as Record<string, unknown> | undefined)?.kind as BuyerStepKind | undefined;
  const openedAfterSent = lastSentAt != null && sorted.some((e) => e.type === GUIDE_OPENED_EVENT && ms(e.createdAt) >= lastSentAt);
  const buyerActedAfterSent = lastSentAt != null && history.some((h) => h.who === "buyer" && ms(h.at) > lastSentAt && !h.text.startsWith("👀"));
  const lastAt = lastEvent ? ms(lastEvent.at) : ms(order.createdAt);
  const since = (t: number) => new Date(t).toISOString();

  let now: BuyerJourney["now"];
  const waitFor = (): string => {
    if (lastSentKind && lastSentAt != null && !buyerActedAfterSent) return WAIT_FOR_STEP[lastSentKind] ?? "пасс";
    if (!nick && !guess && !hasPass) return "ник";
    return "пасс";
  };

  if (completed) {
    now = { text: "✅ Выкуплен · робуксы в Pending", tone: "done", since: order.completedAt ? iso(order.completedAt) : null };
  } else if (status === "REJECTED") {
    now = { text: "Заказ отменён", tone: "muted", since: null };
  } else if (order.heldAt) {
    now = { text: "❄️ Заморожен", tone: "muted", since: iso(order.heldAt), detail: order.heldReason ?? undefined };
  } else if (unpaid) {
    now = { text: "⏳ Ждём оплату", tone: "wait", since: iso(order.createdAt) };
  } else if (live?.isForSale === false) {
    now = { text: "⚠️ Пасс снят с продажи", tone: "bad", since: since(lastAt) };
  } else if (live?.priceMismatch && live.livePrice != null) {
    const need = live.expected != null ? ` — нужно ${live.expected.toLocaleString("ru-RU")}` : "";
    now = { text: `⚠️ Пасс за ${live.livePrice.toLocaleString("ru-RU")}${need}`, tone: "bad", since: since(lastAt) };
  } else if (status === "ERROR") {
    now = { text: "⚠️ Ошибка выкупа", tone: "bad", since: since(lastAt), detail: order.buyoutErrorCode ?? undefined };
  } else if (hasPass && ["PENDING", "IN_PROGRESS"].includes(status)) {
    now = { text: status === "IN_PROGRESS" ? "🛒 Выкупается" : "🛒 Готов к выкупу", tone: "us", since: since(lastAt) };
  } else if (lastEvent?.who === "problem" && lastEvent.text.startsWith("😵")) {
    now = { text: "😵 Бот не понял", tone: "wait", since: lastEvent.at, detail: lastEvent.sub };
  } else {
    const what = waitFor();
    const from = lastSentAt != null && !buyerActedAfterSent ? lastSentAt : lastAt;
    const detail = lastSentAt != null && !buyerActedAfterSent
      ? (openedAfterSent ? "инструкцию открыл" : "инструкцию не открыл")
      : undefined;
    now = { text: `⏳ Ждём ${what}`, tone: "wait", since: since(from), detail };
  }

  /* ── Следующий шаг ──────────────────────────────────────────────────── */
  const canStep = STEP_STATUSES.includes(status) && !order.heldAt && !unpaid;
  const step = (kind: BuyerStepKind, reason: string): JourneyNext =>
    canStep
      ? { kind: "step", step: kind, title: `📨 Отправить: ${stepLabel(kind)}`, reason }
      : { kind: "contact", title: "✉ Написать покупателю", reason };

  let next: JourneyNext | null = null;
  const waitingPass = !completed && status !== "REJECTED" && !order.heldAt && !unpaid && (!hasPass || passBad || status === "ERROR");
  if (waitingPass) {
    // Последнее НАСТОЯЩЕЕ событие (не «ввёл код» и не вероятный ник).
    const lastRaw = sorted.length > 0 ? sorted[sorted.length - 1] : null;
    const lastProblem = lastRaw && journeyItem(lastRaw)?.who === "problem" ? lastRaw : null;
    const deadEndReason = lastProblem?.type === BUYER_STEP_EVENT.DEAD_END
      ? String((lastProblem.payload as Record<string, unknown> | undefined)?.reason ?? "") : null;
    const sentHoursAgo = lastSentAt != null ? (nowMs - lastSentAt) / HOUR : null;

    if (passBad) next = step("sale", "Пасс не продаётся или стоит не столько — дадим ровно этот кусок инструкции.");
    else if (status === "ERROR") next = { kind: "contact", title: "✉ Написать покупателю", reason: "Выкуп упал — уточнить у покупателя, что с пассом." };
    else if (deadEndReason) next = step(STEP_FOR_DEAD_END[deadEndReason] ?? "link", "Бот его не понял — дадим ту часть, на которой он застрял.");
    else if (lastProblem?.type === PLACE_HELP_EVENT) next = step("place", "На аккаунте нет игры — без плейса ни ключ, ни ссылка не помогут.");
    else if (sentHoursAgo != null && !buyerActedAfterSent && !openedAfterSent && sentHoursAgo >= 6)
      next = { kind: "contact", title: "✉ Написать лично", reason: `Инструкцию не открыл за ${fmtWait(lastSentAt!, nowMs)} — сообщения бота не читает.` };
    else if (sentHoursAgo != null && !buyerActedAfterSent && openedAfterSent && sentHoursAgo >= 24)
      next = step("custom", "Инструкцию открыл, но молчит больше суток — спросить, что не получается.");
    else if (nick || guess) next = { kind: "nick-passes", title: "🔎 Проверить пассы ника", reason: "Ник известен — пасс может уже быть на аккаунте, тогда покупателю ничего делать не нужно." };
    else next = step("nick", "Без ника не найти аккаунт — с ником дальше можем искать пасс сами.");
  }

  return { steps, now, touches, history, next };
}

/** Сколько ждём — для строки «Ждём ключ · 2 ч». */
export function journeySinceText(journey: BuyerJourney, nowMs: number = Date.now()): string | null {
  return journey.now.since ? fmtWait(ms(journey.now.since), nowMs) : null;
}
