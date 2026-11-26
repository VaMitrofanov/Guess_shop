jest.mock("../admin", () => ({ ADMIN_IDS: [] }));
jest.mock("../notify", () => ({ tgSend: jest.fn() }));
jest.mock("../support-ai", () => ({ supportCardTarget: jest.fn(), supportChannelMode: jest.fn() }));

import { aggregateAiLog, formatAiStats, type AiChannel, type AiMode } from "../support-ai-log";

const row = (channel: string, peerKey: string, action: string, mode = "on") => ({ channel, peerKey, action, mode });

describe("статистика ИИ по площадкам", () => {
  const stats = aggregateAiLog([
    row("tg_pa", "tg:1", "reply"), row("tg_pa", "tg:1", "reply"),
    row("tg_pa", "tg:2", "reply"), row("tg_pa", "tg:2", "escalate"),
    row("wb_chat", "wb:A", "reply"), row("wb_chat", "wb:A", "reply"),
    row("wb_chat", "wb:B", "escalate"),
    row("vk_bot", "vk:9", "reply", "dry"), row("vk_bot", "vk:9", "escalate", "dry"),
    row("tg_bot", "tg:5", "ignore"),
  ]);

  it("считает чаты, а не реплики; чат с передачей — не «сам»", () => {
    expect(stats.tg_pa).toMatchObject({ chats: 2, selfChats: 1, handedChats: 1, replies: 3, handoffs: 1 });
    expect(stats.wb_chat).toMatchObject({ chats: 2, selfChats: 1, handedChats: 1 });
    expect(stats.tg_bot).toMatchObject({ chats: 1, selfChats: 1, ignores: 1 });
  });

  it("dry — отдельно и не попадает в боевые чаты", () => {
    expect(stats.vk_bot).toMatchObject({ chats: 0, dryChats: 1, replies: 0 });
  });

  it("текст: площадки раздельно, режимы, доля «сам», знаменатель WB", () => {
    const modes: Record<AiChannel, AiMode> = { tg_pa: "on", tg_bot: "on", vk_bot: "dry", wb_chat: "on" };
    const html = formatAiStats(stats, modes, { title: "ИИ вчера", wbTotalChats: 40 });
    expect(html).toContain("📱 <b>Telegram</b> — 3 чата, сам 2");
    expect(html).toContain("@RobloxBank_PA (отвечает): 2 чата — сам 1 (50%), вам 1");
    expect(html).toContain("сообщество (тест): тест: 1 чат");
    expect(html).toContain("чаты заказов (отвечает): 2 чата из 40 — сам 1 (50%), вам 1");
  });

  it("площадка без работы ИИ — так и пишем, с режимом", () => {
    const none = aggregateAiLog([]);
    const html = formatAiStats(none, { tg_pa: "on", tg_bot: "off", vk_bot: "off", wb_chat: "on" }, { title: "x", wbTotalChats: 12 });
    expect(html).toContain("бот @RobloxBankBot (выключен): ИИ не работал");
    expect(html).toContain("чаты заказов (отвечает): ИИ не работал · чатов с покупателями 12");
  });
});
