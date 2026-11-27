jest.mock("../../shared/db", () => ({ db: {} }));
jest.mock("../pa-ai", () => ({ loadSettings: jest.fn() }));
jest.mock("@anthropic-ai/sdk", () => jest.fn(), { virtual: true });
jest.mock("@anthropic-ai/sdk/helpers/zod", () => ({ zodOutputFormat: jest.fn() }), { virtual: true });

import { ideaForReply, type Idea } from "../ideas-worker";

const item = (n: number, messageId: number, triageMessageId?: number): Idea =>
  ({ n, at: "2026-11-27T00:00:00Z", from: "@x", text: "t", photo: null, messageId, status: "queued", triageMessageId });

describe("ответ в теме = уточнение к задаче", () => {
  const items = [item(1, 100, 101), item(2, 200, 201)];
  it("по исходному сообщению", () => expect(ideaForReply(items, 200, "ещё")?.n).toBe(2));
  it("по карточке бота", () => expect(ideaForReply(items, 101, "ещё")?.n).toBe(1));
  it("по #N в начале", () => expect(ideaForReply(items, undefined, "#2 и вот ещё")?.n).toBe(2));
  it("иначе — новая запись", () => expect(ideaForReply(items, 999, "новая идея")).toBeNull());
});
