/* ─────────────────────────────────────────────────────────────────────────────
   🧠 ИИ учится на наших операторах.

   27.11.2026: пара «вопрос покупателя → ответ оператора» сохранялась, только
   когда ИИ сам передал разговор человеку, и только в PA и в ответах из TG
   в чат WB — за сутки набралось 2 примера.

   28.11.2026, владелец: «используй все ответы (в том числе и вк и тг)».
   Теперь это библиотека всех живых ответов операторов из всех каналов:
   • чаты WB — ответы из кабинета и из TG (`support-ai-harvest`: история +
     свежие каждые 30 мин, автотексты и ответы ИИ отсеяны);
   • ВК — каждое сообщение живого менеджера (admin_author_id) + история диалогов;
   • TG @RobloxBank_PA — каждый ответ оператора + еженедельная выгрузка диалогов.
   В промпт идут не «последние 8», а самые похожие на текущий вопрос
   (`pickExamples`) плюс пара свежих — модель видит, как МЫ отвечали ровно на это.
   Ночной разбор (`bots/tg/ai-judge.ts`) читает свежие пары.

   Хранилище — `WbSyncCursor` stream `ai-examples` (до KEEP пар, новые сверху).
   Ключи API, пароли и коды доставки в примеры не попадают.
   ───────────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const EXAMPLES_STREAM = "ai-examples";
const KEEP = 4000;
/** Сколько пар идёт в промпт: похожих + свежих. */
export const PROMPT_EXAMPLES = 8;
const PROMPT_RECENT = 2;

export interface OperatorExample { channel: string; question: string; answer: string; by: string; at: string }

/**
 * Ответ оператора, на котором можно учить ИИ (28.11.2026: в истории WB из
 * 895 пар часть — то, чего ИИ делать нельзя). Отсекаем:
 * • секреты: ключи, пароли, коды доставки и активации;
 * • давление отзывом («исправьте отзыв — тогда…») — нарушение правил WB;
 * • другие площадки в чате WB (штраф WB): ТГ, ВК, наш сайт, @аккаунты;
 * • грубость и перепалку;
 * • слишком короткое («пришлите скрин») — тона и решения в нём нет.
 */
export function exampleWorthKeeping(question: string, answer: string, channel?: string): boolean {
  const q = question.trim();
  const a = answer.trim();
  if (q.length < 6 || a.length < 25 || a.length > 1200) return false;
  if (/rbx-|api[_ -]?key|парол|password|логин|\b\d{6}\b|•••|[A-Z0-9]{4,5}-[A-Z0-9]{4,5}-[A-Z0-9]{4,5}/i.test(`${q} ${a}`)) return false;
  if (/^📌|^Передали ваш вопрос коллеге|^Чат с покупателем по товару/.test(a)) return false;
  if (/отзыв/i.test(a) && /исправ|измени|удал|поправ|убер|смен|после\s+того\s+как/i.test(a)) return false;
  if (/манипуляц|уголовк|не\s+реагирую|очевидно|обманыва|врёте|врете|всего\s+доброго\s+и\s+удачных/i.test(a)) return false;
  if (channel === "wb_chat" && /t\.me|telegram|телеграм|(?<!\p{L})(?:тг|вк)(?!\p{L})|вконтакт|vk\.com|@\w|robloxbank\.ru|наш\p{L}*\s+сайт/iu.test(a)) return false;
  return true;
}

const keyOf = (q: string) => q.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 200);

/** Слить новые пары в библиотеку: дубли вопроса заменяются более свежим ответом. */
export function mergeExamples(list: OperatorExample[], add: OperatorExample[]): OperatorExample[] {
  const fresh = add
    .filter((x) => exampleWorthKeeping(x.question, x.answer, x.channel))
    .map((x) => ({ ...x, question: x.question.trim().slice(0, 600), answer: x.answer.trim().slice(0, 1200) }));
  const seen = new Set<string>();
  const out: OperatorExample[] = [];
  for (const x of [...fresh, ...list].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const k = keyOf(x.question);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out.slice(0, KEEP);
}

async function readAll(db: Db): Promise<OperatorExample[]> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: EXAMPLES_STREAM } });
  return ((row?.metadata ?? {}) as { items?: OperatorExample[] }).items ?? [];
}

