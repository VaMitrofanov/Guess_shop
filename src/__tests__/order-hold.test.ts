/**
 * ❄️ Заморозка заказа — «не выкупать, но и не удалять».
 *
 * Тест сторожит ровно то, ради чего фича заводилась: замороженный заказ не
 * должен попасть в выкуп НИ ОДНИМ путём. Каждая проверка ниже соответствует
 * своей ловушке, а не просто «покрытию».
 */

import { readFileSync } from "fs";
import { join } from "path";
import { buildTabWhere, orderByForTab, type FilterTab } from "@/lib/order-queue";
import {
  HOLD_NOTE_MARK, NOT_HELD, NOT_HELD_SQL, UNHOLD_NOTE_MARK,
  hasHoldNoteFor, heldRefusal, normalizeHoldCode, normalizeHoldReason, parseAdminNote,
} from "@/lib/order-hold";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** Вкладки, из которых замороженный заказ обязан исчезнуть. */
const WORK_TABS: FilterTab[] = [
  "WORK", "BUYOUT", "DIRECT", "AVITO", "NEW", "ERROR", "AWAITING_LINK", "STALE_LINK", "ATTENTION",
];

describe("границы очередей", () => {
  it.each(WORK_TABS)("вкладка %s исключает замороженные", (tab) => {
    // Строковый разбор, а не глубокое сравнение: `NOT_HELD` подмешивается
    // спредом на верхний уровень, и важен именно факт наличия предиката.
    expect(JSON.stringify(buildTabWhere(tab))).toContain('"heldAt":null');
  });

  it("«Заморожены» — единственная вкладка, где они есть", () => {
    expect(buildTabWhere("HELD")).toEqual({ heldAt: { not: null } });
  });

  it("«Все» показывает замороженные — там они с бейджем ❄️", () => {
    expect(buildTabWhere("ALL")).toEqual({});
  });

  it("свежая заморозка сверху", () => {
    expect(orderByForTab("HELD")).toEqual({ heldAt: "desc" });
  });
});

