/* ─────────────────────────────────────────────────────────────────────────────
   Поддержка: сначала описание проблемы, потом уведомление в админку.

   Как было до 18.10.2026: человек нажимал «Поддержка» — алерт 🆘 уходил
   админам В ТОТ ЖЕ МОМЕНТ, а человека только после этого просили рассказать,
   что случилось. В админке лежало «обращение в поддержку · Причина: Общий
   вопрос» — то есть этап кнопки, а не слова человека; менеджер начинал
   разговор с «расскажите, что у вас». Плюс каждый мисклик по кнопке поднимал
   тревогу.

   Замечание владельца: «нужно чтобы пользователь описал свою проблему… И только
   после того, как он описал проблему и отправил — нам в админку идёт увед, как
   раньше, только уже с текстом проблемы… + это исключает миссклики».

   Поэтому кнопка больше ничего не шлёт: она ставит ОЖИДАНИЕ описания, а алерт
   собирается уже вокруг текста (`SupportAlertPayload.problemText`).

   Два правила, из которых всё остальное следует:

   1. **Ожидание живёт в БД** (`User.supportIntakeAt/Ctx`), а не в памяти
      процесса. Деплой у нас несколько раз в день; потерянное ожидание — это и
      потерянное обращение, и «это не похоже на ключ» в ответ на описание
      проблемы. Тот же урок, что у паузы менеджера (`bots/vk/support-pause.ts`).
   2. **Ввод флоу выигрывает у описания.** Ссылка на пасс, код ВБ, ник, ключ —
      обрабатываются штатно и ожидание снимают: «помогите, вот ссылка» должно
      доехать до флоу, а не упасть в поддержку текстом.

   Модуль знает про Prisma ровно столько, сколько нужно для двух полей, — чтобы
   тест не поднимал клиент.
   ───────────────────────────────────────────────────────────────────────── */

/** Кого ждём: у TG-бота это `tgId`, у VK — `vkId`. */
export interface IntakeSubject {
  tgId?: string | null;
  vkId?: string | null;
}

