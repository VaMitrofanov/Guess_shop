/**
 * «Где мои робуксы?» — личный таймер заморозки Roblox.
 *
 * До 23.10.2026 бот сам напоминал на 5-й день «робуксы уже могли
 * разблокироваться», а на 7-й — «точно разблокированы». Оба сообщения
 * обещали то, чего мы не знаем: срок Pending решает Roblox, и у части людей
 * он дольше пяти дней. Напоминание само рождало обращения «а где?».
 *
 * Решение владельца 23.10.2026: никаких пушей. Человек спрашивает — получает
 * ПРИМЕРНЫЙ таймер, где 7 дней (максимум) считаются от момента выкупа, и
 * ясное «срок решает Roblox, не мы». После 7 дней — не отписка, а кнопка
 * «робуксов нет — проверить»: тогда проблема может быть настоящей.
 *
 * Модуль — единственный источник срока для ботов. Зеркало для Next-роутов —
 * `src/lib/order-presentation.ts` (bots/ и src/ друг друга не импортируют).
 */

/** Сколько Roblox держит робуксы за геймпасс в Pending — по максимуму. */
export const ROBUX_HOLD_DAYS = 7;
/** Старше этого вопрос уже не про заморозку: таймер не показываем. */
export const ROBUX_ETA_LOOKBACK_DAYS = 30;
/** Сколько заказов перечисляем в одном ответе. */
const MAX_ORDERS = 4;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const ROBLOX_TRANSACTIONS_URL = "https://www.roblox.com/transactions";
/** Наша страница «что такое геймпасс и Pending» — со схемой и скриншотами. */
export const PENDING_INFO_URL = "https://robloxbank.ru/pending";

/** Ориентир разблокировки: момент выкупа + 7 дней. */
export function robuxUnlockDate(completedAt: Date): Date {
  return new Date(completedAt.getTime() + ROBUX_HOLD_DAYS * DAY_MS);
}

export function fmtDateRu(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
}

