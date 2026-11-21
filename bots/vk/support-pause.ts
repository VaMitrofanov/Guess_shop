/**
 * Пауза живого менеджера во ВКонтакте.
 *
 * В VK у бота и у менеджера **один и тот же диалог**: всё, что бот пишет
 * «в ответ на текст», падает в тот же поток, где человек разговаривает с
 * клиентом. Поэтому пауза здесь — не удобство, а условие того, что менеджер
 * вообще может вести разговор.
 *
 * Что было сломано (разбор диалога `vk.com/id417408722`, 10–12.09.2026):
 *
 *  • **Пауза жила 30 минут.** Переписка с менеджером живёт сутками: он ответил
 *    в 02:16, клиент — в 08:32, и бот уже «снова на связи». Между репликами
 *    менеджера бот вклинился четыре раза подряд.
 *  • **Пауза жила в памяти процесса.** Любой деплой (а их несколько в день)
 *    молча снимал её со ВСЕХ диалогов.
 *  • **Ставил её только сам клиент**, нажав «Поддержка». Сообщение менеджера
 *    паузу не продлевало — признак `admin_author_id` в событии LongPoll
 *    приходит не всегда, и ветка молча ничего не делала.
 *
 * Отсюда три правила этого модуля:
 *
 *  1. окно — **сутки**, и каждое сообщение менеджера продлевает его заново;
 *  2. окно лежит в БД (`User.supportPausedUntil`) и переживает рестарт;
 *  3. «человек это или бот» решается не догадкой: см. `isHumanOutbox` в
 *     `handlers.ts` — сначала признак в событии, а если его нет, спрашиваем сам
 *     VK (`messages.getById`), не чаще раза в минуту на диалог.
 *
 * Возвращает бота в разговор менеджер («+бот») или сам клиент — той же
 * командой; кнопки и «терминальные» вводы (ссылка на пасс, код, ник) работают
 * и во время паузы, иначе пауза превращалась бы в чёрную дыру.
 */

/** Сутки. Разговор с менеджером живёт днями, 30 минут не хватало ни разу. */
export const SUPPORT_PAUSE_MS = 24 * 60 * 60 * 1000;
export const RESUME_KEYWORDS = ["+бот", "+bot", "бот+"];

