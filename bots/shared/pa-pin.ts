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

const ACTIVE = new Set(["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR"]);
const DAY = 86_400_000;
/** Выкупленный заказ держим в закрепе ещё две недели — вопросы «где робуксы» идут после. */
const SHOW_DONE_DAYS = 14;
/** Новый закреп ставим только по живому заказу или выкупленному за 3 дня. */
const CREATE_DONE_DAYS = 3;
const MAX_ORDERS = 3;

function stageText(o: PinOrder): string {
  if (o.heldAt && ACTIVE.has(o.status)) return "🔎 на проверке у поддержки — напишем здесь";
  switch (o.status) {
    case "AWAITING_GAMEPASS": return "⏳ ждём ваш геймпасс";
    case "PENDING": return "🕐 в очереди на выкуп";
    case "IN_PROGRESS": return "⚙️ выкупаем геймпасс";
    case "ERROR": return "🔎 проверяем выкуп — напишем здесь";
    case "COMPLETED": return "✅ выкуплен — Robux придут после проверки Roblox (Pending)";
    case "REJECTED": return "✖️ отменён";
    default: return "в работе";
  }
}

/** Какие заказы показать: живые, потом свежие выкупленные; не больше трёх. */
export function pinOrders(orders: PinOrder[], now = Date.now()): PinOrder[] {
  const byNew = [...orders].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const active = byNew.filter((o) => ACTIVE.has(o.status));
  const recentDone = byNew.filter((o) => o.status === "COMPLETED" && o.completedAt && now - o.completedAt.getTime() < SHOW_DONE_DAYS * DAY);
  const shown = [...active, ...recentDone].slice(0, MAX_ORDERS);
  return shown.length ? shown : byNew.slice(0, 1);
}

/** Ставить ли НОВЫЙ закреп (уже стоящий правится всегда). */
export function pinWorthCreating(orders: PinOrder[], now = Date.now()): boolean {
  return orders.some((o) => ACTIVE.has(o.status)
    || (o.status === "COMPLETED" && o.completedAt && now - o.completedAt.getTime() < CREATE_DONE_DAYS * DAY));
}

export function pinText(orders: PinOrder[], now = Date.now()): string | null {
  const shown = pinOrders(orders, now);
  if (!shown.length) return null;
  const blocks = shown.map((o) => [
    // <code> — копируется одним нажатием (и у клиента, и у нас).
    `🎟 Код WB: <code>${esc(o.wbCode)}</code> · ${o.amount.toLocaleString("ru-RU")} Robux`,
    ...(o.robloxUsername ? [`👤 Ник Roblox: <code>${esc(o.robloxUsername)}</code>`] : []),
    `Статус: ${stageText(o)}`,
  ].join("\n"));
  return [
    shown.length > 1 ? "📌 Ваши заказы в RobloxBank" : "📌 Ваш заказ в RobloxBank",
    "",
    blocks.join("\n\n"),
    "",
    // Вопросы «где робуксы» и «что дальше» — в бот: там статус, инструкция и таймер
    // Pending, а поддержке остаются настоящие проблемы (15.11.2026, владелец).
    "Всё о заказе — что делать дальше, инструкция, где Robux — в боте @RobloxBankBot, кнопка «📦 Мой заказ». Там ответ сразу.",
    "Сюда пишите, если в боте не нашли ответа.",
  ].join("\n");
}
