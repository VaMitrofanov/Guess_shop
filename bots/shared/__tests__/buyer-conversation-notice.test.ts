import { isTrivialBuyerText, noteBuyerMessage, resetConversations } from "../buyer-conversation-notice";

function io() {
  const sent: string[] = [];
  const edits: string[] = [];
  let id = 100;
  return {
    sent, edits,
    io: {
      send: async (_t: unknown, text: string) => { sent.push(text); return ++id; },
      edit: async (_t: unknown, _m: number, text: string) => { edits.push(text); return true; },
    },
  };
}
const target = { key: "g#1", chatId: "g", extra: {} };

describe("сообщения покупателя — один увед на разговор", () => {
  beforeEach(() => resetConversations());
  const t0 = Date.UTC(2026, 10, 15, 9, 1);

  it("второе сообщение в 10 минут дописывается правкой, а не новым уведом", async () => {
    const x = io();
    const base = { conversationKey: "dbs:1", head: "WB #1 · <code>K7Q2MXA</code>", who: "Анна", targets: [target], io: x.io };
    expect(await noteBuyerMessage({ ...base, text: "Здравствуйте, а когда придут?", now: t0 })).toBe("opened");
    expect(await noteBuyerMessage({ ...base, text: "Код <script>", now: t0 + 60_000 })).toBe("appended");
    expect(x.sent).toHaveLength(1);
    expect(x.edits[0]).toContain("покупатель пишет · 2");
    expect(x.edits[0]).toContain("Код &lt;script&gt;");
    expect(x.edits[0]).not.toContain("Дальше");
  });

  it("«спасибо» нового уведа не открывает, но в открытый дописывается", async () => {
    const x = io();
    const base = { conversationKey: "dbs:2", head: "WB #2", targets: [target], io: x.io };
    expect(await noteBuyerMessage({ ...base, text: "Спасибо!", now: t0 })).toBe("skipped");
    expect(x.sent).toHaveLength(0);
    await noteBuyerMessage({ ...base, text: "Робуксы не пришли", now: t0 });
    expect(await noteBuyerMessage({ ...base, text: "ок", now: t0 + 1000 })).toBe("appended");
  });

  it("через 10 минут — новый увед", async () => {
    const x = io();
    const base = { conversationKey: "dbs:3", head: "WB #3", targets: [target], io: x.io };
    await noteBuyerMessage({ ...base, text: "Вопрос", now: t0 });
    expect(await noteBuyerMessage({ ...base, text: "Ещё вопрос", now: t0 + 11 * 60_000 })).toBe("opened");
    expect(x.sent).toHaveLength(2);
  });

  it("пустяковые тексты распознаются, вопросы — нет", () => {
    for (const t of ["Спасибо", "спасибо большое!", "Здравствуйте", "ок", "??", "👍"]) expect(isTrivialBuyerText(t)).toBe(true);
    for (const t of ["Когда придут?", "Спасибо, а где код?", "123456"]) expect(isTrivialBuyerText(t)).toBe(false);
  });
});
