/**
 * ⚡ «Вперёд очереди» — ручной приоритет заказа.
 *
 * Фича состоит ровно в одном: заказ обязан оказаться первым ВЕЗДЕ, где очередь
 * читается, — иначе поднятый заказ виден наверху в телефоне и не виден в
 * выгрузке ID закупщику, и «выкупать первым» превращается в украшение.
 * Поэтому тест сторожит не UI, а четыре потребителя очереди и одну ловушку
 * Postgres, из-за которой сортировка молча переворачивается.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { FIRST_IN_LINE_ORDER_SQL, orderByForTab, PRIORITY_ORDER_SQL, isPrioritized, type FilterTab } from "@/lib/order-queue";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** Срезы, где место в списке = очередь работы. */
const QUEUE_TABS: FilterTab[] = [
  "WORK", "BUYOUT", "DIRECT", "AVITO", "ERROR", "ATTENTION", "AWAITING_LINK", "STALE_LINK",
];
/** Срезы-история: приоритет там ничего не значит. */
const HISTORY_TABS: FilterTab[] = ["DONE", "REJECTED", "FAVORITES", "HELD", "ALL", "NEW"];

describe("сортировка очереди", () => {
  it.each(QUEUE_TABS)("в срезе %s приоритет стоит первым ключом", (tab) => {
    const order = orderByForTab(tab);
    expect(Array.isArray(order)).toBe(true);
    expect((order as any[])[0]).toEqual({ priorityAt: { sort: "desc", nulls: "last" } });
  });

  it.each(HISTORY_TABS)("в срезе %s приоритета в сортировке нет", (tab) => {
    expect(JSON.stringify(orderByForTab(tab))).not.toContain("priorityAt");
  });

  it("порядок «К выкупу»: руки → прямые → возраст", () => {
    // Приоритет — исключение, а не новая сортировка: под ним по-прежнему
    // возраст, и снятие приоритета возвращает заказ ровно на своё место.
    expect(orderByForTab("BUYOUT")).toEqual([
      { priorityAt: { sort: "desc", nulls: "last" } },
      { isDirectOrder: "desc" },
      { pendingAt: "asc" },
      { createdAt: "asc" },
    ]);
  });

  it("прямые обгоняют только в общей очереди", () => {
    // Во вкладке «Прямой» все заказы прямые — ось там ничего не значит и
    // только маскировала бы возраст.
    expect(JSON.stringify(orderByForTab("DIRECT"))).not.toContain("isDirectOrder");
    expect(JSON.stringify(orderByForTab("AVITO"))).not.toContain("isDirectOrder");
  });

  it("NULLS LAST задан явно — в Postgres DESC по умолчанию NULLS FIRST", () => {
    // Без этого наверх уехали бы ВСЕ неприоритетные заказы, то есть очередь
    // перевернулась бы целиком и молча.
    expect(PRIORITY_ORDER_SQL).toContain("DESC NULLS LAST");
    expect(orderByForTab("BUYOUT")[0 as never]).toMatchObject({ priorityAt: { nulls: "last" } });
  });

  it("isPrioritized читает факт, а не строку", () => {
    expect(isPrioritized({ priorityAt: new Date() })).toBe(true);
    expect(isPrioritized({ priorityAt: null })).toBe(false);
    expect(isPrioritized({})).toBe(false);
  });
});

describe("все потребители очереди читают приоритет", () => {
  it("голова обзора сортирует тем же правилом", () => {
    const overview = read("src/lib/admin-overview.ts");
    expect(overview).toContain("PRIORITY_ORDER_SQL");
    expect(overview).toContain('ORDER BY o.${PRIORITY_ORDER_SQL}');
  });

  it("автовыкуп бота берёт поднятый заказ раньше старейшего", () => {
    const worker = read("bots/tg/auto-workers.ts");
    expect(worker).toContain('orderBy: [{ priorityAt: { sort: "desc", nulls: "last" } }, { pendingAt: "asc" }]');
  });

  it("выгрузка ID закупщику идёт тем же порядком, что и лента", () => {
    // `loadGamepassExport` берёт `orderByForTab` — отдельной сортировки у неё
    // быть не должно, иначе список для донора разойдётся с экраном.
    const queue = read("src/lib/order-queue.ts");
    expect(queue).toContain("orderBy: orderByForTab(tab)");
  });

  it("«Ждут ссылку» склеивается вручную — приоритет внесён и туда", () => {
    // Вкладка собирается не одним orderBy, а «свежие сверху + хвост от старых».
    const route = read("src/app/api/twa/orders/route.ts");
    const hybrid = route.slice(route.indexOf("async function fetchAwaitingLinkHybrid("));
    expect(hybrid.slice(0, 1600)).toContain("priorityAt: { not: null }");
  });

  it("«Требуют внимания» пересортируется в памяти — приоритет там тоже первый", () => {
    const route = read("src/app/api/twa/orders/route.ts");
    expect(route).toContain("(a.priorityAt ? 0 : 1) - (b.priorityAt ? 0 : 1) || attentionRank(a) - attentionRank(b)");
  });
});

