/* ─────────────────────────────────────────────────────────────────────────────
   Свип вопросов к карточкам WB (12.11.2026).

   Раз в 10 минут: неотвеченные вопросы → `classifyQuestion` → действие.
   • типовой вопрос — ответ шаблоном, без уведомления;
   • код получения в вопросе — вопрос отклоняем (код не публикуется), пуш
     с кодом и заказом, похожим по имени: его можно ввести в консоли DBS;
   • жалоба / возврат — ответ шаблоном «напишите в чат заказа» + запись в
     «Риски» + пуш с похожими заказами (решение владельца: «пробуем с уведами»);
   • непонятный вопрос — не отвечаем, запись в «Риски» + пуш: отвечает человек
     в кабинете WB.

   Ответ, который не ушёл (сеть, лимит WB), уйдёт на следующем проходе: вопрос
   остаётся в неотвеченных. Пуш — один на вопрос, по `RiskEvent.dedupeKey`, и
   приходит, даже если WB ответ не принял.
   Выключатель — `WB_QUESTIONS_AUTOREPLY=off`.
   ───────────────────────────────────────────────────────────────────────── */

import { classifyQuestion, type QuestionReply } from "./wb-question-templates";
import { fetchUnansweredQuestions, replyToQuestion, type WbQuestion } from "./wb-delivery-api";
import { notifyWbQuestion } from "./wb-delivery-admin-notify";
import { buyerKeyOf, recordRiskEvents, type RiskEventInput } from "./risk-events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Сколько вопросов разбираем за проход (лимит WB — 3 запроса в секунду). */
const SWEEP_CAP = 30;
/** Окно поиска заказа по имени покупателя. */
const CANDIDATE_WINDOW_DAYS = 60;

export interface QuestionsSweepDeps {
  fetchQuestions: () => Promise<WbQuestion[]>;
  reply: (id: string, text: string, mode: "answer" | "reject") => Promise<void>;
  notify: typeof notifyWbQuestion;
  now?: Date;
  pauseMs?: number;
}

export interface QuestionsSweepResult {
  seen: number;
  answered: number;
  rejected: number;
  complaints: number;
  unknown: number;
  failed: number;
}

export function questionsAutoreplyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.WB_QUESTIONS_AUTOREPLY ?? "").trim().toLowerCase() !== "off";
}

/** Шестизначный код получения из текста вопроса («595 081» → «595081»). */
export function deliveryCodeIn(text: string): string | null {
  const m = /(?:^|\D)(\d{3}) ?(\d{3})(?:\D|$)/.exec(text);
  return m ? `${m[1]}${m[2]}` : null;
}

const STATUS_RU: Record<string, string> = {
  AWAITING_GAMEPASS: "ждём геймпасс", PENDING: "к выкупу", IN_PROGRESS: "выкупается",
  COMPLETED: "выкуплен", REJECTED: "отменён", ERROR: "ошибка выкупа",
};

