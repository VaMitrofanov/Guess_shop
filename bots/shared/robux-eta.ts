/**
 * «Где мои робуксы?» — ответ про Pending у Roblox.
 *
 * До 23.10.2026 бот сам напоминал на 5-й и 7-й день, с 23.10 показывал личный
 * таймер «до 7 дней». С 26.10.2026 (решение владельца) срока нет вовсе: Roblox
 * стал держать Pending дольше 7 дней, и любая названная дата превращалась в
 * нарушенное обещание и новое обращение «а где?». Теперь мысль одна: если
 * робуксы в Pending — с нашей стороны всё, дальше решает Roblox. Проверка —
 * ЧИСЛО в строке Pending Robux, а не прошедшие дни.
 *
 * Модуль — единственный источник этих текстов для ботов. Зеркало для
 * Next-роутов — `src/lib/twa-notify.ts` (bots/ и src/ друг друга не импортируют).
 */

/** Старше этого вопрос уже не про Pending: карточку не показываем. */
export const ROBUX_ETA_LOOKBACK_DAYS = 30;
/** Сколько заказов перечисляем в одном ответе. */
const MAX_ORDERS = 4;

const DAY_MS = 86_400_000;

export const ROBLOX_TRANSACTIONS_URL = "https://www.roblox.com/transactions";
/** Наша страница «что такое геймпасс и Pending» — со схемой и скриншотами. */
export const PENDING_INFO_URL = "https://robloxbank.ru/pending";

export function fmtDateRu(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
}

/** Главная мысль про Pending — одна на все тексты (26.10.2026). */
export function ourPartDoneText(fmt: RobuxEtaFormat): string {
  return (
    `✅ ${b(fmt, "С нашей стороны всё сделано:")} геймпасс выкуплен, робуксы уже на твоём аккаунте — в статусе Pending. ` +
    `Дальше всё зависит от Roblox: он сам решает, когда перевести их на баланс. Ускорить это не может ни наша поддержка, ни мы.`
  );
}

// ── Распознавание вопроса ───────────────────────────────────────────────────

/** О чём речь: робуксы, баланс, Pending. «рб»/«r$» — только отдельным словом. */
const ROBUX_RE = /робук|робак|робас|роблокс[а-я]* валют|robux|рбх|(?<![\p{L}\p{N}])(?:рб|r\$)(?![\p{L}\p{N}])|баланс|пендинг|pending|зачисл/iu;
/** Что спрашивают: где, когда, не пришли… Знак вопроса — тоже вопрос. */
const ASK_RE = /где|когда|сколько\s+(?:ещ[её]\s+)?ждать|не\s*приш|не\s*приход|не\s*вижу|не\s*видно|нету|(?<![\p{L}])нет(?![\p{L}])|не\s*зачисл|не\s*получ|не\s*дош|не\s*поступ|долго|до\s+сих\s+пор|почему|скоро|\?/iu;

/**
 * Похоже ли сообщение на «где мои робуксы?».
 *
 * Нужны оба признака: слово про робуксы и вопрос/жалоба. Так «робуксы пришли,
 * спасибо» и ник `Robux_King` мимо, а «робуксов нет», «когда придут робуксы»,
 * «где мои рб?» — попадают. Длинные тексты не трогаем: это уже рассказ для
 * менеджера, а не вопрос про срок.
 */
export function isRobuxQuestion(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/ё/g, "е");
  if (t.length < 4 || t.length > 300) return false;
  if (/https?:\/\//.test(t)) return false;
  return ROBUX_RE.test(t) && ASK_RE.test(t);
}

/** Про поступление вообще: «когда придут?», «ничего не пришло», «где мой заказ».
 *  Без слова «робуксы» — поэтому только вместе с вопросом, коротко и только у
 *  того, у кого есть свежий выкуп (это проверяет `loadRobuxEtaOrders`). */
