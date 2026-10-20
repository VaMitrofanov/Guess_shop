/**
 * «Меню настройки геймпассов» — одно на все поверхности админки.
 *
 * Замечание владельца 19.10.2026: «видел фикс по добавлению ключа вручную, но
 * только в одном месте (в ТВА в меню в заказах), сделай, чтобы можно было везде
 * добавить (как и остальное)… меню настройки геймпассов должно быть удобным и
 * одинаковым, что в ТВА, что на сайте, что в разных разделах».
 *
 * Поэтому тест держит не вёрстку, а СОСТАВ: один список инструментов, одни
 * слова, одни предусловия — и ключ присутствует на каждой поверхности, где
 * заказу вообще меняют геймпасс.
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
  GAMEPASS_TOOLS,
  GAMEPASS_ATTACHABLE_STATUSES,
  gamepassTool,
  gamepassToolsFor,
  gamepassToolsRefusal,
  hasGamepassTool,
  isUnpaidDirectOrder,
} from "@/lib/gamepass-tools";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** Каждая поверхность, с которой админ меняет геймпасс заказа. */
const SURFACES = [
  "src/app/twa/_components/screens/OrdersScreen.tsx",
  "src/app/twa/_components/OrderSheet.tsx",
  "src/components/admin/orders/order-dossier.tsx",
  "src/components/admin/orders/order-editor.tsx",
  "src/components/admin/orders/order-detail-tools.tsx",
];

