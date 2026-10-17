/**
 * ❄️ Заморозка заказа — «не выкупать, но и не удалять».
 *
 * Зачем отдельный признак, а не статус
 * ────────────────────────────────────
 * `ERROR` — рабочий статус: в нём живут ПОЧИНИМЫЕ заказы (региональная цена,
 * снятый с продажи пасс), кнопка «↩ Вернуть к выкупу» и «Повторить выкуп».
 * Заказ, который нельзя выкупать никогда, лежал в той же куче и отличался
 * только текстом заметки — одного нажатия хватало, чтобы вернуть его в очередь
 * и потратить робуксы. Заморозка — признак ПОВЕРХ статуса: заказ остаётся, где
 * был, но физически выключен из всех путей выкупа.
 *
 * Почему ключ — код, а не id заказа
 * ─────────────────────────────────
 * Код выдаётся покупателю раньше, чем бот создаёт заказ. Случай 84CR7UZ: код на
 * руках, заказа ещё нет, а выкупать его уже нельзя. Заморозка по id заставила
 * бы ловить момент создания вручную; по коду она ставится заранее и садится на
 * заказ сама. `WbOrder.wbCode` уникален — у одной заморозки не больше одного
 * заказа, поэтому все операции здесь работают через `findUnique`.
 *
 * Этот файл — ЕДИНСТВЕННЫЙ источник правил. Боты не умеют импортировать из
 * `src/`, а веб из `bots/shared` умеет (так же живёт `wb-order-source.ts`),
 * поэтому ядро лежит здесь, а `src/lib/order-hold.ts` его переэкспортирует.
 */

/** Маркеры строк заметки. По ним TWA красит строку заморозки отдельно. */
export const HOLD_NOTE_MARK = "[ЗАМОРОЗКА";
export const UNHOLD_NOTE_MARK = "[РАЗМОРОЗКА";

/** Причина обязательна: через месяц «почему нельзя» не вспомнит никто. */
export const HOLD_REASON_MAX = 300;

/** Заготовки причин в модалке TWA. Текст можно дописать руками. */
export const HOLD_PRESETS = [
  "1 звезда на WB — не выкупать",
  "Подозрение на фрод",
  "Спор / чарджбэк",
  "Разбор вручную",
] as const;

/**
 * Предикат «не заморожен» для КАЖДОЙ очереди выкупа.
 *
 * Держится отдельной константой, чтобы новая вкладка не забыла его добавить:
 * тест `order-hold.test.ts` проверяет, что все рабочие ветки `buildTabWhere`
 * его содержат.
 */
export const NOT_HELD = { heldAt: null } as const;

/** Тот же предикат для сырых SQL-счётчиков вкладок (зеркало `NOT_HELD`). */
export const NOT_HELD_SQL = `"heldAt" IS NULL`;

export interface HeldFields {
  heldAt?: Date | string | null;
  heldReason?: string | null;
  heldBy?: string | null;
}

export function isHeld(order: HeldFields | null | undefined): boolean {
  return !!order?.heldAt;
}

/** Текст отказа. Один и тот же в TWA, в TG-боте и в автовыкупе. */
export function heldRefusal(reason?: string | null): string {
  const why = (reason ?? "").trim() || "причина не указана";
  return `❄️ Заказ заморожен — выкуп заблокирован.\nПричина: ${why}\nСними заморозку в карточке, если это ошибка.`;
}

/** Нормализация причины: пустую не принимаем, длинную режем. */
export function normalizeHoldReason(raw: unknown): string | null {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (!reason) return null;
  return reason.slice(0, HOLD_REASON_MAX);
}

/** Код в верхнем регистре без пробелов — так он лежит и в WbOrder, и в WbCode. */
export function normalizeHoldCode(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toUpperCase() : "";
}

