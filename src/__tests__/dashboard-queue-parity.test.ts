import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUYOUT_LANE_SQL, BUYOUT_QUEUE_SQL, STALE_LINK_DAYS } from "@/lib/order-queue";

/* Главная и вкладка «К выкупу» показывают одну очередь.

   До 30.08.2026 у них были свои копии предиката: вкладка считала починимые
   `ERROR` (рег. цена, Roblox+) частью очереди, дашборд — нет, и два экрана
   называли разные числа, не будучи ни один из них неправым. Плюс дашборд не
   вычитал заморозку и рисовал «Исправить 1 ошибку» при пустой вкладке.

   Тест смотрит на исходники: развести числа снова можно только заново заведя
   копию предиката, и здесь это сразу видно. */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("главная считает очередь тем же предикатом, что и вкладка", () => {
  const dashboard = read("src/app/api/twa/dashboard/route.ts");

  it("дашборд берёт границы очереди из order-queue, а не пишет свои", () => {
    expect(dashboard).toContain("BUYOUT_QUEUE_SQL");
    expect(dashboard).toContain("BUYOUT_LANE_SQL");
    // Собственного перечисления статусов выкупа в роуте быть не должно.
    expect(dashboard).not.toContain("status IN ('PENDING', 'IN_PROGRESS')");
  });

  it("предикат очереди несёт заморозку, оплату и исключение Авито", () => {
    expect(BUYOUT_QUEUE_SQL).toContain(`"heldAt" IS NULL`);
    expect(BUYOUT_QUEUE_SQL).toContain(`"paidAt" IS NULL`);
    expect(BUYOUT_QUEUE_SQL).toContain(`"orderSource" <> 'AVITO'`);
    expect(BUYOUT_QUEUE_SQL).toContain("REGIONAL_PRICE");
  });

  it("полосы источников покрывают очередь без остатка", () => {
    // DBS и «прямые» названы явно, всё остальное падает в ВБ — заказ не может
    // выпасть из разбивки, поэтому сумма полос всегда равна общей очереди.
    expect(BUYOUT_LANE_SQL).toContain("WB_DBS");
    expect(BUYOUT_LANE_SQL).toContain(`"isDirectOrder" = true`);
    expect(BUYOUT_LANE_SQL).toContain("ELSE 'WB'");
  });

  it("счётчики ошибок и ссылок на главной вычитают заморозку", () => {
    const heldFilters = dashboard.match(/NOT_HELD_SQL/g) ?? [];
    expect(heldFilters.length).toBeGreaterThanOrEqual(2);
    expect(dashboard).toContain(`status: "ERROR", heldAt: null`);
  });

  it("висяк наступает позже последнего напоминания бота", () => {
    // Бот шлёт три напоминания и замолкает на 72 часах (bots/tg/crons.ts).
    const crons = read("bots/tg/crons.ts");
    expect(crons).toContain("hoursThreshold: 72");
    expect(STALE_LINK_DAYS * 24).toBeGreaterThan(72);
  });
});