describe("сырые SQL-счётчики зеркалят buildTabWhere", () => {
  // Счётчики вкладок считаются отдельным $queryRawUnsafe. Если предикат
  // добавили в `buildTabWhere`, но забыли в SQL, лента и цифра на чипе
  // разойдутся молча — заказ пропадёт из списка, а счётчик его сохранит.
  const route = read("src/app/api/twa/orders/route.ts");

  it("NOT_HELD_SQL — это тот же предикат", () => {
    expect(NOT_HELD_SQL).toBe(`"heldAt" IS NULL`);
    expect(NOT_HELD).toEqual({ heldAt: null });
  });

  it("рабочие счётчики фильтруют заморозку", () => {
    for (const tab of ["WORK", "BUYOUT", "DIRECT", "AVITO", "NEW", "ERROR", "AWAITING_LINK", "STALE_LINK", "ATTENTION"]) {
      const line = route.split("\n").find((l) => l.includes(`AS "${tab}"`) || l.includes(`))::int AS "${tab}"`));
      expect(line).toBeDefined();
    }
    // Каждая рабочая ветка SQL несёт ${NOT_HELD_SQL}; их ровно столько же,
    // сколько рабочих вкладок (+2 суммы: SUM_ERROR и SUM_HELD не в счёт).
    const occurrences = route.match(/\$\{NOT_HELD_SQL\}/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(WORK_TABS.length);
  });

  it("правка заказа тоже под гардом", () => {
    // Лист заказа умеет переключаться в правку по введённому коду, поэтому
    // замороженный заказ достижим из формы создания. Без гарда правка была бы
    // обходом заморозки: поправил ник с геймпассом — заказ снова рабочий.
    const editBlock = route.slice(route.indexOf('action === "edit-order"'));
    expect(editBlock.slice(0, 1200)).toContain("order.heldAt");
    expect(editBlock.slice(0, 1200)).toContain("heldRefusal");
  });

  it("счётчик «Заморожены» существует", () => {
    expect(route).toContain(`COUNT(*) FILTER (WHERE "heldAt" IS NOT NULL)::int AS "HELD"`);
  });
});

describe("гарды выкупа", () => {
  it("автовыкуп фильтрует heldAt и перепроверяет OrderHold", () => {
    const worker = read("bots/tg/auto-workers.ts");
    // Первый рубеж: заморозка в `where` самой выборки.
    expect(worker).toContain("...NOT_HELD");
    // Второй рубеж: заказ мог родиться по заранее замороженному коду уже
    // после того, как крон-свип прошёл, — `heldAt` его ещё не знает.
    expect(worker).toContain("activeHoldCodes");
    expect(worker).toContain("heldCodes.has(order.wbCode)");
  });

  it("ручной выкуп из TWA отказывает до траты", () => {
    const route = read("src/app/api/twa/orders/route.ts");
    const purchase = route.slice(route.indexOf('if (action === "purchase")'));
    const guard = purchase.indexOf("assertOrderNotHeld");
    const spend = purchase.indexOf("purchaseGamepassWithCookie");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(spend);
  });

  it("ручной выкуп из TG-бота отказывает до траты", () => {
    const handlers = read("bots/tg/handlers.ts");
    const pb = handlers.slice(handlers.indexOf('if (data.startsWith("pb:"))'));
    const guard = pb.indexOf("assertOrderNotHeld");
    const spend = pb.indexOf("purchaseGamepassVerified");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(spend);
  });

  it("«Вернуть к выкупу» и «Перенести» не поднимают замороженный", () => {
    // Та самая ловушка «Ошибки»: одно нажатие возвращало заказ в PENDING.
    const route = read("src/app/api/twa/orders/route.ts");
    const restore = route.slice(route.indexOf('if (action === "restore-to-buyout")'), route.indexOf('if (action === "move-to")'));
    expect(restore).toContain("order.heldAt");
    expect(restore).toContain("heldRefusal");

    const move = route.slice(route.indexOf('if (action === "move-to")'));
    expect(move.slice(0, 800)).toContain("order.heldAt");
  });
});

describe("заморозка живёт до создания заказа", () => {
  it("ключ — код, а не id заказа", () => {
    const core = read("bots/shared/order-hold.ts");
    expect(core).toContain("holdByCode");
    expect(core).toContain("releaseByCode");
    // Заморозка на несуществующий заказ — не ошибка, а ожидание.
    expect(core).toContain("awaitingOrder");
  });

  it("крон-свип поднят в TG-боте", () => {
    const crons = read("bots/tg/crons.ts");
    expect(crons).toContain("sweepPendingHolds");
    expect(crons).toContain("[OrderHold] Cron started");
  });
});

describe("алерт поддержки помечает замороженного клиента", () => {
  const admin = read("bots/shared/admin.ts");

  it("SOS-обращение получает красную шапку", () => {
    expect(admin).toContain("ПИШЕТ ЗАМОРОЖЕННЫЙ КЛИЕНТ");
    expect(admin).toContain("heldCustomerFor");
  });

  it("тупик в боте — тоже, тихий 👀 тут проходит мимо глаз", () => {
    const hurdle = admin.slice(admin.indexOf("export async function notifyUserHurdle"));
    expect(hurdle).toContain("heldCustomerFor");
    expect(hurdle).toContain("ЗАМОРОЖЕННЫЙ");
  });

  it("падение бота — тоже", () => {
    const botErr = admin.slice(admin.indexOf("export async function notifyBotError"));
    expect(botErr).toContain("heldCustomerFor");
  });

  it("VK передаёт vkId — иначе признак теряется", () => {
    // В TG клиента опознаёт tgId; у VK-обращения его нет, и без vkId алерт
    // приходил бы без пометки.
    expect(read("bots/vk/handlers.ts")).toContain("vkId: String(vkUserId)");
  });
});

describe("причина заморозки", () => {
  it("пустую не принимаем", () => {
    expect(normalizeHoldReason("   ")).toBeNull();
    expect(normalizeHoldReason(null)).toBeNull();
    expect(normalizeHoldReason("1 звезда")).toBe("1 звезда");
  });

  it("длинную режем", () => {
    expect(normalizeHoldReason("x".repeat(500))).toHaveLength(300);
  });

  it("код нормализуется к верхнему регистру", () => {
    expect(normalizeHoldCode(" cvx3phs ")).toBe("CVX3PHS");
  });

  it("отказ называет причину", () => {
    expect(heldRefusal("1 звезда на WB")).toContain("1 звезда на WB");
    expect(heldRefusal(null)).toContain("причина не указана");
  });
});

describe("разбор заметки", () => {
  it("строка заморозки отличается от служебных", () => {
    const lines = parseAdminNote(
      `${HOLD_NOTE_MARK} 30.08 14:12 · Вадим] 1 звезда на WB\n` +
      `[НИК? 29.08] Vova2016god18 (чат WB)\n` +
      `PENDING→ERROR: перенесён вручную`,
    );
    expect(lines).toHaveLength(3);
    expect(lines[0].kind).toBe("hold");
    expect(lines[0].text).toBe("1 звезда на WB");
    expect(lines[0].tag).toContain("Вадим");
    expect(lines[1].kind).toBe("plain");
    expect(lines[1].tag).toBe("НИК? 29.08");
    // Немаркированная строка остаётся как есть — без выдуманного тега.
    expect(lines[2].kind).toBe("plain");
    expect(lines[2].tag).toBeNull();
  });

  it("разморозка тоже помечена", () => {
    const [line] = parseAdminNote(`${UNHOLD_NOTE_MARK} 30.08 15:00 · Вадим] заморозка снята`);
    expect(line.kind).toBe("unhold");
  });

  it("пустая заметка — пустая история", () => {
    expect(parseAdminNote(null)).toEqual([]);
    expect(parseAdminNote("  \n \n ")).toEqual([]);
  });
});

describe("повторная пометка не растит заметку", () => {
  // Найдено живой проверкой в проде 30.08: если `heldAt` снят, а заморозка
  // активна, крон-свип помечает заказ заново — и раньше дописывал строку на
  // каждый проход. Штамп меняется каждую минуту, поэтому сравнивать целые
  // строки бесполезно; сравниваем причину внутри строки заморозки.
  const note = `${HOLD_NOTE_MARK} 30.08, 12:41 · Вадим] 1 звезда на WB\nPENDING→ERROR`;

  it("та же причина распознаётся под другим штампом", () => {
    expect(hasHoldNoteFor(note, "1 звезда на WB")).toBe(true);
  });

  it("другая причина — новая строка", () => {
    expect(hasHoldNoteFor(note, "фрод")).toBe(false);
  });

  it("пустая заметка — писать можно", () => {
    expect(hasHoldNoteFor(null, "1 звезда на WB")).toBe(false);
  });

  it("свип и гард выкупа ходят через общую точку", () => {
    const core = read("bots/shared/order-hold.ts");
    const sweep = core.slice(core.indexOf("export async function sweepPendingHolds"));
    expect(sweep).toContain("stampHoldOnOrder");
    const assert = core.slice(
      core.indexOf("export async function assertOrderNotHeld"),
      core.indexOf("export async function sweepPendingHolds"),
    );
    expect(assert).toContain("stampHoldOnOrder");
  });
});