export function pluralRu(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

const DAYS: [string, string, string] = ["день", "дня", "дней"];

export type RobuxEtaPhase = "holding" | "overdue";

export interface RobuxEta {
  phase: RobuxEtaPhase;
  completedAt: Date;
  unlockAt: Date;
  /** Сколько осталось до ориентира (0, если срок прошёл). */
  msLeft: number;
  /** Полных дней с момента выкупа. */
  daysPassed: number;
}

export function robuxEta(completedAt: Date, now: Date = new Date()): RobuxEta {
  const unlockAt = robuxUnlockDate(completedAt);
  const msLeft = Math.max(0, unlockAt.getTime() - now.getTime());
  return {
    phase: msLeft > 0 ? "holding" : "overdue",
    completedAt,
    unlockAt,
    msLeft,
    daysPassed: Math.max(0, Math.floor((now.getTime() - completedAt.getTime()) / DAY_MS)),
  };
}

/** «≈ 3 дня» / «≈ 20 ч» / «меньше часа». Таймер примерный — точность до часа
 *  только вводила бы в заблуждение. */
export function fmtLeft(msLeft: number): string {
  if (msLeft <= 0) return "срок вышел";
  if (msLeft < HOUR_MS) return "меньше часа";
  if (msLeft < 36 * HOUR_MS) return `≈ ${Math.ceil(msLeft / HOUR_MS)} ч`;
  const days = Math.round(msLeft / DAY_MS);
  return `≈ ${days} ${pluralRu(days, DAYS)}`;
}

/** Шкала из семи делений — одно деление на день заморозки. */
export function holdBar(eta: RobuxEta): string {
  const filled = Math.min(ROBUX_HOLD_DAYS, eta.daysPassed);
  return "▰".repeat(filled) + "▱".repeat(ROBUX_HOLD_DAYS - filled);
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
  /** Есть заказ, у которого срок Roblox уже прошёл — показать кнопку проверки. */
  overdue: boolean;
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

const NOT_US_HEAD = "Этот срок устанавливает Roblox, а не мы.";
const NOT_US_TAIL = "Свою часть мы выполнили — геймпасс выкуплен. Ускорить разморозку мы не можем, она произойдёт сама.";

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
  const etas = orders.map((o) => ({ o, eta: robuxEta(o.completedAt, now) }));
  const overdue = etas.some((e) => e.eta.phase === "overdue");
  const holding = etas.filter((e) => e.eta.phase === "holding");
  const check = fmt === "html"
    ? `🔍 Проверить: <a href="${ROBLOX_TRANSACTIONS_URL}">roblox.com/transactions</a> → строка <b>Pending</b>.`
    : `🔍 Проверить: ${ROBLOX_TRANSACTIONS_URL} → строка Pending.`;
  const lines: string[] = [];

  if (etas.length === 1 && !overdue) {
    const { o, eta } = etas[0];
    lines.push(`⏳ ${b(fmt, `Робуксы за заказ на ${o.amount} R$ — в заморозке у Roblox`)}`);
    lines.push("");
    lines.push(`Выкупили: ${b(fmt, fmtDateRu(eta.completedAt))}`);
    lines.push(`Ориентир: ${b(fmt, `до ${fmtDateRu(eta.unlockAt)}`)} (примерно)`);
    lines.push(`${holdBar(eta)}  осталось ${fmtLeft(eta.msLeft)}`);
  } else if (etas.length === 1) {
    const { o, eta } = etas[0];
    lines.push(`⌛ ${b(fmt, `Срок Roblox по заказу на ${o.amount} R$ прошёл`)} (${fmtDateRu(eta.unlockAt)})`);
  } else {
    lines.push(`⏳ ${b(fmt, "Твои робуксы в заморозке у Roblox")}`);
    for (const { o, eta } of etas) {
      lines.push("");
      lines.push(`${b(fmt, `${o.amount} R$`)} · выкупили ${fmtDateRu(eta.completedAt)}`);
      lines.push(eta.phase === "holding"
        ? `${holdBar(eta)}  ${fmtLeft(eta.msLeft)} · до ${fmtDateRu(eta.unlockAt)}`
        : `⌛ срок Roblox прошёл ${fmtDateRu(eta.unlockAt)}`);
    }
  }

  lines.push("");
  if (holding.length > 0) {
    lines.push(
      "Робуксы уже на твоём аккаунте — Roblox держит их в статусе Pending до 7 дней. " +
      "Так он делает с каждой покупкой геймпасса, у любого продавца.",
    );
    lines.push("");
    lines.push(`ℹ️ ${b(fmt, NOT_US_HEAD)} ${NOT_US_TAIL}`);
    lines.push("");
    lines.push(`${check} Пока там видна эта строка — всё идёт как надо.`);
    lines.push("");
    lines.push(infoLine(fmt));
  }
  if (overdue) {
    if (holding.length > 0) lines.push("");
    lines.push(holding.length > 0
      ? "По заказу, где срок уже прошёл, обычно робуксы уже на балансе. Проверь Transactions:"
      : "Обычно к этому дню робуксы уже на балансе. Проверь Transactions:");
    lines.push(`• строка всё ещё ${b(fmt, "Pending")} — Roblox задерживает выплату. Это решается только на его стороне, подожди ещё немного;`);
    lines.push(`• строки ${b(fmt, "нет вовсе")} — нажми «Робуксов нет», проверим вместе.`);
    if (holding.length === 0) {
      lines.push("");
      lines.push(check);
    }
  }
  return { text: lines.join("\n"), overdue };
}

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
 *  • пока срок 7 дней не вышел, вопрос «где робуксы» в поддержку не уходит
 *    вовсе — ни текстом, ни через кнопку «Поддержка» (на него есть ответ);
 *  • после 7 дней кнопка «Робуксов нет» ведёт не к менеджеру, а к самопроверке:
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

/** Заказ, о котором спрашиваем: свежий просроченный, иначе просто свежий. */
export function selfCheckTarget(ordersIn: RobuxEtaOrder[], now: Date = new Date()): RobuxEtaOrder | null {
  const orders = etaOrders(ordersIn, now);
  return orders.find((o) => robuxEta(o.completedAt, now).phase === "overdue") ?? orders[0] ?? null;
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
    `Число в Pending Robux — это твои робуксы: Roblox их уже начислил и просто ещё держит. Иногда он держит дольше 7 дней — ` +
    `это решение Roblox, и ускорить его не может ни наша поддержка, ни мы.\n\n` +
    `Ничего делать не нужно: как только Roblox разморозит, робуксы сами появятся на балансе.\n\n` +
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

/** Обращение этого контекста принимается только со скриншотом. */
export function intakeNeedsScreenshot(contextKey: string | null | undefined): boolean {
  return contextKey === ROBUX_LOW_PENDING_CONTEXT;
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

/** Есть ли среди заказов такой, у которого 7 дней уже прошли. */
export function hasOverdueOrder(ordersIn: RobuxEtaOrder[], now: Date = new Date()): boolean {
  return etaOrders(ordersIn, now).some((o) => robuxEta(o.completedAt, now).phase === "overdue");
}

/** Короткий ответ на повторный вопрос за несколько минут: вся карточка заново
 *  читалась бы как автоответчик, который не слышит. */
export function buildRobuxEtaShort(ordersIn: RobuxEtaOrder[], fmt: RobuxEtaFormat, now: Date = new Date()): string | null {
  const orders = etaOrders(ordersIn, now);
  if (orders.length === 0) return null;
  const eta = robuxEta(orders[0].completedAt, now);
  return eta.phase === "holding"
    ? `⏳ Всё так же: ${holdBar(eta)} ${fmtLeft(eta.msLeft)}, ориентир — ${b(fmt, `до ${fmtDateRu(eta.unlockAt)}`)}. Срок решает Roblox, робуксы придут сами.`
    : `⌛ Срок Roblox прошёл ${fmtDateRu(eta.unlockAt)}. Если в Transactions нет строки Pending — нажми «Робуксов нет», проверим вместе.`;
}

/**
 * Текст для чата Wildberries: без HTML, без ссылок наружу и без кнопок — WB
 * их не любит. Вместо кнопки «проверить» — просьба написать сюда же.
 */
export function buildRobuxEtaWbChat(ordersIn: RobuxEtaOrder[], now: Date = new Date()): RobuxEtaReply | null {
  const orders = etaOrders(ordersIn, now);
  if (orders.length === 0) return null;
  const eta = robuxEta(orders[0].completedAt, now);
  const amount = orders[0].amount;
  if (eta.phase === "holding") {
    return {
      overdue: false,
      text:
        `Робуксы за заказ на ${amount} R$ уже на вашем аккаунте Roblox, но пока заморожены самим Roblox (статус Pending).\n\n` +
        `Выкупили: ${fmtDateRu(eta.completedAt)}. Ориентир разморозки: до ${fmtDateRu(eta.unlockAt)} (примерно, осталось ${fmtLeft(eta.msLeft)}).\n\n` +
        `Этот срок устанавливает Roblox, а не мы: так он делает с каждой покупкой геймпасса, до 7 дней. Ускорить его мы не можем, робуксы станут доступны сами.\n\n` +
        `Проверить можно в Roblox: раздел Transactions, строка Pending Robux — в ней должно быть число не меньше ${amount}.`,
    };
  }
  return {
    overdue: true,
    text:
      `Срок заморозки Roblox по заказу на ${amount} R$ прошёл ${fmtDateRu(eta.unlockAt)} — обычно робуксы к этому дню уже на балансе.\n\n` +
      `Проверьте в Roblox раздел Transactions, строку Pending Robux: важно число в ней. ` +
      `Если там ${amount} или больше — это задержка на стороне Roblox, подождите ещё немного. ` +
      `Если меньше ${amount} и на балансе робуксов тоже нет — пришлите сюда скриншот страницы Transactions, менеджер проверит выкуп.`,
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
