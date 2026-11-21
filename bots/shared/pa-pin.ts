/* ─────────────────────────────────────────────────────────────────────────────
   📌 Закреп заказа в переписке поддержки @RobloxBank_PA (15.11.2026, владелец:
   «клиентский закреп обязательно, и он и мы должны всё видеть в диалоге»).

   Закреп в личном чате общий: его видят и покупатель, и все, кто сидит в
   аккаунте. Поэтому здесь только то, что можно сказать клиенту: код WB,
   номинал, ник и этап простыми словами. Ни заморозок, ни пометок, ни сроков
   зачисления (правило клиентских текстов).

   Модуль чистый: заказы → текст и решение «ставить ли». Сеть — в
   `bots/tg/pa-desk-worker.ts` (сессия аккаунта, не бот: у бизнес-бота окно
   24 ч, а закреп правится и через неделю).
   ───────────────────────────────────────────────────────────────────────── */

export interface PinOrder {
  wbCode: string;
  amount: number;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  heldAt: Date | null;
  robloxUsername: string | null;
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Заказ кода Robux (17.11.2026) идёт в закреп рядом с WB-заказами под своими
 * статусами: `CODE_PAID` — оплачен, код готовим; `CODE_ISSUED` — выдан
 * (`completedAt` = момент выдачи). `wbCode` у него — номер `CODE-…`, но клиенту
 * этот номер НЕ показываем: он длинный и технический, заказ узнаётся по
 * номиналу и дате («код Robux от 17 ноября»).
 */
export const CODE_PIN_STATUS = { PAID: "CODE_PAID", ISSUED: "CODE_ISSUED" } as const;

const ACTIVE = new Set(["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR", CODE_PIN_STATUS.PAID]);
const DONE = new Set(["COMPLETED", CODE_PIN_STATUS.ISSUED]);
const DAY = 86_400_000;
/**
 * Выкупленные за 45 дней показываем рядом с живыми; дальше — только последний.
 * Новый закреп ставим ЛЮБОМУ, кто написал в поддержку и у кого есть живой или
 * выкупленный заказ (15.11.2026, владелец: «сделай чтобы так было, если пишут» —
 * клиентка с выкупом 22.10 закреп не получила, окно было 3 дня). Писал за
 * сутки и не больше 5 новых за проход — это проверяет воркер.
 */
const SHOW_DONE_DAYS = 45;
const MAX_ORDERS = 3;

type Stage = { icon: string; word: string };

function stageOf(o: PinOrder, now: number): Stage {
  if (o.heldAt && ACTIVE.has(o.status)) return { icon: "🔎", word: "на проверке — напишем здесь" };
  switch (o.status) {
    case "AWAITING_GAMEPASS": return { icon: "⏳", word: "ждём ваш геймпасс" };
    case "PENDING": return { icon: "🕐", word: "в очереди на выкуп" };
    case "IN_PROGRESS": return { icon: "⚙️", word: "выкупаем" };
    case "ERROR": return { icon: "🔎", word: "проверяем выкуп — напишем здесь" };
    case "COMPLETED":
      return o.completedAt && now - o.completedAt.getTime() < SHOW_DONE_DAYS * DAY
        ? { icon: "✅", word: "выкуплен, Robux в ожидании Roblox (Pending)" }
        : { icon: "✅", word: "выкуплен" };
    case "REJECTED": return { icon: "✖️", word: "отменён" };
    case CODE_PIN_STATUS.PAID: return { icon: "🎟", word: "оплачен, готовим код и пришлём, как только он будет готов" };
    case CODE_PIN_STATUS.ISSUED: return { icon: "✅", word: "код выдан, он в кабинете на сайте" };
    default: return { icon: "•", word: "в работе" };
  }
}

const isDirect = (o: PinOrder) => o.wbCode.startsWith("DIR-");
const isCode = (o: PinOrder) => o.status === CODE_PIN_STATUS.PAID || o.status === CODE_PIN_STATUS.ISSUED;
const dayRu = (d: Date) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
/** Чем клиент узнаёт заказ: код карты WB; у прямого заказа номера клиенту не показываем — дата. */
const orderId = (o: PinOrder) => (isCode(o) ? `код Robux от ${dayRu(o.createdAt)}`
  : isDirect(o) ? `от ${dayRu(o.createdAt)}` : `код <code>${esc(o.wbCode)}</code>`);
const rub = (n: number) => `${n.toLocaleString("ru-RU")} R$`;

/** Какие заказы показать: живые, потом свежие выкупленные; не больше трёх. */
export function pinOrders(orders: PinOrder[], now = Date.now()): PinOrder[] {
  const byNew = [...orders].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const active = byNew.filter((o) => ACTIVE.has(o.status));
  const recentDone = byNew.filter((o) => DONE.has(o.status) && o.completedAt && now - o.completedAt.getTime() < SHOW_DONE_DAYS * DAY);
  const shown = [...active, ...recentDone].slice(0, MAX_ORDERS);
  return shown.length ? shown : byNew.slice(0, 1);
}

/** Ставить ли НОВЫЙ закреп (уже стоящий правится всегда). */
export function pinWorthCreating(orders: PinOrder[], now = Date.now()): boolean {
  void now;
  return orders.some((o) => ACTIVE.has(o.status) || DONE.has(o.status));
}

/**
 * Компактно (15.11.2026, владелец: «уебищно выглядит, спам какой-то»): одна
 * строка на заказ, общий ник и общий этап — один раз, ссылка в бот — одной
 * строкой. Начало «📌 Ваш заказ / Ваши заказы» не менять: по нему бизнес-бот
 * отличает закреп от живого ответа оператора (pa-business.ts).
 */
export function pinText(orders: PinOrder[], now = Date.now()): string | null {
  const shown = pinOrders(orders, now);
  if (!shown.length) return null;
  const stages = shown.map((o) => stageOf(o, now));
  const nicks = [...new Set(shown.map((o) => o.robloxUsername).filter(Boolean))] as string[];
  const nickLine = nicks.length === 1 ? `Ник Roblox: <code>${esc(nicks[0])}</code>` : null;
  const footer = `Подробности и инструкция — <a href="https://t.me/RobloxBankBot?start=order">в боте, «📦 Мой заказ»</a>. Не нашли ответа — пишите сюда.`;

  if (shown.length === 1) {
    const [o] = shown;
    return [
      `📌 Ваш заказ · ${rub(o.amount)} · ${orderId(o)}`,
      ...(nickLine ? [nickLine] : []),
      `${stages[0].icon} ${stages[0].word[0].toUpperCase()}${stages[0].word.slice(1)}`,
      "",
      footer,
    ].join("\n");
  }

  const sameStage = stages.every((st) => st.word === stages[0].word);
  const lines = shown.map((o, i) => {
    const nick = nicks.length > 1 && o.robloxUsername ? ` · <code>${esc(o.robloxUsername)}</code>` : "";
    return `${stages[i].icon} ${rub(o.amount)} · ${orderId(o)}${nick}${sameStage ? "" : ` — ${stages[i].word}`}`;
  });
  const common = sameStage
    ? [`${stages[0].word.replace(/^выкуплен/, "Все выкуплены").replace(/^(.)/, (c) => c.toUpperCase())}`]
    : [];
  return [
    "📌 Ваши заказы",
    ...(nickLine ? [nickLine] : []),
    "",
    ...lines,
    ...common,
    "",
    footer,
  ].join("\n");
}
