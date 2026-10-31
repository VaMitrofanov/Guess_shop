import fs from "fs";
import path from "path";
import { NOT_HELD_SQL } from "@/lib/order-hold";
import { SILENT_REMINDERS, TAB_SQL, URGENT_SQL, buildTabWhere } from "@/lib/order-queue";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

describe("счётчики вкладок — одно правило на все экраны (20.10.2026)", () => {
  test("рабочие вкладки исключают заморозку", () => {
    for (const tab of ["WORK", "BUYOUT", "DIRECT", "AVITO", "NEW", "ERROR", "AWAITING_LINK", "STALE_LINK", "ATTENTION"] as const)
      expect(TAB_SQL[tab]).toContain(NOT_HELD_SQL);
  });

  test("значок TWA = «Выкупить» + «Починить», без своего SQL", () => {
    expect(URGENT_SQL).toContain(TAB_SQL.BUYOUT);
    expect(URGENT_SQL).toContain(TAB_SQL.ERROR);
    const route = read("app/api/twa/orders/urgent-count/route.ts");
    expect(route).toContain("URGENT_SQL");
    expect(route).not.toMatch(/status:\s*\{\s*in:/);
  });

  test("«Выкуп» и лента считают через TAB_SQL, а не своей копией", () => {
    const buyout = read("lib/admin-buyout.ts");
    expect(buyout).toContain("TAB_SQL[tab]");
    expect(buyout).not.toMatch(/"isFavorite" = false/);
    const orders = read("app/api/twa/orders/route.ts");
    expect(orders).toContain("TAB_SQL[k]");
    expect(orders).not.toMatch(/AS "STALE_LINK",\s*$/m);
  });

  test("«Молчат» = бот отправил все напоминания, а не возраст", () => {
    expect(TAB_SQL.STALE_LINK).toContain(`"remindersSent" >= ${SILENT_REMINDERS}`);
    expect(buildTabWhere("STALE_LINK")).toMatchObject({ status: "AWAITING_GAMEPASS", remindersSent: { gte: SILENT_REMINDERS } });
  });

  test("«Требуют внимания» не включает тишину покупателя", () => {
    expect(TAB_SQL.ATTENTION).not.toContain("AWAITING_GAMEPASS");
    expect(JSON.stringify(buildTabWhere("ATTENTION"))).not.toContain("AWAITING_GAMEPASS");
  });
});

describe("главная TWA не держит админа на базе (20.10.2026)", () => {
  test("ядро сводки — общий кэш со свежестью 15 с, WB — не дольше 400 мс", () => {
    const route = read("app/api/twa/dashboard/route.ts");
    expect(route).toContain("loadCoreCached()");
    expect(route).toMatch(/CORE_FRESH_MS = 15_000/);
    expect(route).toContain("withTimeout(getStats30d()");
    // Плашка «WB недоступен» не загорается, пока WB просто догружается.
    expect(route).toContain("apiAvailable: statsPending || !!stats");
  });
});
