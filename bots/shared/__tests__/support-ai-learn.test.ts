jest.mock("../db", () => ({ db: {} }));

import { exampleWorthKeeping, mergeExamples, pickExamples, type OperatorExample } from "../support-ai-learn";
import { pairsFromTranscript, type TranscriptMsg } from "../support-ai-pairs";
import { paExportPairs, wbTranscripts } from "../support-ai-harvest";
import { notStartedFact } from "../wb-chat-ai";
import { vkTranscript } from "../../vk/vk-ai-learn";

const t = (min: number) => new Date(Date.UTC(2026, 10, 28, 10, min));
const m = (side: TranscriptMsg["side"], text: string, min: number): TranscriptMsg => ({ side, text, at: t(min) });

describe("pairsFromTranscript", () => {
  it("склеивает вопросы и ответы оператора подряд", () => {
    const p = pairsFromTranscript([
      m("C", "Здравствуйте, нет компьютера", 0), m("C", "что делать?", 1),
      m("O", "Понимаю, есть два варианта.", 5), m("O", "Какой удобнее?", 6),
    ], "wb_chat", "op");
    expect(p).toHaveLength(1);
    expect(p[0].question).toBe("Здравствуйте, нет компьютера\nчто делать?");
    expect(p[0].answer).toBe("Понимаю, есть два варианта.\nКакой удобнее?");
  });
  it("ответ бота обрывает вопрос — на него ответила машина", () => {
    expect(pairsFromTranscript([m("C", "когда робуксы", 0), m("X", "автоответ", 1), m("O", "оператор пишет позже", 30)], "vk_bot", "op")).toHaveLength(0);
  });
});

describe("wbTranscripts", () => {
  const ev = (i: number, sender: string, text: string, extra: Partial<{ wbEventId: string; attachmentsMeta: unknown }> = {}) =>
    ({ chatId: "c1", wbEventId: `e${i}`, sender, textRedacted: text, sentAt: t(i), attachmentsMeta: null, ...extra });
  it("ответ ИИ, автотекст и эхо локальной записи бота — не оператор", () => {
    const chats = wbTranscripts([
      ev(0, "client", "Где мои робуксы?"),
      ev(1, "seller", "Спасибо, код доставки получен! Заказ подтверждён"),
      ev(2, "seller", "ответ ии про геймпасс"),
      ev(3, "seller", "напоминание бота", { wbEventId: "local:1" }),
      ev(4, "seller", "напоминание бота"),
      ev(5, "seller", "Живой ответ менеджера из кабинета"),
    ], ["ответ ии про геймпасс"]);
    expect(chats.get("c1")!.map((x) => x.side)).toEqual(["C", "X", "X", "X", "X", "O"]);
  });
  it("ответ из TG засчитан один раз (локальная запись + эхо WB)", () => {
    const chats = wbTranscripts([
      ev(0, "client", "Как поменять ник?"),
      ev(1, "seller", "Напишите новый ник, поменяем", { wbEventId: "local:2", attachmentsMeta: { via: "tg-reply" } }),
      ev(2, "seller", "Напишите новый ник, поменяем"),
    ], []);
    expect(chats.get("c1")!.filter((x) => x.side === "O")).toHaveLength(1);
  });
});

it("paExportPairs: C → O из выгрузки PA, бот (B) не учит", () => {
  const line = JSON.stringify({ msgs: [
    { t: "2026-11-27T10:00", s: "C", x: "Давайте тогда через пас" },
    { t: "2026-11-27T10:05", s: "O", x: "Да, хорошо. Тогда цена 2200 рублей" },
    { t: "2026-11-27T11:00", s: "C", x: "а сколько ждать" },
    { t: "2026-11-27T11:01", s: "B", x: "ответ бота" },
  ] });
  const p = paExportPairs(line);
  expect(p).toHaveLength(1);
  expect(p[0].channel).toBe("tg_pa");
});

it("vkTranscript: admin_author_id — менеджер, без него — бот", () => {
  expect(vkTranscript([
    { date: 1, from_id: 5, text: "a" },
    { date: 2, out: 1, from_id: -1, text: "b" },
    { date: 3, out: 1, from_id: -1, admin_author_id: 9, text: "c" },
  ]).map((x) => x.side)).toEqual(["C", "X", "O"]);
});

describe("библиотека", () => {
  const ex = (q: string, a: string, at: string, channel = "wb_chat"): OperatorExample => ({ channel, question: q, answer: a, by: "op", at });
  it("не учимся на паролях и кодах доставки", () => {
    expect(exampleWorthKeeping("мой логин и пароль", "спасибо, сейчас войдём")).toBe(false);
    expect(exampleWorthKeeping("код 123456 подходит?", "да, всё верно, спасибо")).toBe(false);
  });
  it("не учимся на давлении отзывом, грубости и других площадках в чате WB", () => {
    expect(exampleWorthKeeping("верните деньги", "Исправьте отзыв, тогда оформим возврат средств", "wb_chat")).toBe(false);
    expect(exampleWorthKeeping("где инструкция", "Напишите нам в тг, там всё подробно расскажем", "wb_chat")).toBe(false);
    expect(exampleWorthKeeping("где инструкция", "Напишите нам в тг, там всё подробно расскажем", "vk_bot")).toBe(true);
    expect(exampleWorthKeeping("код не подходит", "Вот ваш код ABCDE-12345-FGHIJ, введите его", "vk_bot")).toBe(false);
  });
  it("дубль вопроса заменяется свежим ответом", () => {
    const lib = mergeExamples([ex("Когда придут робуксы?", "старый ответ оператора на этот вопрос", "2026-11-01T00:00:00Z")],
      [ex("когда придут  робуксы?", "новый ответ оператора на этот вопрос", "2026-11-28T00:00:00Z")]);
    expect(lib).toHaveLength(1);
    expect(lib[0].answer).toBe("новый ответ оператора на этот вопрос");
  });
  it("в промпт — похожие на вопрос, а не только свежие", () => {
    const lib = [
      ex("Спасибо большое", "Пожалуйста, обращайтесь, всегда рады помочь!", "2026-11-28T00:00:00Z"),
      ex("Привет как дела", "Здравствуйте, подскажите, чем помочь?", "2026-11-27T00:00:00Z"),
      ex("нет компьютера, плейс не создаётся с телефона", "Есть два варианта: создадим сами…", "2026-10-01T00:00:00Z"),
    ];
    const picked = pickExamples(lib, "У меня нет компьютера, только телефон", "wb_chat", 2);
    expect(picked[0].question).toContain("компьютера");
  });
});

it("notStartedFact: заказа робуксов нет, а код WB есть — не «не нашли»", () => {
  expect(notStartedFact("WN4CK2V", 0)).toContain("НЕ пиши «не нашли заказ»");
  expect(notStartedFact("WN4CK2V", 1)).toBeNull();
  expect(notStartedFact(null, 0)).toBeNull();
});