describe("«Первым делом» на обеих главных", () => {
  const lib = read("src/lib/first-in-line.ts");

  it("список один на сайт и телефон", () => {
    // Две копии запроса разошлись бы: «выкупать первым» на телефоне и на сайте
    // обязано значить один и тот же список.
    expect(read("src/lib/admin-overview.ts")).toContain("loadFirstInLine");
    expect(read("src/app/api/twa/dashboard/route.ts")).toContain("loadFirstInLine");
  });

  it("границы — те же, что у вкладки «Выкупить»", () => {
    expect(lib).toContain("BUYOUT_QUEUE_SQL");
    expect(lib).toContain('("priorityAt" IS NOT NULL OR "isDirectOrder" = true)');
  });

  it("порядок внутри блока: ⚡ → прямые → возраст", () => {
    expect(lib).toContain("FIRST_IN_LINE_ORDER_SQL");
    expect(FIRST_IN_LINE_ORDER_SQL).toBe(
      '"priorityAt" DESC NULLS LAST, "isDirectOrder" DESC, COALESCE("pendingAt", "createdAt") ASC',
    );
  });

  it("оба экрана рисуют блок и прячут его пустым", () => {
    const overview = read("src/components/admin/overview/overview-screen.tsx");
    const twa = read("src/app/twa/_components/screens/Dashboard.tsx");
    expect(overview).toContain("firstInLine.length > 0");
    expect(twa).toContain("firstInLine.length > 0");
    // Причина попадания видна в строке, иначе блок читается как «просто список».
    expect(overview).toContain('order.reason === "pinned"');
    expect(twa).toContain('order.reason === "pinned"');
  });

  it("выгрузка ID: вся пачка и каждый заказ отдельно", () => {
    const overview = read("src/components/admin/overview/overview-screen.tsx");
    expect(overview).toContain("copyFirstIds(firstInLine,");
    expect(overview).toContain("copyFirstIds([order],");
  });

  it("у разбитого заказа копируются ВСЕ невыкупленные части", () => {
    // Одна строка списка = одна покупка только у неразбитого заказа; у
    // разбитого их столько, сколько частей осталось, и повтор пасса не
    // схлопывается — это две покупки с разных доноров.
    expect(lib).toContain("purchasedAt: null");
    expect(lib).toContain("bucket.push(part.gamepassId)");
    const overview = read("src/components/admin/overview/overview-screen.tsx");
    expect(overview).toContain("orders.flatMap(order => order.gamepassIds)");
  });

  it("тип для клиента лежит вне server-only модуля", () => {
    // Иначе клиентский бандл потянул бы за собой Prisma.
    expect(read("src/types/first-in-line.ts")).not.toContain('import "server-only"');
    expect(lib).toContain('import "server-only"');
  });
});

describe("правила действия", () => {
  const route = read("src/app/api/twa/orders/route.ts");

  it("замороженный заказ поднять нельзя — он выключен из очередей целиком", () => {
    const handler = route.slice(route.indexOf('if (action === "set-priority")'));
    expect(handler.slice(0, 600)).toContain("if (order.heldAt) return NextResponse.json({ error: heldRefusal(");
  });

  it("закрытые заказы поднимать нечего", () => {
    const handler = route.slice(route.indexOf('if (action === "set-priority")'));
    const guard = handler.slice(0, 900);
    expect(guard).toContain("QUEUEABLE");
    expect(guard).not.toContain("COMPLETED");
  });

  it("хранится момент нажатия, а не флаг — поднятый последним идёт первым", () => {
    const handler = route.slice(route.indexOf('if (action === "set-priority")'));
    expect(handler.slice(0, 1200)).toContain("priorityAt: new Date(), priorityBy: actor.displayName");
  });
});

describe("обе админки умеют поднимать заказ", () => {
  it("TWA: действие в меню карточки и метка в ленте", () => {
    const screen = read("src/app/twa/_components/screens/OrdersScreen.tsx");
    expect(screen).toContain('action: "set-priority"');
    expect(screen).toContain("twa-oc-prio");
    expect(screen).toContain('row("priority", "⚡"');
  });

  it("сайт: кнопка в строке, в карточке, в досье, клавиша P и команда палитры", () => {
    const workspace = read("src/components/admin/orders/orders-workspace.tsx");
    const dossier = read("src/components/admin/orders/order-dossier.tsx");
    const palette = read("src/components/admin/orders/command-palette.tsx");
    expect(workspace).toContain('action: "set-priority"');
    expect(workspace).toContain('if (key === "p" && cursorOrder)');
    expect(workspace).toContain("styles.rowPriority");
    expect(dossier).toContain("onPriority");
    expect(palette).toContain('onCommand("priority")');
  });

  it("у действия есть обратное — приоритет снимается тем же способом", () => {
    const workspace = read("src/components/admin/orders/orders-workspace.tsx");
    expect(workspace).toContain('inverse: { action: "set-priority", priority: !on }');
  });
});
