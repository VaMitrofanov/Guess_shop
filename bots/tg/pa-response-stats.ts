/* ─────────────────────────────────────────────────────────────────────────────
   Время ответа поддержки @RobloxBank_PA (13.11.2026) — чистый расчёт.

   «Обращение» — первая реплика покупателя после нашего ответа (или первая в
   чате). Ответ на него — первое наше сообщение после. Наш ответ бывает от
   человека или от бота аккаунта (Telegram Business: у сообщения есть
   `viaBusinessBotId`) — считаем отдельно, это и есть «сколько закрыл бот».
   ───────────────────────────────────────────────────────────────────────── */

export interface ChatMsg {
  /** Секунды Unix. */
  date: number;
  out: boolean;
  /** Отправил бот аккаунта (автоответ/ИИ), а не человек. */
  viaBot?: boolean;
}

export interface ResponseStats {
  /** Обращений покупателей за окно. */
  turns: number;
  /** Ответил человек / бот аккаунта / ещё никто. */
  byHuman: number;
  byBot: number;
  unanswered: number;
  /** Медиана и 90-й перцентиль ответа ЧЕЛОВЕКА, минуты. */
  medianMin: number | null;
  p90Min: number | null;
  /** Человек отвечал дольше часа. */
  overHour: number;
}

export function emptyStats(): ResponseStats {
  return { turns: 0, byHuman: 0, byBot: 0, unanswered: 0, medianMin: null, p90Min: null, overHour: 0 };
}

/** Обращения одного чата, начатые в окне [from, to). Сообщения — в любом порядке. */
export function chatTurns(messages: ChatMsg[], from: number, to: number): Array<{ at: number; delaySec: number | null; viaBot: boolean }> {
  const sorted = [...messages].sort((a, b) => a.date - b.date);
  const out: Array<{ at: number; delaySec: number | null; viaBot: boolean }> = [];
  let openAt: number | null = null;
  for (const m of sorted) {
    if (!m.out) {
      if (openAt === null) openAt = m.date;
      continue;
    }
    if (openAt !== null) {
      if (openAt >= from && openAt < to) out.push({ at: openAt, delaySec: m.date - openAt, viaBot: Boolean(m.viaBot) });
      openAt = null;
    }
  }
  if (openAt !== null && openAt >= from && openAt < to) out.push({ at: openAt, delaySec: null, viaBot: false });
  return out;
}

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

export function summarizeTurns(turns: Array<{ delaySec: number | null; viaBot: boolean }>): ResponseStats {
  const s = emptyStats();
  const human: number[] = [];
  for (const t of turns) {
    s.turns++;
    if (t.delaySec === null) s.unanswered++;
    else if (t.viaBot) s.byBot++;
    else {
      s.byHuman++;
      human.push(t.delaySec);
      if (t.delaySec > 3600) s.overHour++;
    }
  }
  if (human.length) {
    human.sort((a, b) => a - b);
    s.medianMin = Math.round(percentile(human, 0.5) / 60);
    s.p90Min = Math.round(percentile(human, 0.9) / 60);
  }
  return s;
}

const fmtMin = (m: number | null) => m === null ? "—" : m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;

/** Строки для сводки/команды — без HTML. */
export function formatResponseStats(s: ResponseStats, label: string): string {
  if (s.turns === 0) return `⏱ Поддержка ${label}: обращений не было.`;
  return [
    `⏱ Поддержка ${label}: обращений ${s.turns}`,
    `• ответил человек — ${s.byHuman}, медиана ${fmtMin(s.medianMin)}, 90% — до ${fmtMin(s.p90Min)}${s.overHour ? `, дольше часа — ${s.overHour}` : ""}`,
    `• ответил бот сам — ${s.byBot}`,
    s.unanswered ? `• без ответа — ${s.unanswered}` : null,
  ].filter(Boolean).join("\n");
}