describe("список инструментов", () => {
  it("пять инструментов, и ключ первый — им заказ закрывается за минуту", () => {
    expect(GAMEPASS_TOOLS.map(tool => tool.id)).toEqual(["key", "link", "nick", "ask", "split"]);
  });

  it("у каждого есть значок, имя и объяснение «зачем»", () => {
    for (const tool of GAMEPASS_TOOLS) {
      expect(tool.icon.length).toBeGreaterThan(0);
      expect(tool.label.length).toBeGreaterThan(3);
      expect(tool.hint.length).toBeGreaterThan(10);
    }
  });

  it("имена уникальны — в меню не должно быть двух похожих строк", () => {
    const labels = GAMEPASS_TOOLS.map(tool => tool.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("ключ описан как «сделаем сами»", () => {
    expect(gamepassTool("key").label).toBe("Ключ покупателя");
    expect(gamepassTool("key").hint).toContain("сами");
  });
});

describe("предусловия — те же, что на сервере", () => {
  const order = (over: Record<string, unknown> = {}) => ({
    status: "AWAITING_GAMEPASS",
    heldAt: null,
    isDirectOrder: false,
    paidAt: null,
    robloxUsername: "lox23_limon",
    ...over,
  });

  it("живому заказу доступно всё", () => {
    expect(gamepassToolsFor(order()).map(t => t.id)).toEqual(["key", "link", "nick", "ask", "split"]);
    expect(gamepassToolsRefusal(order())).toBeNull();
  });

  it("❄️ заморозка выключает все инструменты и говорит почему", () => {
    const held = order({ heldAt: "2026-10-18T00:00:00Z" });
    expect(gamepassToolsFor(held)).toHaveLength(0);
    expect(gamepassToolsRefusal(held)).toContain("заморожен");
  });

  it("неоплаченный прямой заказ — тоже стоп", () => {
    const unpaid = order({ isDirectOrder: true, paidAt: null });
    expect(isUnpaidDirectOrder(unpaid)).toBe(true);
    expect(gamepassToolsFor(unpaid)).toHaveLength(0);
    expect(gamepassToolsRefusal(unpaid)).toContain("не оплачен");
  });

  it("оплаченный прямой работает", () => {
    expect(gamepassToolsFor(order({ isDirectOrder: true, paidAt: "2026-10-18T00:00:00Z" }))).toHaveLength(5);
  });

  it("готовый флаг `unpaidDirect` с сервера сильнее догадки по paidAt", () => {
    expect(isUnpaidDirectOrder({ status: "PENDING", unpaidDirect: false, isDirectOrder: true, paidAt: null })).toBe(false);
  });

  it("без ника нет поиска пассов и разбивки, но ключ и ссылка есть", () => {
    const noNick = order({ robloxUsername: null, probableNick: null });
    expect(gamepassToolsFor(noNick).map(t => t.id)).toEqual(["key", "link", "ask"]);
    expect(gamepassToolsRefusal(noNick)).toContain("Ника Roblox нет");
  });

  it("вероятный ник считается — по нему и ищут пассы", () => {
    expect(hasGamepassTool(order({ robloxUsername: null, probableNick: "lox23" }), "nick")).toBe(true);
  });

  it("выкупленный заказ геймпасс не меняет", () => {
    expect(gamepassToolsFor(order({ status: "COMPLETED" }))).toHaveLength(0);
  });

  it("ключ принимают те же статусы, что и привязку", () => {
    for (const status of GAMEPASS_ATTACHABLE_STATUSES) {
      expect(hasGamepassTool(order({ status }), "key")).toBe(true);
      expect(hasGamepassTool(order({ status }), "link")).toBe(true);
    }
  });

  it("IN_PROGRESS уже выкупается: ключ не предлагаем, разбивку правим", () => {
    expect(hasGamepassTool(order({ status: "IN_PROGRESS" }), "key")).toBe(false);
    expect(hasGamepassTool(order({ status: "IN_PROGRESS" }), "split")).toBe(true);
  });

  it("📨 просить у покупателя можно, только пока ход за ним", () => {
    expect(hasGamepassTool(order({ status: "AWAITING_GAMEPASS" }), "ask")).toBe(true);
    expect(hasGamepassTool(order({ status: "REJECTED" }), "ask")).toBe(true);
    expect(hasGamepassTool(order({ status: "PENDING" }), "ask")).toBe(false);
    expect(hasGamepassTool(order({ status: "IN_PROGRESS" }), "ask")).toBe(false);
  });
});

describe("все поверхности берут список из общего модуля", () => {
  it.each(SURFACES)("%s рисует общее меню", file => {
    const source = read(file);
    expect(source).toContain("GamepassToolRows");
    expect(source).toMatch(/gamepass-tools|GamepassTools/);
  });

  it.each(SURFACES)("%s даёт вставить ключ покупателя", file => {
    const source = read(file);
    // Либо форма прямо здесь, либо строка меню, которая её открывает.
    expect(source).toMatch(/KeyCreateForm|KeyCreateBox/);
  });

  it.each(SURFACES)("%s даёт попросить шаг у покупателя", file => {
    expect(read(file)).toMatch(/AskBuyerForm|AskBuyerBox/);
  });

  it("ни одна поверхность не держит свою копию статусов инструментов", () => {
    for (const file of SURFACES) {
      const source = read(file);
      expect(source).not.toMatch(/const (KEYABLE|ATTACHABLE|SPLITTABLE)\s*=/);
    }
  });

  it("ни одна поверхность не пишет свои имена инструментов", () => {
    /* Старые самодельные подписи: каждая поверхность называла инструмент
       иначе. Ищем в КОДЕ — комментарии про «как было раньше» законны и нужны. */
    const stripComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const file of SURFACES) {
      const source = stripComments(read(file));
      expect(source).not.toContain("Вставить ссылку на геймпасс");
      expect(source).not.toContain("Вставить ключ покупателя");
      expect(source).not.toContain("Разбить на несколько пассов");
      expect(source).not.toContain("Ещё пассы ника");
    }
  });
});

describe("TWA и сайт используют один модуль, а не две копии", () => {
  it("формы ключа и ссылки в TWA живут в общем компоненте", () => {
    const tools = read("src/app/twa/_components/GamepassTools.tsx");
    expect(tools).toContain("export function KeyCreateForm");
    expect(tools).toContain("export function AttachGamepassForm");
    expect(tools).toContain('from "@/lib/gamepass-tools"');
  });

  it("на сайте — тоже один компонент на все разделы", () => {
    const tools = read("src/components/admin/orders/gamepass-tools.tsx");
    expect(tools).toContain("export function KeyCreateBox");
    expect(tools).toContain("export function GamepassToolRows");
    expect(tools).toContain('from "@/lib/gamepass-tools"');
  });

  it("полная карточка заказа больше не тупик — у неё есть инструменты", () => {
    const page = read("src/app/admin/(protected)/orders/[id]/page.tsx");
    expect(page).toContain("OrderDetailTools");
  });

  it("ссылка «открыть инструмент на заказе» разбирается рабочим местом", () => {
    expect(read("src/app/admin/(protected)/orders/page.tsx")).toContain("initialTool");
    expect(read("src/components/admin/orders/orders-workspace.tsx")).toContain("initialTool");
  });
});