/** Заказы на этой карточке с тем же именем покупателя — свежие первыми. */
async function likelyOrders(db: Db, q: WbQuestion, now: Date) {
  const name = (q.userName ?? "").trim();
  const nmId = q.productDetails?.nmId;
  if (name.length < 2 || !nmId) return [];
  const rows = await db.wbMarketplaceOrder.findMany({
    where: {
      isTest: false,
      nmId,
      buyerName: { equals: name, mode: "insensitive" },
      createdAt: { gte: new Date(now.getTime() - CANDIDATE_WINDOW_DAYS * 86_400_000) },
    },
    select: {
      wbOrderId: true, denominationSnapshot: true, completedAt: true, cancelledAt: true,
      wbCode: { select: { code: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 3,
  }).catch(() => []);
  const codes = rows.map((r: { wbCode: { code: string } | null }) => r.wbCode?.code).filter(Boolean);
  const own = codes.length
    ? await db.wbOrder.findMany({ where: { wbCode: { in: codes } }, select: { wbCode: true, status: true } }).catch(() => [])
    : [];
  const statusBy = new Map<string, string>(own.map((o: { wbCode: string; status: string }) => [o.wbCode, o.status]));
  return rows.map((r: {
    wbOrderId: string; denominationSnapshot: number | null; completedAt: Date | null; cancelledAt: Date | null;
    wbCode: { code: string } | null;
  }) => {
    const code = r.wbCode?.code ?? null;
    const own = code ? statusBy.get(code) : undefined;
    const status = r.cancelledAt ? "отменён на WB"
      : own ? STATUS_RU[own] ?? own
        : r.completedAt ? "доставка закрыта, код не вводили" : "ждёт код получения";
    return { code, wbOrderId: r.wbOrderId, amount: r.denominationSnapshot, status };
  });
}

function riskEventOf(q: WbQuestion, reply: QuestionReply | null, answered: boolean, top: { code: string | null; wbOrderId: string; amount: number | null } | undefined, now: Date): RiskEventInput {
  const at = q.createdDate ? Date.parse(q.createdDate) : NaN;
  return {
    kind: "BUYER_QUESTION",
    dedupeKey: `question:${q.id}`,
    wbCode: top?.code ?? null,
    wbOrderId: top?.wbOrderId ?? null,
    buyerName: q.userName?.trim() || null,
    buyerKey: buyerKeyOf(q.userName),
    nmId: q.productDetails?.nmId ?? null,
    amount: top?.amount ?? null,
    text: [reply ? `[${reply.topic === "REFUND" ? "возврат" : "жалоба"}]` : "[без шаблона]", q.text].join(" ").slice(0, 1000),
    action: answered ? "answered" : "none",
    occurredAt: Number.isFinite(at) ? new Date(at) : now,
  };
}

export async function runWbQuestionsSweep(db: Db, deps: Partial<QuestionsSweepDeps> = {}): Promise<QuestionsSweepResult> {
  const d: QuestionsSweepDeps = {
    fetchQuestions: () => fetchUnansweredQuestions(),
    reply: replyToQuestion,
    notify: notifyWbQuestion,
    pauseMs: 400,
    ...deps,
  };
  const now = d.now ?? new Date();
  const out: QuestionsSweepResult = { seen: 0, answered: 0, rejected: 0, complaints: 0, unknown: 0, failed: 0 };
  const questions = (await d.fetchQuestions()).slice(0, SWEEP_CAP);
  out.seen = questions.length;
  if (questions.length === 0) return out;

  const known = new Set<string>((await db.riskEvent.findMany({
    where: { dedupeKey: { in: questions.map((q) => `question:${q.id}`) } },
    select: { dedupeKey: true },
  }).catch(() => [])).map((e: { dedupeKey: string }) => e.dedupeKey));

  for (const q of questions) {
    const productName = q.productDetails?.productName ?? null;
    const reply = classifyQuestion({ text: q.text, nmId: q.productDetails?.nmId, productName });
    const send = async (text: string, mode: "answer" | "reject") => {
      try {
        await d.reply(q.id, text, mode);
        if (d.pauseMs) await new Promise((r) => setTimeout(r, d.pauseMs));
        return true;
      } catch (error) {
        out.failed++;
        console.error(`[wb-questions] ответ на ${q.id} не ушёл: ${error instanceof Error ? error.message : error}`);
        return false;
      }
    };

    if (reply?.action === "answer") {
      if (await send(reply.text, "answer")) out.answered++;
      continue;
    }

    if (reply?.action === "reject") {
      if (!(await send(reply.text, "reject"))) continue;
      out.rejected++;
      const code = deliveryCodeIn(q.text);
      const candidates = await likelyOrders(db, q, now);
      // Пуш — только если есть заказ, которому этот код может помочь.
      if (candidates.some((c: { status: string }) => c.status === "ждёт код получения")) {
        d.notify({ kind: "code", productName, buyerName: q.userName ?? null, text: q.text, answered: false, code, candidates });
      }
      continue;
    }

    // Жалоба/возврат — отвечаем шаблоном и зовём человека; непонятное — только зовём.
    const complaint = reply?.action === "human";
    // Не ушёл ответ — пуш всё равно: человек нужен в любом случае, а ответ
    // повторится на следующем проходе (вопрос останется в неотвеченных).
    const answered = complaint ? await send(reply.text, "answer") : false;
    if (complaint) out.complaints++;
    else out.unknown++;
    if (known.has(`question:${q.id}`)) continue;
    const candidates = await likelyOrders(db, q, now);
    await recordRiskEvents(db, [riskEventOf(q, reply, answered, candidates[0], now)]).catch(() => 0);
    d.notify({
      kind: complaint ? "complaint" : "unknown",
      productName,
      buyerName: q.userName ?? null,
      text: q.text,
      answered,
      candidates,
    });
  }
  return out;
}