const ARRIVAL_RE = /приш|приход|придут|прид[её]т|получ|зачисл|начисл|дош|поступ|появ|где\s+(?:мо[йиеё]|заказ)/iu;

export function isArrivalQuestion(text: string): boolean {
  if (isRobuxQuestion(text)) return true;
  const t = text.trim().toLowerCase().replace(/ё/g, "е");
  if (t.length < 4 || t.length > 200) return false;
  if (/https?:\/\//.test(t)) return false;
  return ARRIVAL_RE.test(t) && ASK_RE.test(t);
}

// ── Тексты ──────────────────────────────────────────────────────────────────

export interface RobuxEtaOrder {
  amount: number;
  completedAt: Date;
  /** Аккаунт Roblox заказа — на него ушли робуксы. */
  robloxUsername?: string | null;
  wbCode?: string | null;
}

export type RobuxEtaFormat = "html" | "plain";

export interface RobuxEtaReply {
  text: string;
}

function b(fmt: RobuxEtaFormat, s: string): string {
  return fmt === "html" ? `<b>${s}</b>` : s;
}

/** Отсеивает старое и сортирует: свежий выкуп сверху. */
export function etaOrders(orders: RobuxEtaOrder[], now: Date = new Date()): RobuxEtaOrder[] {
  const from = now.getTime() - ROBUX_ETA_LOOKBACK_DAYS * DAY_MS;
  return orders
    .filter((o) => o.completedAt.getTime() >= from && o.completedAt.getTime() <= now.getTime())
    .sort((x, y) => y.completedAt.getTime() - x.completedAt.getTime())
    .slice(0, MAX_ORDERS);
}

/** «Проверить: Transactions → Pending Robux, число не меньше N». */
function checkLine(fmt: RobuxEtaFormat, amount: number | null): string {
  const link = fmt === "html"
    ? `<a href="${ROBLOX_TRANSACTIONS_URL}">roblox.com/transactions</a>`
    : ROBLOX_TRANSACTIONS_URL;
  const need = amount ? `не меньше ${amount}` : "не меньше суммы заказа";
  return `🔍 Проверить: ${link} → строка ${b(fmt, "Pending Robux")}, там должно быть число ${need}. Есть — всё в порядке, робуксы придут сами.`;
}

/**
 * Полный ответ на «где мои робуксы?». `null` — показывать нечего (выкупленных
 * заказов за 30 дней нет), вопрос идёт своим обычным путём.
 */
export function buildRobuxEtaReply(
  ordersIn: RobuxEtaOrder[],
  fmt: RobuxEtaFormat,
  now: Date = new Date(),
): RobuxEtaReply | null {
  const orders = etaOrders(ordersIn, now);
  if (orders.length === 0) return null;
  const lines: string[] = [];

  if (orders.length === 1) {
    const o = orders[0];
    lines.push(`⏳ ${b(fmt, `Робуксы за заказ на ${o.amount} R$ — в Pending у Roblox`)}`);
    lines.push(`Выкупили: ${fmtDateRu(o.completedAt)}`);
  } else {
    lines.push(`⏳ ${b(fmt, "Твои робуксы — в Pending у Roblox")}`);
    for (const o of orders) lines.push(`• ${b(fmt, `${o.amount} R$`)} · выкупили ${fmtDateRu(o.completedAt)}`);
  }
  lines.push("");
  lines.push(ourPartDoneText(fmt));
  lines.push("");
  lines.push(checkLine(fmt, orders.length === 1 ? orders[0].amount : null));
  lines.push("");
  lines.push(`Числа нет или там 0 — нажми «${NO_ROBUX_BUTTON}», проверим вместе.`);
  lines.push("");
  lines.push(confirmHintLine(fmt));
  lines.push("");
  lines.push(infoLine(fmt));
  return { text: lines.join("\n") };
}

/** Кнопка самопроверки под ответом — одна для TG и VK. */
export const NO_ROBUX_BUTTON = "💬 Робуксов нет";

/** Ссылка на объяснение «что такое геймпасс и Pending». */
export function infoLine(fmt: RobuxEtaFormat): string {
  return fmt === "html"
    ? `📖 <a href="${PENDING_INFO_URL}">Как работает геймпасс и почему робуксы «заморожены»</a> — 1 минута, со скриншотами.`
    : `📖 Как работает геймпасс и почему робуксы «заморожены» (1 минута, со скриншотами): ${PENDING_INFO_URL}`;
}

/**
 * «Где робуксы?», когда заказ ещё НЕ выкуплен (24.10.2026). Частый случай:
 * «я оплатил, где робуксы» пишут, пока заказ ждёт геймпасс от самого
 * покупателя. Таймер заморозки тут не к месту — отвечаем этапом заказа.
 */
export function activeOrderLeadText(fmt: RobuxEtaFormat): string {
  return `⏳ ${b(fmt, "Робуксы приходят после выкупа геймпасса, а твой заказ ещё не выкуплен.")} Вот где он сейчас 👇`;
}

// ── Барьер перед поддержкой ─────────────────────────────────────────────────
/*
 * Требование владельца 23.10.2026: «чтобы поддержку лишний раз не дёргали —
 * пробиваться должны только реальные проблемы». Поэтому:
 *  • вопрос «где робуксы» в поддержку не уходит — на него есть ответ про
 *    Pending (до 26.10.2026 — только пока не вышли «7 дней»);
 *  • кнопка «Робуксов нет» (с 26.10.2026 — сразу) ведёт не к менеджеру, а к самопроверке:
 *    Pending есть → это Roblox, ждём; не тот аккаунт → переключись; и только
 *    «строки нет вовсе, аккаунт тот» открывает обращение.
 */

/**
 * Самопроверка «Робуксов нет» (24.10.2026, правка владельца).
 *
 * Раньше спрашивали «строка Pending есть?» — а строка Pending Robux есть на
 * странице Transactions У ВСЕХ ВСЕГДА, просто с нулём. Человек видел строку,
 * жал «есть» и получал «всё в порядке», хотя робуксов не было. Теперь
 * спрашиваем ЧИСЛО в строке: там должен быть номинал заказа, а не 0.
 *
 * «Меньше номинала» сразу требует скриншот Transactions: без него менеджер
 * всё равно первым делом попросит его, а кнопка без скрина превращалась в
 * способ дёрнуть поддержку одним нажатием.
 */

/** Заказ, о котором спрашиваем: самый свежий выкуп. */
export function selfCheckTarget(ordersIn: RobuxEtaOrder[], now: Date = new Date()): RobuxEtaOrder | null {
  return etaOrders(ordersIn, now)[0] ?? null;
}

export interface SelfCheckContext {
  amount?: number | null;
  robloxUsername?: string | null;
}

function amountText(c: SelfCheckContext): string {
  return c.amount ? `${c.amount} R$` : "сумма заказа";
}

/** Шаг самопроверки после кнопки «Робуксов нет». */
export function robuxSelfCheckText(fmt: RobuxEtaFormat, c: SelfCheckContext = {}): string {
  const account = c.robloxUsername
    ? `аккаунт ${b(fmt, c.robloxUsername)} — робуксы зачисляются именно на него, на тот аккаунт, где создан геймпасс`
    : `${b(fmt, "тот аккаунт")}, на который делали заказ — частая причина «робуксов нет» в том, что смотрят другой аккаунт`;
  const link = fmt === "html" ? `<a href="${ROBLOX_TRANSACTIONS_URL}">roblox.com/transactions</a>` : ROBLOX_TRANSACTIONS_URL;
  return (
    `🔍 ${b(fmt, "Давай проверим за минуту")}\n\n` +
    `1. Зайди в Roblox в ${account}.\n` +
    `2. Открой ${link} и найди строку ${b(fmt, "Pending Robux")}.\n\n` +
    `⚠️ Строка Pending Robux есть у всех — важно ${b(fmt, "число")} в ней. ` +
    `Там должно быть ${b(fmt, c.amount ? `не меньше ${c.amount}` : "не меньше суммы заказа")}, а не 0.\n\n` +
    `Какое число видишь?`
  );
}

/** Подписи кнопок самопроверки — общие для TG и VK (у VK лимит 40 символов). */
export function selfCheckButtons(c: SelfCheckContext = {}): { enough: string; low: string; notFound: string } {
  return {
    enough: c.amount ? `✅ ${c.amount} или больше` : "✅ Сумма заказа или больше",
    low: c.amount ? `❌ Меньше ${c.amount} или 0` : "❌ Меньше суммы заказа или 0",
    notFound: "🤷 Не нахожу эту строку",
  };
}

/** «В Pending номинал или больше» — значит всё на месте, ждать Roblox. */
export function robuxPendingSeenText(fmt: RobuxEtaFormat): string {
  return (
    `✅ ${b(fmt, "Значит, всё в порядке — робуксы на твоём аккаунте.")}\n\n` +
    `Число в Pending Robux — это твои робуксы. С нашей стороны всё сделано, дальше решает Roblox: ` +
    `когда перевести их на баланс, он определяет сам, и ускорить это не может ни наша поддержка, ни мы.\n\n` +
    `Ничего делать не нужно: как только Roblox их отпустит, робуксы сами появятся на балансе.\n\n` +
    `${confirmHintLine(fmt)}\n\n` +
    infoLine(fmt)
  );
}

/** «Не нахожу строку» — где она и как выглядит. */
export function robuxPendingWhereText(fmt: RobuxEtaFormat, c: SelfCheckContext = {}): string {
  const link = fmt === "html" ? `<a href="${ROBLOX_TRANSACTIONS_URL}">roblox.com/transactions</a>` : ROBLOX_TRANSACTIONS_URL;
  return (
    `📍 ${b(fmt, "Где искать")}\n\n` +
    `• Открой ${link} в браузере (в приложении Roblox этой страницы нет).\n` +
    `• Войди в аккаунт ${c.robloxUsername ? b(fmt, c.robloxUsername) : "заказа"}.\n` +
    `• Вкладка ${b(fmt, "Summary")} → в таблице строка ${b(fmt, "Pending Robux")}, справа число.\n\n` +
    `Скриншот с подсказкой — на странице: ${PENDING_INFO_URL}\n\n` +
    `Нашёл? Какое там число?`
  );
}

/** Контекст обращения: «в Pending меньше номинала» — только со скриншотом. */
export const ROBUX_LOW_PENDING_CONTEXT = "robux_low_pending";
/** Повтор после «это не страница Transactions» (27.10.2026): второй скрин —
 *  уже менеджеру, без новых просьб, чтобы человек не застрял в цикле. */
export const ROBUX_LOW_PENDING_RETRY_CONTEXT = "robux_low_pending_retry";

/** Скрин нужно прочитать автопроверкой (оба шага «меньше номинала»). */
export function isPendingScreenshotContext(contextKey: string | null | undefined): boolean {
  return contextKey === ROBUX_LOW_PENDING_CONTEXT || contextKey === ROBUX_LOW_PENDING_RETRY_CONTEXT;
}

/** Обращение этого контекста принимается только со скриншотом. */
export function intakeNeedsScreenshot(contextKey: string | null | undefined): boolean {
  return isPendingScreenshotContext(contextKey);
}

/** Просьба о скриншоте после «меньше номинала». */
export function robuxScreenshotRequestText(fmt: RobuxEtaFormat, c: SelfCheckContext = {}): string {
  return (
    `📸 ${b(fmt, "Пришли скриншот страницы Transactions")} — одним фото, сюда в чат.\n\n` +
    `На скрине должны быть видны:\n` +
    `• строка ${b(fmt, "Pending Robux")} с числом;\n` +
    `• ник аккаунта${c.robloxUsername ? ` (${c.robloxUsername})` : ""} в правом верхнем углу.\n\n` +
    `По скрину менеджер сразу проверит выкуп и ответит по делу. Без скриншота обращение не передаётся — ` +
    `проверить «на слово» мы не можем.\n\n` +
    `Передумал — напиши «отмена».`
  );
}

/** Прислал текст вместо скриншота. */
export function robuxScreenshotRepeatText(): string {
  return "📸 Нужен именно скриншот страницы Transactions (фото, не текст) — с ним менеджер сразу проверит выкуп. Пришли его сюда или напиши «отмена».";
}

/** Короткий ответ на повторный вопрос за несколько минут: вся карточка заново
 *  читалась бы как автоответчик, который не слышит. */
export function buildRobuxEtaShort(ordersIn: RobuxEtaOrder[], fmt: RobuxEtaFormat, now: Date = new Date()): string | null {
  if (etaOrders(ordersIn, now).length === 0) return null;
  return (
    `⏳ Всё так же: робуксы в Pending у Roblox. ${b(fmt, "С нашей стороны всё сделано")} — когда перевести их на баланс, решает Roblox.\n` +
    `Если в строке Pending Robux нет суммы заказа — нажми «${NO_ROBUX_BUTTON}».`
  );
}

/**
 * Текст для чата Wildberries: без HTML, без ссылок наружу и без кнопок — WB
 * их не любит. Вместо кнопки «проверить» — просьба прислать скриншот сюда же.
 */
export function buildRobuxEtaWbChat(ordersIn: RobuxEtaOrder[], now: Date = new Date()): RobuxEtaReply | null {
  const orders = etaOrders(ordersIn, now);
  if (orders.length === 0) return null;
  const { amount, completedAt } = orders[0];
  return {
    text:
      `Робуксы за заказ на ${amount} R$ уже на вашем аккаунте Roblox — в статусе Pending. Выкупили: ${fmtDateRu(completedAt)}.\n\n` +
      `С нашей стороны всё сделано. Дальше всё зависит от Roblox: он сам решает, когда перевести робуксы на баланс, ускорить это мы не можем.\n\n` +
      `Проверить можно в Roblox: раздел Transactions, строка Pending Robux — в ней должно быть число не меньше ${amount}. ` +
      `Если там меньше ${amount} и на балансе робуксов тоже нет — пришлите сюда скриншот страницы Transactions, менеджер проверит выкуп.`,
  };
}

/**
 * Защита от повтора: тот же человек спросил снова в течение 10 минут — короткий
 * ответ вместо карточки. Память процесса: после перезапуска бота в худшем
 * случае придёт полная карточка, это не страшно.
 */
const REPEAT_WINDOW_MS = 10 * 60_000;
const lastAnswered = new Map<string, number>();

export function isRepeatEtaQuestion(key: string, now: number = Date.now()): boolean {
  const prev = lastAnswered.get(key);
  lastAnswered.set(key, now);
  if (lastAnswered.size > 5000) {
    for (const [k, at] of lastAnswered) if (now - at > REPEAT_WINDOW_MS) lastAnswered.delete(k);
  }
  return prev !== undefined && now - prev < REPEAT_WINDOW_MS;
}

/** Статусы, при которых у человека есть живой (ещё не выкупленный) заказ: тогда
 *  «где робуксы» — вопрос про этот заказ, и отвечают на него штатные ветки. */
export const ACTIVE_ORDER_STATUSES = ["PAYMENT_PENDING", "AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR"];

/** Минимальный клиент БД для выборки (Prisma `wbOrder`). */
export interface RobuxEtaDb {
  wbOrder: {
    findMany(args: unknown): Promise<Array<{ amount: number; completedAt: Date | null; robloxUsername?: string | null; wbCode?: string | null }>>;
    findFirst(args: unknown): Promise<{ createdAt: Date } | null>;
  };
}

/**
 * Заказы для таймера. `null` — таймер не к месту: выкупленного за 30 дней нет
 * или есть заказ свежее последнего выкупа, который ещё в работе.
 */
export async function loadRobuxEtaOrders(db: RobuxEtaDb, userId: string, now: Date = new Date()): Promise<RobuxEtaOrder[] | null> {
  const rows = await db.wbOrder.findMany({
    where: {
      userId,
      status: "COMPLETED",
      completedAt: { gte: new Date(now.getTime() - ROBUX_ETA_LOOKBACK_DAYS * DAY_MS) },
    },
    orderBy: { completedAt: "desc" },
    take: MAX_ORDERS,
    select: { amount: true, completedAt: true, robloxUsername: true, wbCode: true },
  });
  const orders = rows
    .filter((r) => r.completedAt != null)
    .map((r) => ({
      amount: r.amount,
      completedAt: new Date(r.completedAt as Date),
      robloxUsername: r.robloxUsername ?? null,
      wbCode: r.wbCode ?? null,
    }));
  if (orders.length === 0) return null;
  const newerActive = await db.wbOrder.findFirst({
    where: { userId, status: { in: ACTIVE_ORDER_STATUSES }, createdAt: { gt: orders[0].completedAt } },
    select: { createdAt: true },
  });
  return newerActive ? null : orders;
}

// ── Опрос «пришли ли робуксы?» (рассылка 26.10.2026) ────────────────────────
/*
 * Отправляет `scripts/broadcast-pending-check.mjs`. Кнопки отдельные от
 * самопроверки (`rbx_s_*`), чтобы ответ на опрос можно было посчитать:
 * «в Pending» и «нигде нет» дальше идут ровно туда же, что `rbx_pend`/`rbx_low`.
 */
export const SURVEY_CMD = { got: "rbx_s_got", pending: "rbx_s_pend", none: "rbx_s_none" } as const;

/** Подписи кнопок опроса — общие для TG и VK (лимит VK 40 символов). */
export function surveyButtons(amount?: number | null): { got: string; pending: string; none: string } {
  return {
    got: "✅ Уже на балансе",
    pending: amount ? `⏳ В Pending ${amount} или больше` : "⏳ В Pending, сумма заказа",
    none: "❌ Ни в Pending, ни на балансе",
  };
}

/** Текст опроса. Акцент владельца: робуксы должны быть ИЛИ в Pending, ИЛИ на балансе. */
export function robuxSurveyText(fmt: RobuxEtaFormat, amount: number): string {
  const link = fmt === "html" ? `<a href="${ROBLOX_TRANSACTIONS_URL}">roblox.com/transactions</a>` : ROBLOX_TRANSACTIONS_URL;
  return (
    `💎 ${b(fmt, `Пришли ли робуксы за заказ на ${amount} R$?`)}\n\n` +
    `Roblox сейчас держит робуксы за геймпассы в статусе Pending дольше обычного — так у всех продавцов, не только у нас.\n\n` +
    `❗️ ${b(fmt, "Важно: робуксы должны быть в одном из двух мест — в Pending или уже на балансе.")} ` +
    `Если они в Pending — всё в порядке: с нашей стороны всё сделано, на баланс их переведёт сам Roblox.\n\n` +
    `🔍 Проверь: ${link} → строка ${b(fmt, "Pending Robux")} (там должно быть ${amount} или больше) и баланс робуксов.\n\n` +
    `Нажми, что видишь 👇`
  );
}

/** Ответ на «✅ Уже на балансе». */
export function robuxSurveyGotText(): string {
  return "🙌 Отлично, робуксы дошли! Спасибо, что подтвердил — это очень важно для нас.\n\nЗахочешь ещё — в меню есть покупка напрямую, без карты WB 💎";
}

// ── «Что на скриншоте?» (26.10.2026) ────────────────────────────────────────
/*
 * До 26.10 любое фото от человека с невыплаченным бонусом за отзыв считалось
 * отзывом: после опроса «проверь Pending» люди присылали скрин Transactions,
 * он уходил админам карточкой отзыва, и за него начислялись +100 R$ (YS3NU3X).
 * Теперь, если человек сам не нажимал «📸 Прислать отзыв», бот спрашивает.
 */
export const PHOTO_KIND_CMD = { review: "ph_review", pending: "ph_pend" } as const;

export const PHOTO_KIND_BUTTONS = { review: "🎁 Отзыв на WB", pending: "💎 Pending / Transactions" } as const;

export function photoKindQuestionText(fmt: RobuxEtaFormat): string {
  return (
    `📸 ${b(fmt, "Что на скриншоте?")}\n\n` +
    `• ${b(fmt, "Отзыв на Wildberries")} — отправлю менеджеру, после проверки начислим бонус.\n` +
    `• ${b(fmt, "Страница Transactions / Pending")} — подскажу, всё ли в порядке с робуксами.`
  );
}

/** Ответ на «это скрин Pending / Transactions». */
export function pendingPhotoReplyText(fmt: RobuxEtaFormat): string {
  return (
    `👍 Спасибо! Посмотри на строку ${b(fmt, "Pending Robux")}:\n\n` +
    `✅ там сумма заказа или больше (или робуксы уже на балансе) — ${b(fmt, "всё в порядке")}. ` +
    `С нашей стороны всё сделано, на баланс робуксы переведёт сам Roblox.\n\n` +
    `❌ там 0 или меньше суммы, и на балансе пусто — нажми «${NO_ROBUX_BUTTON}», проверим вместе.\n\n` +
    confirmHintLine(fmt)
  );
}

/** Фото, ждущее ответа «что на нём» — живёт в памяти бота не дольше часа. */
export const PHOTO_KIND_TTL_MS = 60 * 60_000;
/** Сколько после нажатия «📸 Прислать отзыв» фото сразу считается отзывом. */
export const EXPLICIT_REVIEW_TTL_MS = 6 * 60 * 60_000;

// ── «✅ Робуксы поступили» (27.10.2026) ─────────────────────────────────────
/*
 * Владелец: подтверждение «робуксы дошли» — самое важное для нас. Кнопка стоит
 * в сообщении о выкупе, в ответе «где робуксы?», в ответе «в Pending — всё
 * в порядке» и в рассылке `scripts/broadcast-robux-confirm.mjs`. Команда та же,
 * что у ответа опроса «уже на балансе» (`rbx_s_got`): одно нажатие — одна
 * запись `OrderEvent` ROBUX_SURVEY_GOT, которую видит карточка заказа.
 */
export const ROBUX_CONFIRM = { command: SURVEY_CMD.got, label: "✅ Робуксы поступили" } as const;

/** Строка-просьба под текстом, где стоит кнопка. */
export function confirmHintLine(fmt: RobuxEtaFormat): string {
  return `🙏 Когда робуксы появятся на балансе — нажми ${b(fmt, `«${ROBUX_CONFIRM.label}»`)}. Это очень важно для нас.`;
}

/** Рассылка «нажми, когда поступят» (или если уже поступили). */
export function robuxConfirmText(fmt: RobuxEtaFormat, amount: number): string {
  return (
    `💎 ${b(fmt, `Робуксы за заказ на ${amount} R$ уже на балансе?`)}\n\n` +
    `Нажми ${b(fmt, `«${ROBUX_CONFIRM.label}»`)}, как только они появятся на балансе Roblox — или прямо сейчас, если уже появились. ` +
    `Это очень важно для нас 🙏\n\n` +
    `Пока робуксы в ${b(fmt, "Pending")} — всё в порядке: с нашей стороны всё сделано, на баланс их переведёт сам Roblox. ` +
    `Кнопка никуда не денется — нажми её, когда они придут.`
  );
}

/** «Не вижу робуксов» под рассылкой — ведёт на самопроверку `rbx_chk`. */
export const NO_ROBUX_SHORT_BUTTON = "🤔 Не вижу робуксов";
