/* ─────────────────────────────────────────────────────────────────────────────
   🧠 ИИ учится на наших операторах (27.11.2026, владелец: «да, супер»).

   Когда ИИ передал разговор человеку, а оператор ответил покупателю сам, пара
   «вопрос покупателя → ответ оператора» сохраняется. Последние примеры идут в
   промпт отдельным блоком — модель перенимает наш тон и наши решения.
   Ночной разбор (`bots/tg/ai-judge.ts`) читает эти же пары.

   Хранилище — `WbSyncCursor` stream `ai-examples` (до 40 пар, новые сверху).
   Ключи API, пароли и коды доставки в примеры не попадают.
   ───────────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const EXAMPLES_STREAM = "ai-examples";
const KEEP = 40;
/** Сколько свежих пар идёт в промпт. */
export const PROMPT_EXAMPLES = 8;

export interface OperatorExample { channel: string; question: string; answer: string; by: string; at: string }

/** Не учимся на секретах и на мусоре. */
export function exampleWorthKeeping(question: string, answer: string): boolean {
  const q = question.trim();
  const a = answer.trim();
  if (q.length < 6 || a.length < 12 || a.length > 1200) return false;
  if (/rbx-|api[_ -]?key|парол|password|\b\d{6}\b/i.test(`${q} ${a}`)) return false;
  if (/^📌|^Передали ваш вопрос коллеге/.test(a)) return false;
  return true;
}

export async function recordOperatorExample(db: Db, ex: Omit<OperatorExample, "at">): Promise<void> {
  if (!exampleWorthKeeping(ex.question, ex.answer)) return;
  try {
    const row = await db.wbSyncCursor.findUnique({ where: { stream: EXAMPLES_STREAM } });
    const list: OperatorExample[] = ((row?.metadata ?? {}) as { items?: OperatorExample[] }).items ?? [];
    const item: OperatorExample = { ...ex, question: ex.question.trim().slice(0, 600), answer: ex.answer.trim().slice(0, 1200), at: new Date().toISOString() };
    const next = [item, ...list.filter((x) => x.question !== item.question)].slice(0, KEEP);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = { items: next } as any;
    await db.wbSyncCursor.upsert({
      where: { stream: EXAMPLES_STREAM },
      create: { stream: EXAMPLES_STREAM, metadata },
      update: { metadata },
    });
  } catch (e) {
    console.warn("[ai-learn] пример не сохранился:", e instanceof Error ? e.message : e);
  }
}

export async function loadOperatorExamples(db: Db, limit = PROMPT_EXAMPLES): Promise<OperatorExample[]> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: EXAMPLES_STREAM } }).catch(() => null);
  return (((row?.metadata ?? {}) as { items?: OperatorExample[] }).items ?? []).slice(0, limit);
}

/** Блок промпта с примерами (пусто — блока нет). */
export function examplesBlock(items: OperatorExample[]): string {
  if (!items.length) return "";
  return [
    "КАК ОТВЕЧАЮТ НАШИ ОПЕРАТОРЫ (живые примеры последних дней — перенимай тон и решения, но факты бери только из данных покупателя; запреты базы знаний важнее примеров):",
    ...items.map((x, i) => `${i + 1}. Покупатель: «${x.question.replace(/\s+/g, " ")}»\n   Оператор: «${x.answer.replace(/\s+/g, " ")}»`),
  ].join("\n");
}
