/**
 * Шаг геймпасса покупателя (20.10.2026): бот понимает ссылку/ключ на любом
 * шаге, админка просит у покупателя нужный шаг, тупики пишутся в заказ.
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
  BUYER_STEP_COMMANDS,
  BUYER_STEP_EVENT,
  BUYER_STEP_OPTIONS,
  buyerGuideUrl,
  buyerStepEventText,
  buyerStepMessage,
  classifyBuyerInput,
  looksLikeStrayApiKey,
  recordBuyerDeadEnd,
  stripHtml,
} from "../buyer-step";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", "..", rel), "utf8");
const KEY = "aBcD1234efGH5678ijKL9012mnOP3456qrST7890uvWX_yz-0123456789abcdef";

describe("что прислал покупатель — без знания шага", () => {
  it("ссылка на пасс — это пасс", () => {
    expect(classifyBuyerInput("https://www.roblox.com/game-pass/1969680833/Pass")).toEqual({ kind: "gamepass", passId: "1969680833" });
  });

  it("ключ Open Cloud — это ключ", () => {
    expect(classifyBuyerInput(KEY).kind).toBe("api_key");
  });

  it("ссылка на игру — не ключ и не пасс", () => {
    expect(classifyBuyerInput("https://www.roblox.com/games/123456789/My-Game").kind).toBe("game");
    expect(classifyBuyerInput("https://create.roblox.com/dashboard/creations/experiences/9876543210/overview").kind).toBe("game");
  });

  it.each([
    ["ник", "lokomotiv_2018"],
    ["код ВБ", "AB12CD3"],
    ["голый Pass ID — в шаге ника это может быть ник", "1969680833"],
    ["обычный текст", "спасибо, скину позже"],
    ["адрес без схемы", "roblox.com/users/123456789/profile-of-someone"],
    ["адрес .ru без схемы", "robloxbank.ru/guide?source=wb&skip=1&code=AB12CD3"],
    ["одни буквы", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    ["короткая строка", "abc123abc123abc123"],
  ])("%s — не ключ", (_label, text) => {
    expect(looksLikeStrayApiKey(text)).toBe(false);
  });
});

describe("сообщение «попросить у покупателя»", () => {
  const order = { wbCode: "AB12CD3", amount: 500, robloxUsername: "lox23_limon" };

  it("вся инструкция сверху, ниже части, у каждого значок, имя и подсказка", () => {
    expect(BUYER_STEP_OPTIONS.map((o) => o.kind)).toEqual(["create", "key", "link", "passid", "sale", "nick", "place", "custom"]);
    expect(BUYER_STEP_OPTIONS.map((o) => o.group)).toEqual(["whole", "part", "part", "part", "part", "part", "part", "custom"]);
    for (const option of BUYER_STEP_OPTIONS) {
      expect(option.icon.length).toBeGreaterThan(0);
      expect(option.hint.length).toBeGreaterThan(10);
    }
  });

  it("каждое сообщение говорит, что прислать можно прямо сюда, и называет код ВБ", () => {
    for (const { kind } of BUYER_STEP_OPTIONS) {
      const msg = buyerStepMessage(kind, order, "Пасс скрыт");
      expect(msg.html).toContain("AB12CD3");
      expect(msg.html.toLowerCase()).toMatch(/сюда/);
      expect(msg.buttons.length).toBeGreaterThan(0);
    }
  });

  it("💰 продажа и цена: точная цена пасса и ссылка на раздел гайда", () => {
    const msg = buyerStepMessage("sale", order);
    expect(msg.html).toContain(`${Math.ceil(order.amount / 0.7)} R$`);
    expect(msg.html).toContain("Item for Sale");
    const urls = msg.buttons.flat().filter((b): b is { label: string; url: string } => "url" in b).map((b) => b.url);
    expect(urls.some((u) => u.includes("stage=sale"))).toBe(true);
  });

  it("🔢 Pass ID ведёт в поле Pass ID гайда", () => {
    const urls = buyerStepMessage("passid", order).buttons.flat()
      .filter((b): b is { label: string; url: string } => "url" in b).map((b) => b.url);
    expect(urls.some((u) => u.includes("stage=passid"))).toBe(true);
  });

  it("клавиатуры влезают в лимиты VK (≤6 рядов, ≤10 кнопок, подпись ≤40)", () => {
    for (const { kind } of BUYER_STEP_OPTIONS) {
      const { buttons } = buyerStepMessage(kind, order, "x");
      expect(buttons.length).toBeLessThanOrEqual(6);
      expect(buttons.flat().length).toBeLessThanOrEqual(10);
      for (const b of buttons.flat()) expect(b.label.length).toBeLessThanOrEqual(40);
    }
  });

  it("ключ ведёт в ветку ключа, ссылка — в поле Pass ID", () => {
    const key = buyerStepMessage("key", order).buttons.flat();
    expect(key.some((b) => "url" in b && b.url.includes("stage=key"))).toBe(true);
    const link = buyerStepMessage("link", order).buttons.flat();
    expect(link.some((b) => "url" in b && b.url.includes("stage=passid"))).toBe(true);
  });

  it("личная инструкция несёт код и ник, прямой заказ — общую", () => {
    expect(buyerGuideUrl(order)).toBe("https://robloxbank.ru/guide?source=wb&skip=1&code=AB12CD3&username=lox23_limon");
    expect(buyerGuideUrl({ ...order, wbCode: "DIR-9D0FAFC0", isDirectOrder: true })).toBe("https://robloxbank.ru/guide?source=direct");
  });

  it("цена пасса — только когда заказ закрывается одним пассом", () => {
    expect(buyerStepMessage("link", order).html).toContain("715 R$");
    expect(buyerStepMessage("link", { ...order, amount: 3000 }).html).not.toMatch(/за <b>\d+ R\$/);
  });

  it("свой текст экранируется", () => {
    expect(buyerStepMessage("custom", order, "<b>жирно</b>").html).toContain("&lt;b&gt;жирно&lt;/b&gt;");
  });

  it("для VK теги убираются", () => {
    expect(stripHtml(buyerStepMessage("nick", order).html)).not.toMatch(/<[^>]+>/);
  });

  it("строки кнопок совпадают с обработчиками ботов", () => {
    const cb = read("bots/shared/admin.ts");
    expect(cb).toContain(`findGpStart:   "${BUYER_STEP_COMMANDS.tg.nick}"`);
    expect(cb).toContain(`sendGpLink:    "${BUYER_STEP_COMMANDS.tg.link}"`);
    const vk = read("bots/vk/handlers.ts");
    expect(vk).toContain(`msgPayload?.command === "${BUYER_STEP_COMMANDS.vk.nick}"`);
    expect(vk).toContain(`msgPayload?.command === "${BUYER_STEP_COMMANDS.vk.link}"`);
  });
});

describe("события заказа", () => {
  it("тупик пишется без присланного текста и не чаще раза в 10 минут", async () => {
    const created: Array<{ type: string; idempotencyKey: string; payload: unknown }> = [];
    const client = {
      wbOrder: { findFirst: async () => ({ id: "ord1" }) },
      orderEvent: { create: async (args: unknown) => { created.push((args as { data: (typeof created)[number] }).data); return {}; } },
    };
    await recordBuyerDeadEnd(client, { wbCode: "AB12CD3", via: "tg-bot", reason: "key_format", sentLength: 12 });
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe(BUYER_STEP_EVENT.DEAD_END);
    expect(created[0].idempotencyKey).toMatch(/^deadend:ord1:tg-bot:key_format:\d+$/);
    expect(JSON.stringify(created[0].payload)).not.toContain("AB12CD3");
  });

  it("повтор (P2002) и сбой базы не роняют поток", async () => {
    const dup = {
      wbOrder: { findFirst: async () => ({ id: "ord1" }) },
      orderEvent: { create: async () => { throw Object.assign(new Error("dup"), { code: "P2002" }); } },
    };
    await expect(recordBuyerDeadEnd(dup, { orderId: "ord1", via: "vk-bot", reason: "nick_format" })).resolves.toBeUndefined();
  });

  it("строки для карточки — человеческие", () => {
    expect(buyerStepEventText(BUYER_STEP_EVENT.SENT, { kind: "key", channel: "tg" })).toContain("в Telegram");
    expect(buyerStepEventText(BUYER_STEP_EVENT.SENT, { kind: "link", channel: null })).toContain("не доставлено");
    // «Pass ID» не превращается в «pass id» (хвост 20.10).
    expect(buyerStepEventText(BUYER_STEP_EVENT.SENT, { kind: "passid", channel: "tg" })).toContain("Pass ID");
    expect(buyerStepEventText(BUYER_STEP_EVENT.DEAD_END, { reason: "key_format" })).toContain("ключ");
    expect(buyerStepEventText("ORDER_CREATED", {})).toBeNull();
  });
});

describe("проводка в ботах", () => {
  const tg = read("bots/tg/handlers.ts");
  const vk = read("bots/vk/handlers.ts");

  it("ключ вне шага ключа принимается в обоих ботах", () => {
    expect(tg).toContain('classifyBuyerInput(text).kind === "api_key"');
    expect(tg).toContain("async function handleStrayApiKey");
    expect(vk).toContain('classifyBuyerInput(text).kind === "api_key"');
    expect(vk).toContain("async function handleVkStrayApiKey");
  });

  it("ссылка или ник в шаге ключа не получают «не похоже на ключ»", () => {
    expect(tg).toContain("await routeOffKeyInput(bot, ctx, keyState, text)");
    expect(vk).toContain("await routeVkOffKeyInput(ctx, vkUserId, state, text)");
  });

  it("«Мой заказ» в ожидании пасса даёт вход по ссылке", () => {
    expect(tg).toContain("Ник, ссылку на геймпасс или ключ можно прислать прямо сюда");
    expect(vk).toContain("Ник, ссылку на геймпасс или ключ можно прислать прямо сюда");
  });

  it("тупики пишутся в заказ в обоих ботах", () => {
    for (const reason of ["key_format", "nick_format", "link_format"]) {
      expect(tg).toContain(`reason: "${reason}"`);
      expect(vk).toContain(`reason: "${reason}"`);
    }
  });
});