export interface SupportIntakeDb {
  user: {
    findFirst: (args: any) => Promise<{ supportIntakeAt?: Date | null; supportIntakeCtx?: string | null } | null>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
}

export type IntakePlatform = "TG" | "VK";

export interface IntakeContext {
  platform: IntakePlatform;
  /** Этап, с которого человек позвал поддержку (`SUPPORT_CONTEXT_LABELS`). */
  contextKey: string;
  wbCode?: string;
  denomination?: number;
  /** Про «нажал и молчит» админам уже сказали (один раз за ожидание). */
  nudged?: boolean;
  /** Когда поставили ожидание. */
  openedAt?: number;
}

/**
 * Сколько ожидание живёт. Человек отвлекается: два часа — это ещё «он отвечает
 * на наш вопрос», а не «через сутки написал что-то совсем другое».
 */
export const INTAKE_TTL_MS = 2 * 60 * 60 * 1000;
/** Через сколько админам уходит тихий одностроч «нажал и молчит» (О2). */
export const INTAKE_NUDGE_AFTER_MS = 10 * 60 * 1000;
/** Описание режем здесь: алерт должен читаться с телефона целиком. */
export const MAX_PROBLEM_LEN = 400;

const CANCEL_WORDS = new Set([
  "отмена", "отменить", "отбой", "не надо", "передумал", "передумала",
  "cancel", "+бот", "+bot", "бот+",
]);

/** Ключ кэша: платформа + id, как в `support-pause`. */
function cacheKey(who: IntakeSubject): string | null {
  if (who.tgId) return `TG:${who.tgId}`;
  if (who.vkId) return `VK:${who.vkId}`;
  return null;
}

function whereOf(who: IntakeSubject): { tgId: string } | { vkId: string } | null {
  if (who.tgId) return { tgId: String(who.tgId) };
  if (who.vkId) return { vkId: String(who.vkId) };
  return null;
}

/** Ожидание в памяти: `null` — «в БД спрашивали, ожидания нет». */
const cache = new Map<string, IntakeContext | null>();

function serialize(ctx: IntakeContext): string {
  return JSON.stringify({
    p: ctx.platform,
    k: ctx.contextKey,
    c: ctx.wbCode ?? null,
    d: ctx.denomination ?? null,
    n: ctx.nudged ? 1 : 0,
  });
}

function parse(raw: string | null | undefined, at: Date | null | undefined): IntakeContext | null {
  if (!at) return null;
  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  const platform: IntakePlatform = data.p === "TG" ? "TG" : "VK";
  return {
    platform,
    contextKey: typeof data.k === "string" && data.k ? data.k : "general",
    wbCode: typeof data.c === "string" && data.c ? data.c : undefined,
    denomination: Number.isFinite(data.d) && data.d > 0 ? Number(data.d) : undefined,
    nudged: data.n === 1,
    openedAt: new Date(at).getTime(),
  };
}

/** Поставить ожидание описания. Админам в этот момент НЕ уходит ничего. */
export async function openIntake(db: SupportIntakeDb, who: IntakeSubject, ctx: IntakeContext): Promise<void> {
  const where = whereOf(who);
  const key = cacheKey(who);
  if (!where || !key) return;
  const entry: IntakeContext = { ...ctx, nudged: false, openedAt: Date.now() };
  cache.set(key, entry);
  try {
    await db.user.updateMany({
      where,
      data: { supportIntakeAt: new Date(entry.openedAt!), supportIntakeCtx: serialize(entry) },
    });
  } catch (err) {
    // Запись не прошла — ожидание всё равно живёт в памяти до рестарта: это
    // лучше, чем отправить алерт без описания или потерять обращение.
    console.warn("[support-intake] не записали ожидание:", err instanceof Error ? err.message : err);
  }
}

/** Прочитать ожидание, не снимая его. Просроченное снимает само. */
export async function readIntake(db: SupportIntakeDb, who: IntakeSubject): Promise<IntakeContext | null> {
  const where = whereOf(who);
  const key = cacheKey(who);
  if (!where || !key) return null;

  let entry = cache.get(key);
  if (entry === undefined) {
    try {
      const row = await db.user.findFirst({
        where,
        select: { supportIntakeAt: true, supportIntakeCtx: true },
      });
      entry = parse(row?.supportIntakeCtx ?? null, row?.supportIntakeAt ?? null);
    } catch (err) {
      console.warn("[support-intake] не прочитали ожидание:", err instanceof Error ? err.message : err);
      entry = null;
    }
    cache.set(key, entry);
  }
  if (!entry) return null;
  if (Date.now() - (entry.openedAt ?? 0) > INTAKE_TTL_MS) {
    await cancelIntake(db, who);
    return null;
  }
  return entry;
}

/** Забрать ожидание (снимает его) — описание получено или человек передумал. */
export async function takeIntake(db: SupportIntakeDb, who: IntakeSubject): Promise<IntakeContext | null> {
  const entry = await readIntake(db, who);
  if (!entry) return null;
  await cancelIntake(db, who);
  return entry;
}

/** Снять ожидание. Алерт при этом не уходит. */
export async function cancelIntake(db: SupportIntakeDb, who: IntakeSubject): Promise<void> {
  const where = whereOf(who);
  const key = cacheKey(who);
  if (!where || !key) return;
  cache.set(key, null);
  try {
    await db.user.updateMany({ where, data: { supportIntakeAt: null, supportIntakeCtx: null } });
  } catch (err) {
    console.warn("[support-intake] не сняли ожидание:", err instanceof Error ? err.message : err);
  }
}

/** Отметить, что про молчание админам уже сказали (не чаще раза за ожидание). */
export async function markIntakeNudged(db: SupportIntakeDb, who: IntakeSubject, ctx: IntakeContext): Promise<void> {
  const where = whereOf(who);
  const key = cacheKey(who);
  if (!where || !key) return;
  const entry: IntakeContext = { ...ctx, nudged: true };
  cache.set(key, entry);
  try {
    await db.user.updateMany({ where, data: { supportIntakeCtx: serialize(entry) } });
  } catch (err) {
    console.warn("[support-intake] не отметили молчание:", err instanceof Error ? err.message : err);
  }
}

/** Тест и рестарт процесса: кэш не должен переживать ни одного, ни другого. */
export function __resetIntakeCache(): void {
  cache.clear();
}

/** «Отмена» — человек передумал. Снимает ожидание без алерта. */
export function isIntakeCancel(text: string): boolean {
  return CANCEL_WORDS.has(text.trim().toLowerCase());
}

/**
 * Ввод флоу, который должен обработаться штатно, а не уехать в поддержку:
 * ссылка/ID геймпасса, код ВБ, ник (когда флоу его ждёт), Open Cloud ключ.
 * Это то же правило, по которому устроен обход паузы менеджера в VK.
 */
export function looksLikeFlowInput(
  text: string,
  opts: { passId?: boolean; expectsNick?: boolean } = {},
): boolean {
  const t = text.trim();
  if (!t) return false;
  if (opts.passId) return true;
  // Код ВБ — 7 символов, обязательно с буквой (чистые 7 цифр — это Pass ID).
  if (/^[A-Za-z0-9]{7}$/.test(t) && /[A-Za-z]/.test(t)) return true;
  if (opts.expectsNick && /^@?[A-Za-z0-9_]{3,20}$/.test(t)) return true;
  // Ключ Open Cloud — длинная строка без пробелов; описанием проблемы не бывает.
  if (t.length >= 40 && !/\s/.test(t)) return true;
  return false;
}

/** Описание для алерта: без управляющих символов, не длиннее лимита. */
export function clipProblemText(raw: string, limit = MAX_PROBLEM_LEN): string {
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * Описание принято — есть ли что передавать.
 *
 * Пустое и односимвольное («.», «?») описанием не считаем: такой алерт ничем
 * не лучше прежнего «нажал кнопку». Скриншот без подписи считается описанием
 * (решение владельца О3): половина обращений — «не вижу геймпасс», это скрин.
 */
export function isUsableProblem(text: string, hasPhoto = false): boolean {
  const t = text.trim();
  if (hasPhoto) return true;
  return t.length >= 2;
}

/** Что бот отвечает на нажатие кнопки. Один текст на оба бота. */
export function intakePromptText(platform: IntakePlatform): string {
  const lines = [
    "💬 Опиши одним сообщением, что случилось — передам менеджеру вместе с твоим заказом.",
    "",
    "Так он сразу увидит суть и ответит по делу, а не «расскажите, что у вас».",
    "📎 Можно приложить скриншот.",
    "",
    platform === "VK"
      ? "Передумал — напиши «отмена»."
      : "Передумал — напиши «отмена» или просто продолжай пользоваться ботом.",
  ];
  return lines.join("\n");
}

/** Что бот отвечает, когда описание получено и алерт ушёл. */
export function intakeAckText(platform: IntakePlatform): string {
  if (platform === "VK") {
    return [
      "✅ Передал менеджеру — он ответит прямо здесь, в этом чате (это живой человек, не бот).",
      "",
      "Пока идёт разговор, бот не вмешивается. Вернуть бота: напиши «+бот».",
      "",
      "Если удобнее в Telegram — там тоже живой человек: https://t.me/RobloxBank_PA",
    ].join("\n");
  }
  return [
    "✅ Передал менеджеру вместе с твоим заказом.",
    "",
    "Ответит <b>живой человек</b> в чате <b>@RobloxBank_PA</b> — напиши туда, чтобы продолжить разговор 👇",
  ].join("\n");
}

/** Что бот отвечает на «отмену». */
export function intakeCancelText(): string {
  return "Хорошо, обращение не отправил. Если понадобимся — просто нажми «Поддержка» снова.";
}

/** Повторное нажатие внутри ожидания — просим то же, второй алерт не шлём. */
export function intakeRepeatText(): string {
  return "Жду твоё сообщение с описанием проблемы 👆 Напиши его — и сразу передам менеджеру.";
}

/* ── «Нажал и молчит» (решение владельца О2) ─────────────────────────────────
   Мисклик не должен поднимать тревогу — поэтому полного алерта тут нет. Но и
   полное молчание неверно: человек мог нажать кнопку и не понять, что от него
   ждут слов. Через 10 минут админам уходит тихий одностроч `notifyUserHurdle`
   («👀 клиент застрял»), один раз за ожидание. Просроченные ожидания свип
   снимает, чтобы описание проблемы не прилетело через сутки «из ниоткуда».
   ───────────────────────────────────────────────────────────────────────── */

export interface IntakeSweepDb extends SupportIntakeDb {
  user: SupportIntakeDb["user"] & {
    findMany: (args: any) => Promise<
      Array<{ tgId?: string | null; vkId?: string | null; supportIntakeAt?: Date | null; supportIntakeCtx?: string | null }>
    >;
  };
}

export interface SilentIntake {
  who: IntakeSubject;
  ctx: IntakeContext;
}

/**
 * Найти молчащих и почистить просроченные.
 *
 * Возвращает тех, про кого админам стоит сказать один раз; отправку делает
 * вызывающий (в кронах TG-бота, где живёт `notifyUserHurdle`).
 */
export async function sweepSilentIntakes(db: IntakeSweepDb, now = Date.now()): Promise<SilentIntake[]> {
  let rows: Awaited<ReturnType<IntakeSweepDb["user"]["findMany"]>> = [];
  try {
    rows = await db.user.findMany({
      where: { supportIntakeAt: { not: null } },
      select: { tgId: true, vkId: true, supportIntakeAt: true, supportIntakeCtx: true },
      take: 200,
    });
  } catch (err) {
    console.warn("[support-intake] свип не прошёл:", err instanceof Error ? err.message : err);
    return [];
  }

  const silent: SilentIntake[] = [];
  for (const row of rows) {
    const who: IntakeSubject = { tgId: row.tgId ?? null, vkId: row.vkId ?? null };
    if (!whereOf(who)) continue;
    const ctx = parse(row.supportIntakeCtx ?? null, row.supportIntakeAt ?? null);
    if (!ctx) continue;
    const age = now - (ctx.openedAt ?? now);
    if (age > INTAKE_TTL_MS) {
      await cancelIntake(db, who);
      continue;
    }
    if (age >= INTAKE_NUDGE_AFTER_MS && !ctx.nudged) {
      await markIntakeNudged(db, who, ctx);
      silent.push({ who, ctx });
    }
  }
  return silent;
}
