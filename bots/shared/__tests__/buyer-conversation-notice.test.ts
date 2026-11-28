import { isTrivialBuyerText, noteAdminReply, noteBuyerMessage, renderConversation, resetConversations } from "../buyer-conversation-notice";

function io() {
  const sent: string[] = [];
  const edits: string[] = [];
  const removed: number[] = [];
  let id = 100;
  return {
    sent, edits, removed,
    io: {
      // Telegram отвечает не сразу — иначе гонку параллельных сообщений не поймать.
      send: async (_t: unknown, text: string) => { await new Promise((r) => setTimeout(r, 5)); sent.push(text); return ++id; },
      edit: async (_t: unknown, _m: number, text: string) => { edits.push(text); return true; },
      remove: async (_t: unknown, m: number) => { removed.push(m); },
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

  it("через 10 минут — увед поднимается: новый с историей, старый удалён", async () => {
    const x = io();
    const base = { conversationKey: "dbs:3", head: "WB #3", targets: [target], io: x.io };
    await noteBuyerMessage({ ...base, text: "Вопрос", now: t0 });
    expect(await noteBuyerMessage({ ...base, text: "Ещё вопрос", now: t0 + 11 * 60_000 })).toBe("resurfaced");
    expect(x.sent).toHaveLength(2);
    expect(x.sent[1]).toContain("Вопрос");
    expect(x.sent[1]).toContain("покупатель пишет · 2");
    expect(x.removed).toEqual([101]);
  });

  it("два сообщения за один проход синка — один увед (гонка 16.11)", async () => {
    const x = io();
    const base = { conversationKey: "dbs:4", head: "WB #4", targets: [target], io: x.io };
    const results = await Promise.all([
      noteBuyerMessage({ ...base, text: "Алее", now: t0 }),
      noteBuyerMessage({ ...base, text: "Я 30 минут жду ответа", now: t0 }),
    ]);
    expect(results).toEqual(["opened", "appended"]);
    expect(x.sent).toHaveLength(1);
  });

  it("ответ админа дописывается в увед, следующее сообщение покупателя поднимает его", async () => {
    const x = io();
    const base = { conversationKey: "dbs:5", head: "WB #5", targets: [target], io: x.io };
    await noteBuyerMessage({ ...base, text: "Где робуксы?", now: t0 });
    expect(await noteAdminReply("dbs:5", "@admin", "📖 инструкция", t0 + 60_000)).toBe(true);
    expect(x.edits.at(-1)).toContain("↩️");
    expect(x.edits.at(-1)).toContain("ответили");
    expect(await noteBuyerMessage({ ...base, text: "Не открывается ссылка", now: t0 + 120_000 })).toBe("resurfaced");
    expect(x.sent.at(-1)).not.toContain("ответили");
    expect(await noteAdminReply("dbs:нет", "@admin", "x")).toBe(false);
  });

  it("«спасибо» после паузы не поднимает увед", async () => {
    const x = io();
    const base = { conversationKey: "dbs:6", head: "WB #6", targets: [target], io: x.io };
    await noteBuyerMessage({ ...base, text: "Вопрос", now: t0 });
    expect(await noteBuyerMessage({ ...base, text: "Спасибо!", now: t0 + 30 * 60_000 })).toBe("appended");
    expect(x.sent).toHaveLength(1);
  });

  it("пустяковые тексты распознаются, вопросы — нет", () => {
    for (const t of ["Спасибо", "спасибо большое!", "Здравствуйте", "ок", "??", "👍"]) expect(isTrivialBuyerText(t)).toBe(true);
    for (const t of ["Когда придут?", "Спасибо, а где код?", "123456"]) expect(isTrivialBuyerText(t)).toBe(false);
  });
});

describe("вид уведа «покупатель пишет» — вариант B (17.11)", () => {
  it("кружок по заказу, кто/заказ тезисами, текст отдельно", () => {
    const text = renderConversation({
      head: "WB #1 · <code>HZ8AJ72</code>", who: "👤 Сеня Римушка · ВК · первый заказ",
      order: "📦 <code>HZ8AJ72</code> · <b>1 000 R$</b> · ждёт выкупа <b>23 ч</b>",
      marker: "waiting", status: [], lines: ["<i>12:26</i> почти сутки прошли"], total: 1, answered: true,
    });
    expect(text).toBe([
      "🟡 <b>DBS · покупатель пишет · ответили</b>",
      "👤 Сеня Римушка · ВК · первый заказ",
      "📦 <code>HZ8AJ72</code> · <b>1 000 R$</b> · ждёт выкупа <b>23 ч</b>",
      "",
      "<i>12:26</i> почти сутки прошли",
    ].join("\n"));
  });
});
