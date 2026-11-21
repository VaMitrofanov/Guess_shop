/* «Ждут ответа в ВК» на главной ТВА (11.11.2026): то же правило, что метка
   «Нужен человек», и строка уходит, когда менеджер ответил в диалоге сообщества. */
jest.mock("server-only", () => ({}), { virtual: true });
const queryRaw = jest.fn();
jest.mock("@/lib/prisma", () => ({ prisma: { $queryRawUnsafe: (...a: unknown[]) => queryRaw(...a) } }));

import { loadVkNeedsHuman } from "@/lib/vk-needs-human";

const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3_600_000);
const row = (vkId: string, text: string | null, o: Record<string, unknown> = {}) => ({
  vkId, at: ago(5), text, contextKey: "no_place", robux: false, ocr: null, ocrPending: null,
  orderStatus: "AWAITING_GAMEPASS", orderCompletedAt: null, wbCode: `C${vkId}`, name: "Аня", ...o,
});

function vkHistory(byPeer: Record<string, Array<{ out: number; date: number; admin_author_id?: number }>>) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (_url: unknown, init?: { body?: URLSearchParams }) => {
    const peer = String(init?.body?.get("peer_id"));
    calls.push(peer);
    return { json: async () => ({ response: { items: byPeer[peer] ?? [] } }) } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

describe("loadVkNeedsHuman", () => {
  beforeEach(() => { process.env.VK_TOKEN = "t"; queryRaw.mockReset(); });

  it("показывает только тех, кому нужен человек и кому не ответили; ссылка — в диалог сообщества", async () => {
    queryRaw.mockResolvedValue([
      row("1", "Нет компьютера"),
      row("2", "Когда придут робуксы?", { contextKey: "status", robux: true, orderStatus: "PENDING" }), // очередь — не человек
      row("3", null), // пустое нажатие
      row("4", "Отменить заказ"),
    ]);
    vkHistory({ "4": [{ out: 1, date: ago(1).getTime() / 1000, admin_author_id: 9 }] }); // 4-му ответили
    const res = await loadVkNeedsHuman();
    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ vkId: "1", wbCode: "C1", quote: "Нет компьютера" });
    expect(res.items[0].dialogUrl).toBe("https://vk.com/gim237309399?sel=1");
  });

  it("ответ бота (без admin_author_id) не считается ответом", async () => {
    queryRaw.mockResolvedValue([row("11", "Какую причину возврата выбрать?")]);
    vkHistory({ "11": [{ out: 1, date: ago(1).getTime() / 1000 }] });
    expect((await loadVkNeedsHuman()).total).toBe(1);
  });

  it("ВК вернул ошибку или не ответил — строку не показываем и «не ответили» не кэшируем", async () => {
    queryRaw.mockResolvedValue([row("31", "Отменить заказ")]);
    global.fetch = jest.fn(async () => ({ json: async () => ({ error: { error_msg: "Too many requests" } }) }) as Response) as unknown as typeof fetch;
    expect((await loadVkNeedsHuman()).total).toBe(0);
    global.fetch = jest.fn(async () => { throw new Error("timeout"); }) as unknown as typeof fetch;
    expect((await loadVkNeedsHuman()).total).toBe(0);
    vkHistory({ "31": [] }); // ВК ожил: ответа менеджера нет — строка появляется
    expect((await loadVkNeedsHuman()).total).toBe(1);
  });

  it("найденный ответ кэшируется — ВК второй раз не спрашиваем", async () => {
    queryRaw.mockResolvedValue([row("21", "Отменить заказ")]);
    const calls = vkHistory({ "21": [{ out: 1, date: ago(1).getTime() / 1000, admin_author_id: 9 }] });
    await loadVkNeedsHuman();
    await loadVkNeedsHuman();
    expect(calls.filter((p) => p === "21")).toHaveLength(1);
  });
});