/** Минимум того, что модулю нужно от Prisma (чтобы тест не поднимал клиент). */
export interface SupportPauseDb {
  user: {
    findUnique: (args: any) => Promise<{ supportPausedUntil?: Date | null } | null>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
}

interface PauseEntry {
  /** Момент окончания паузы (мс). */
  exp: number;
  /** Когда паузу поставили/продлили в последний раз (мс). */
  armedAt: number;
  /** Показывали ли уже «бот не вмешивается» в этом окне. */
  hinted: boolean;
}

/**
 * Пока менеджер отвечает живо, любая строчка от бота — помеха разговору.
 * Поэтому «⏸ бот не вмешивается» появляется, только если менеджер молчит уже
 * пару часов: тогда это не помеха, а ответ человеку, который ждёт бота.
 */
const HINT_AFTER_QUIET_MS = 2 * 60 * 60 * 1000;

const cache = new Map<number, PauseEntry>();
/** Пользователи, для которых БД уже спрашивали и паузы там нет. */
const knownEmpty = new Set<number>();

/** Поставить/продлить паузу. Ошибка записи не должна ломать разговор. */
export async function pauseSupport(db: SupportPauseDb, vkUserId: number, reason: string): Promise<void> {
  const until = new Date(Date.now() + SUPPORT_PAUSE_MS);
  const prev = cache.get(vkUserId);
  // `hinted` не сбрасываем при продлении: иначе каждая реплика менеджера
  // добавляла бы клиенту ещё одно «бот не вмешивается».
  cache.set(vkUserId, { exp: until.getTime(), armedAt: Date.now(), hinted: prev?.hinted ?? false });
  knownEmpty.delete(vkUserId);
  console.log(`[VK] support-pause: пауза до ${until.toISOString()} (${reason}), vkUserId=${vkUserId}`);
  try {
    await db.user.updateMany({ where: { vkId: String(vkUserId) }, data: { supportPausedUntil: until } });
  } catch (err) {
    console.warn("[VK] support-pause: не записали паузу в БД:", err instanceof Error ? err.message : err);
  }
}

/**
 * Идёт ли сейчас разговор с менеджером.
 *
 * Промах кэша (после рестарта) стоит одного запроса в БД на пользователя —
 * именно ради этого запроса пауза и переехала в базу.
 */
export async function isSupportPaused(db: SupportPauseDb, vkUserId: number): Promise<boolean> {
  const hit = cache.get(vkUserId);
  if (hit) {
    if (Date.now() < hit.exp) return true;
    cache.delete(vkUserId);
    knownEmpty.add(vkUserId);
    return false;
  }
  if (knownEmpty.has(vkUserId)) return false;
  let until: Date | null = null;
  try {
    const row = await db.user.findUnique({
      where: { vkId: String(vkUserId) },
      select: { supportPausedUntil: true },
    });
    until = row?.supportPausedUntil ?? null;
  } catch (err) {
    console.warn("[VK] support-pause: не прочитали паузу из БД:", err instanceof Error ? err.message : err);
    return false;
  }
  if (!until || until.getTime() <= Date.now()) {
    knownEmpty.add(vkUserId);
    return false;
  }
  // Хинт после рестарта показываем заново: помнить его негде, а лишняя одна
  // строка «бот не вмешивается» безобиднее молчания в ответ на прямой вопрос.
  cache.set(vkUserId, { exp: until.getTime(), armedAt: until.getTime() - SUPPORT_PAUSE_MS, hinted: false });
  return true;
}

/** Вернуть бота в разговор («+бот» или завершённый разбор). */
export async function resumeSupport(db: SupportPauseDb, vkUserId: number): Promise<void> {
  cache.delete(vkUserId);
  knownEmpty.add(vkUserId);
  console.log(`[VK] support-pause: снята, vkUserId=${vkUserId}`);
  try {
    await db.user.updateMany({ where: { vkId: String(vkUserId) }, data: { supportPausedUntil: null } });
  } catch (err) {
    console.warn("[VK] support-pause: не сняли паузу в БД:", err instanceof Error ? err.message : err);
  }
}

/**
 * Пора ли сказать «бот не вмешивается».
 *
 * Один раз за окно паузы И только когда менеджер уже пару часов молчит: пока
 * разговор живой, эта строка — та самая помеха, из-за которой всё и затевалось.
 */
export function shouldHintSupportPause(vkUserId: number): boolean {
  const entry = cache.get(vkUserId);
  if (!entry || entry.hinted) return false;
  if (Date.now() - entry.armedAt < HINT_AFTER_QUIET_MS) return false;
  entry.hinted = true;
  return true;
}

// ── Как человек просит человека ─────────────────────────────────────────────

// Подстрочный поиск по стемам: так поддержка достижима обычным текстом, а не
// только кнопкой. «support» — ТОЛЬКО отдельным словом: подстрока ловила ники
// вида Support_Kid и уводила ввод ника в паузу.
const SUPPORT_WORDS = [
  "оператор", "поддержк", "менеджер", "помощь", "помоги",
  "саппорт", "живой человек", "живого человека", "жалоб",
];
const SUPPORT_WORD_RE = /\bsupport\b/i;

/** «Спасибо за помощь» — это не просьба о помощи.
 *  Границы слова для «спс» заданы через `\p{L}`: ASCII-шный `\b` кириллицу за
 *  букву не считает и в строке «спс за помощь» не срабатывает вовсе. */
const GRATITUDE_RE = /спасиб|благодар|(?<![\p{L}\p{N}])спс(?![\p{L}\p{N}])|очень выручил|вы лучшие/iu;
/** …если рядом нет настоящей беды. */
const TROUBLE_RE = /не работает|не приход|не пришл|не получ|не могу|проблем|ошибк|где мо[ий]|верните|обман|деньги|застря|завис/i;

/**
 * Просит ли человек живого менеджера.
 *
 * Отдельно оговорена благодарность: «Спасибо вам большое за помощь» открывало
 * НОВОЕ обращение в поддержку (12.09 так и случилось) — админам летел алерт,
 * а клиенту приходило «опиши свой вопрос одним сообщением» вместо «пожалуйста».
 */
export function looksLikeSupportRequest(lower: string): boolean {
  const asks = SUPPORT_WORDS.some((w) => lower.includes(w)) || SUPPORT_WORD_RE.test(lower);
  if (!asks) return false;
  if (GRATITUDE_RE.test(lower) && !TROUBLE_RE.test(lower)) return false;
  return true;
}

// ── Ветка ключа: сколько раз подряд пришло «не похоже на ключ» ──────────────

/**
 * Счётчик промахов в ожидании ключа.
 *
 * Пока ветка ключа ждёт строку Open Cloud, ЛЮБОЙ текст получал ответ «Это не
 * похоже на ключ». Человек, который писал менеджеру, получил его четыре раза
 * подряд — включая ответ на «спасибо, чуть позже скину». Второй промах теперь
 * заканчивает ожидание и зовёт человека.
 */
const keyMisses = new Map<number, number>();

/** Сколько промахов подряд у этого пользователя (включая текущий). */
export function noteKeyMiss(vkUserId: number): number {
  const next = (keyMisses.get(vkUserId) ?? 0) + 1;
  keyMisses.set(vkUserId, next);
  return next;
}

export function resetKeyMisses(vkUserId: number): void {
  keyMisses.delete(vkUserId);
}

/** Сколько промахов терпим, прежде чем отдать разговор менеджеру. */
export const MAX_KEY_MISSES = 2;

/** Только для тестов: забыть всё, что накопилось в памяти процесса. */
export function __resetSupportPauseStateForTests(): void {
  cache.clear();
  knownEmpty.clear();
  keyMisses.clear();
}