function stamp(): string {
  return new Date().toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/** Дописать строку в начало заметки — свежее сверху, история не затирается. */
export function prependNote(existing: string | null | undefined, line: string): string {
  return (existing ? `${line}\n${existing}` : line).slice(0, 2000);
}

export function holdNoteLine(reason: string, actor: string): string {
  return `${HOLD_NOTE_MARK} ${stamp()} · ${actor}] ${reason}`;
}

/**
 * Уже есть строка заморозки с этой причиной?
 *
 * Штамп меняется каждую минуту, поэтому сравнивать целые строки бесполезно —
 * сравниваем причину внутри строки заморозки. Нужно, если заказ помечается
 * повторно при живой заморозке: заметка не должна расти на строку за раз.
 */
export function hasHoldNoteFor(note: string | null | undefined, reason: string): boolean {
  if (!note) return false;
  return note
    .split("\n")
    .some((line) => line.startsWith(HOLD_NOTE_MARK) && line.endsWith(`] ${reason}`));
}

/**
 * Проставить заморозку на заказ. Общая точка для крон-свипа и гарда выкупа —
 * оба сажают на заказ заморозку, поставленную на код раньше него.
 */
export async function stampHoldOnOrder(
  db: any,
  order: { id: string; adminNote: string | null },
  hold: { reason: string; createdBy: string },
): Promise<void> {
  await db.wbOrder.update({
    where: { id: order.id },
    data: {
      heldAt: new Date(),
      heldReason: hold.reason,
      heldBy: hold.createdBy,
      ...(hasHoldNoteFor(order.adminNote, hold.reason)
        ? {}
        : { adminNote: prependNote(order.adminNote, holdNoteLine(hold.reason, hold.createdBy)) }),
    },
  });
}

export function unholdNoteLine(actor: string): string {
  return `${UNHOLD_NOTE_MARK} ${stamp()} · ${actor}] заморозка снята`;
}

/* ── Работа с БД ───────────────────────────────────────────────────────────
   `db` типизирован как `any`: у ботов и у веба разные инстансы PrismaClient, а
   до `prisma generate` новых полей нет ни в одном из них (см. bots/shared/db.ts).
   ───────────────────────────────────────────────────────────────────────── */

export interface HoldResult {
  ok: boolean;
  error?: string;
  /** Заморозка села на существующий заказ (а не только на код). */
  orderAffected?: boolean;
  /** Заказа по коду ещё нет — заморозка ждёт его создания. */
  awaitingOrder?: boolean;
}

/**
 * Заморозить по коду. Идемпотентна: повторный вызов обновляет причину и автора,
 * но не плодит записи и не дублирует строку в заметке.
 */
export async function holdByCode(
  db: any,
  input: { wbCode: string; reason: string; actor: string },
): Promise<HoldResult> {
  const wbCode = normalizeHoldCode(input.wbCode);
  const reason = normalizeHoldReason(input.reason);
  const actor = (input.actor || "админ").trim();

  if (!wbCode) return { ok: false, error: "Не указан код" };
  if (!reason) return { ok: false, error: "Причина заморозки обязательна" };

  const now = new Date();
  await db.orderHold.upsert({
    where:  { wbCode },
    create: { wbCode, reason, createdBy: actor },
    // Разморозили и морозим снова — это та же запись с новой причиной, а не
    // висящий `releasedAt` от прошлого раза.
    update: { reason, createdBy: actor, createdAt: now, releasedAt: null, releasedBy: null },
  });

  const order = await db.wbOrder.findUnique({
    where:  { wbCode },
    select: { id: true, adminNote: true, heldAt: true },
  });
  if (!order) return { ok: true, orderAffected: false, awaitingOrder: true };

  await db.wbOrder.update({
    where: { id: order.id },
    data: {
      heldAt: now,
      heldReason: reason,
      heldBy: actor,
      // Уже замороженный заказ не получает вторую строку в заметке — иначе
      // правка причины засоряет историю.
      ...(order.heldAt ? {} : { adminNote: prependNote(order.adminNote, holdNoteLine(reason, actor)) }),
    },
  });

  return { ok: true, orderAffected: true, awaitingOrder: false };
}

/** Снять заморозку. Запись `OrderHold` остаётся — помечается `releasedAt`. */
export async function releaseByCode(
  db: any,
  input: { wbCode: string; actor: string },
): Promise<HoldResult> {
  const wbCode = normalizeHoldCode(input.wbCode);
  const actor = (input.actor || "админ").trim();
  if (!wbCode) return { ok: false, error: "Не указан код" };

  const hold = await db.orderHold.findUnique({ where: { wbCode }, select: { id: true, releasedAt: true } });
  const order = await db.wbOrder.findUnique({
    where:  { wbCode },
    select: { id: true, adminNote: true, heldAt: true },
  });

  if (!hold && !order?.heldAt) return { ok: false, error: "Заморозки на этом коде нет" };

  const now = new Date();
  if (hold && !hold.releasedAt) {
    await db.orderHold.update({ where: { wbCode }, data: { releasedAt: now, releasedBy: actor } });
  }
  if (order?.heldAt) {
    await db.wbOrder.update({
      where: { id: order.id },
      data: {
        heldAt: null, heldReason: null, heldBy: null,
        adminNote: prependNote(order.adminNote, unholdNoteLine(actor)),
      },
    });
  }
  return { ok: true, orderAffected: !!order?.heldAt };
}

/**
 * Гард перед тратой робуксов. Стоит во ВСЕХ путях выкупа.
 *
 * Смотрит не только на денормализованное поле заказа, но и на `OrderHold` —
 * это закрывает окно между «бот создал заказ по заранее замороженному коду» и
 * «крон-свип его пометил». Если заморозка нашлась только в `OrderHold` —
 * заодно проставляет её на заказ (само-починка).
 */
export async function assertOrderNotHeld(
  db: any,
  orderId: string,
): Promise<{ held: false } | { held: true; reason: string; message: string }> {
  const order = await db.wbOrder.findUnique({
    where:  { id: orderId },
    select: { id: true, wbCode: true, adminNote: true, heldAt: true, heldReason: true },
  });
  if (!order) return { held: false };

  if (order.heldAt) {
    const reason = order.heldReason ?? "";
    return { held: true, reason, message: heldRefusal(reason) };
  }

  const hold = await db.orderHold.findUnique({
    where:  { wbCode: order.wbCode },
    select: { reason: true, createdBy: true, releasedAt: true },
  });
  if (!hold || hold.releasedAt) return { held: false };

  await stampHoldOnOrder(db, order, hold)
    .catch(() => { /* пометка — не повод пропустить блокировку */ });

  return { held: true, reason: hold.reason, message: heldRefusal(hold.reason) };
}

/**
 * Крон-свип: активные заморозки садятся на заказы, созданные после них.
 *
 * Покрывает все 11 мест, где рождается `WbOrder`, не трогая ни одно из них.
 * Гонку «заказ создан, свип ещё не прошёл» закрывает `assertOrderNotHeld`
 * прямо в путях выкупа — свип отвечает за то, чтобы заказ выглядел
 * замороженным в ленте, а не за безопасность траты.
 */
export async function sweepPendingHolds(db: any): Promise<number> {
  const holds = await db.orderHold.findMany({
    where:  { releasedAt: null },
    select: { wbCode: true, reason: true, createdBy: true },
  });
  if (holds.length === 0) return 0;

  let applied = 0;
  for (const hold of holds) {
    const order = await db.wbOrder.findUnique({
      where:  { wbCode: hold.wbCode },
      select: { id: true, adminNote: true, heldAt: true },
    });
    if (!order || order.heldAt) continue;
    await stampHoldOnOrder(db, order, hold);
    applied++;
  }
  return applied;
}

/** Активные заморозки для набора кодов — пакетная проверка автовыкупа. */
export async function activeHoldCodes(db: any, codes: string[]): Promise<Set<string>> {
  if (codes.length === 0) return new Set();
  const rows = await db.orderHold.findMany({
    where:  { wbCode: { in: codes }, releasedAt: null },
    select: { wbCode: true },
  });
  return new Set(rows.map((r: { wbCode: string }) => r.wbCode));
}

/* ── Признак «замороженный клиент» для алертов поддержки ─────────────────── */

export interface HeldCustomer {
  /** Причина самой свежей заморозки — её и показываем в шапке алерта. */
  reason: string;
  /** Все коды этого клиента под заморозкой. */
  codes: string[];
}

/**
 * Замороженный ли это клиент.
 *
 * Ищем по ВСЕМ заказам пользователя, а не по одному: человек может написать
 * про другой свой заказ, а помечать его надо всё равно. Никогда не бросает —
 * алерт поддержки важнее, чем эта пометка в нём.
 */
export async function heldCustomerFor(
  db: any,
  where: { tgId?: string | null; vkId?: string | null },
): Promise<HeldCustomer | null> {
  try {
    const tgId = where.tgId ? String(where.tgId) : null;
    const vkId = where.vkId ? String(where.vkId) : null;
    if (!tgId && !vkId) return null;

    const user = await db.user.findFirst({
      where:  tgId ? { tgId } : { vkId },
      select: { id: true },
    });
    if (!user) return null;

    const orders = await db.wbOrder.findMany({
      where:   { userId: user.id, heldAt: { not: null } },
      orderBy: { heldAt: "desc" },
      select:  { wbCode: true, heldReason: true },
      take:    10,
    });
    if (orders.length === 0) return null;

    return {
      reason: orders[0].heldReason ?? "причина не указана",
      codes:  orders.map((o: { wbCode: string }) => o.wbCode),
    };
  } catch {
    return null;
  }
}
