/* Пара «вопрос покупателя → ответ живого оператора» из переписки (28.11.2026).
   Лёгкий модуль без зависимостей: его берут и TG-бот, и ВК-бот.
   Правило — в `support-ai-harvest.ts`. */

import type { OperatorExample } from "./support-ai-learn";

/** C — покупатель, O — живой оператор, X — бот/ИИ/автотекст. */
export interface TranscriptMsg { side: "C" | "O" | "X"; text: string; at: Date }

const QUESTION_WINDOW_MS = 24 * 3600_000;
const ANSWER_GLUE_MS = 10 * 60_000;

export function pairsFromTranscript(msgs: TranscriptMsg[], channel: string, by: string): Array<Omit<OperatorExample, "at"> & { at: string }> {
  const sorted = [...msgs].filter((m) => m.text.trim()).sort((a, b) => a.at.getTime() - b.at.getTime());
  const out: Array<Omit<OperatorExample, "at"> & { at: string }> = [];
  let q: TranscriptMsg[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (m.side === "C") { q.push(m); continue; }
    if (m.side === "X" || !q.length) { q = []; continue; }
    const last = q[q.length - 1];
    if (m.at.getTime() - last.at.getTime() > QUESTION_WINDOW_MS) { q = []; continue; }
    const answer = [m.text.trim()];
    let end = m.at.getTime();
    while (i + 1 < sorted.length && sorted[i + 1].side === "O" && sorted[i + 1].at.getTime() - end < ANSWER_GLUE_MS) {
      i++;
      answer.push(sorted[i].text.trim());
      end = sorted[i].at.getTime();
    }
    out.push({ channel, by, question: q.map((x) => x.text.trim()).join("\n"), answer: answer.join("\n"), at: m.at.toISOString() });
    q = [];
  }
  return out;
}