/** Несколько пар разом (история каналов). Возвращает, сколько новых добавилось. */
export async function recordOperatorExamples(db: Db, add: Array<Omit<OperatorExample, "at"> & { at?: string }>): Promise<number> {
  if (!add.length) return 0;
  try {
    const list = await readAll(db);
    const now = new Date().toISOString();
    const next = mergeExamples(list, add.map((x) => ({ ...x, at: x.at ?? now })));
    const before = new Set(list.map((x) => keyOf(x.question)));
    const added = next.filter((x) => !before.has(keyOf(x.question))).length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = { items: next } as any;
    await db.wbSyncCursor.upsert({
      where: { stream: EXAMPLES_STREAM },
      create: { stream: EXAMPLES_STREAM, metadata },
      update: { metadata },
    });
    libCache = null;
    return added;
  } catch (e) {
    console.warn("[ai-learn] примеры не сохранились:", e instanceof Error ? e.message : e);
    return 0;
  }
}

export async function recordOperatorExample(db: Db, ex: Omit<OperatorExample, "at">): Promise<void> {
  if (!exampleWorthKeeping(ex.question, ex.answer, ex.channel)) return;
  await recordOperatorExamples(db, [ex]);
}

let libCache: { at: number; items: OperatorExample[] } | null = null;

/** Вся библиотека (кэш 5 мин — читается на каждый вызов модели). */
export async function loadExampleLibrary(db: Db): Promise<OperatorExample[]> {
  if (libCache && Date.now() - libCache.at < 5 * 60_000) return libCache.items;
  const items = await readAll(db).catch(() => [] as OperatorExample[]);
  libCache = { at: Date.now(), items };
  return items;
}

export async function loadOperatorExamples(db: Db, limit = PROMPT_EXAMPLES): Promise<OperatorExample[]> {
  return (await loadExampleLibrary(db)).slice(0, limit);
}

/* ── Подбор похожих ─────────────────────────────────────────────────────── */

const STOP = new Set(["здравствуйте", "пожалуйста", "спасибо", "добрый", "можно", "когда", "почему", "сколько", "который", "которые", "нужно", "будет", "такой", "этого", "через", "после", "вообще", "просто", "сейчас", "только", "очень", "здесь"]);

/** Основы слов: нижний регистр, слова от 4 букв, первые 6 букв (грубый стемминг). */
export function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().replace(/ё/g, "е").match(/[\p{L}\d]{4,}/gu) ?? []) {
    if (STOP.has(w)) continue;
    out.add(w.slice(0, 6));
  }
  return out;
}

/**
 * Самые похожие на вопрос пары (общие основы слов, свой канал чуть выше),
 * плюс `PROMPT_RECENT` свежих. Без совпадений — просто свежие.
 */
export function pickExamples(lib: OperatorExample[], query: string, channel?: string, n = PROMPT_EXAMPLES): OperatorExample[] {
  const q = stems(query);
  const scored = q.size
    ? lib.map((x, i) => {
        const s = stems(x.question);
        let common = 0;
        for (const w of q) if (s.has(w)) common++;
        const score = common / Math.sqrt(Math.max(4, s.size)) + (channel && x.channel === channel ? 0.15 : 0) - i * 1e-5;
        return { x, common, score };
      }).filter((r) => r.common >= 1).sort((a, b) => b.score - a.score)
    : [];
  const picked: OperatorExample[] = [];
  const add = (x: OperatorExample) => { if (!picked.includes(x)) picked.push(x); };
  const recent = n >= 6 ? PROMPT_RECENT : 0;
  for (const r of scored.slice(0, n - recent)) add(r.x);
  for (const x of lib) { if (picked.length >= n) break; add(x); }
  return picked.slice(0, n);
}

const CH_RU: Record<string, string> = { wb_chat: "чат WB", vk_bot: "ВК", tg_pa: "Telegram", tg_bot: "Telegram" };

/** Блок промпта с примерами (пусто — блока нет). */
export function examplesBlock(items: OperatorExample[]): string {
  if (!items.length) return "";
  return [
    "КАК НАШИ ОПЕРАТОРЫ ОТВЕЧАЛИ НА ПОХОЖИЕ ВОПРОСЫ (живые ответы — перенимай тон, ход мысли и решения; факты — только из данных покупателя; старые примеры могут описывать прежние правила и цены, поэтому база знаний, правила владельца и правила канала важнее примеров (сроки не называй, возврат за WB — только через WB): в чате WB не упоминай другие площадки, даже если оператор в ВК/TG так делал):",
    ...items.map((x, i) => `${i + 1}. [${CH_RU[x.channel] ?? x.channel}] Покупатель: «${x.question.replace(/\s+/g, " ")}»\n   Оператор: «${x.answer.replace(/\s+/g, " ")}»`),
  ].join("\n");
}
