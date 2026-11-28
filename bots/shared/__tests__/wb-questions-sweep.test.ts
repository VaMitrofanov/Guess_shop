/**
 * Свип вопросов WB (12.11.2026): кому отвечаем, что скрываем, кого зовём.
 */
import { deliveryCodeIn, questionsAutoreplyEnabled, runWbQuestionsSweep } from "../wb-questions-sweep";
import type { WbQuestion } from "../wb-delivery-api";

const card = { nmId: 967446616, productName: "Карта пополнения 500 Robux Роблокс Робуксы" };
const q = (id: string, text: string, userName = "Анна"): WbQuestion => ({ id, text, userName, productDetails: card, createdDate: "2026-11-12T10:00:00Z" });

function fakeDb(opts: { known?: string[]; orders?: unknown[] } = {}) {
  const recorded: unknown[] = [];
  const db = {
    riskEvent: {
      findMany: async () => (opts.known ?? []).map((dedupeKey) => ({ dedupeKey })),
      createMany: async ({ data }: { data: unknown[] }) => { recorded.push(...data); return { count: data.length }; },
    },
    wbMarketplaceOrder: { findMany: async () => opts.orders ?? [] },
    wbOrder: { findMany: async () => [] },
  };
  return { db, recorded };
}

function run(questions: WbQuestion[], dbOpts: Parameters<typeof fakeDb>[0] = {}, failReply = false) {
  const { db, recorded } = fakeDb(dbOpts);
  const replies: Array<{ id: string; mode: string; text: string }> = [];
  const notices: Array<{ kind: string }> = [];
  return runWbQuestionsSweep(db, {
    fetchQuestions: async () => questions,
    reply: async (id, text, mode) => {
      if (failReply) throw new Error("WB_MARKETPLACE_429");
      replies.push({ id, text, mode });
    },
    notify: (n) => { notices.push(n); },
    pauseMs: 0,
  }).then((res) => ({ res, replies, notices, recorded }));
}

describe("wb-questions-sweep", () => {
  it("типовой вопрос — ответ шаблоном, без пуша и без записи", async () => {
    const { res, replies, notices, recorded } = await run([q("1", "через сколько придут робуксы?")]);
    expect(res.answered).toBe(1);
    expect(replies[0]).toMatchObject({ id: "1", mode: "answer" });
    expect(notices).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });

  it("код в вопросе — отклоняем; пуш только если есть заказ, ждущий код", async () => {
    const waiting = { wbOrderId: "6254", denominationSnapshot: 500, completedAt: null, cancelledAt: null, wbCode: null };
    const a = await run([q("2", "Код 005182")]);
    expect(a.replies[0].mode).toBe("reject");
    expect(a.replies[0].text).not.toContain("005182");
    expect(a.notices).toHaveLength(0);
    const b = await run([q("2", "Код 005182")], { orders: [waiting] });
    expect(b.notices[0]).toMatchObject({ kind: "code", code: "005182" });
  });

  it("жалоба — ответ шаблоном + запись в «Риски» + пуш", async () => {
    const { res, replies, notices, recorded } = await run([q("3", "у меня не пришли робуксы спустя 8 ДНЕЙ,что мне делать??")]);
    expect(res.complaints).toBe(1);
    expect(replies[0].mode).toBe("answer");
    expect(replies[0].text).toContain("чат заказа");
    expect(notices[0]).toMatchObject({ kind: "complaint", answered: true });
    expect(recorded[0]).toMatchObject({ kind: "BUYER_QUESTION", dedupeKey: "question:3", action: "answered", buyerName: "Анна" });
  });

  it("непонятный вопрос — не отвечаем, но зовём человека", async () => {
    const { replies, notices, recorded } = await run([q("4", "Когда вергвься жерьги?")]);
    expect(replies).toHaveLength(0);
    expect(notices[0]).toMatchObject({ kind: "unknown", answered: false });
    expect(recorded[0]).toMatchObject({ action: "none" });
  });

  it("про уже записанный вопрос второй пуш не шлём", async () => {
    const { notices } = await run([q("4", "Когда вергвься жерьги?")], { known: ["question:4"] });
    expect(notices).toHaveLength(0);
  });

  it("WB не принял ответ на жалобу — пуш всё равно, ответ повторится", async () => {
    const { res, notices, recorded } = await run([q("5", "робуксы не пришли")], {}, true);
    expect(res.failed).toBe(1);
    expect(notices[0]).toMatchObject({ kind: "complaint", answered: false });
    expect(recorded[0]).toMatchObject({ action: "none" });
  });

  it("код получения достаётся из текста в любом виде", () => {
    expect(deliveryCodeIn("595 081 код")).toBe("595081");
    expect(deliveryCodeIn("код доставки:026 720")).toBe("026720");
    expect(deliveryCodeIn("через сколько придут")).toBeNull();
  });

  it("выключатель", () => {
    expect(questionsAutoreplyEnabled({})).toBe(true);
    expect(questionsAutoreplyEnabled({ WB_QUESTIONS_AUTOREPLY: "off" })).toBe(false);
  });
});
