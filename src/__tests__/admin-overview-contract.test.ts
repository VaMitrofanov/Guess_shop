import { readFileSync } from "fs";
import path from "path";

const root = path.join(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const page = read("app/admin/(protected)/page.tsx");
const screen = read("components/admin/overview/overview-screen.tsx");
const lib = read("lib/admin-overview.ts");
const presence = read("lib/admin-presence.ts");
const route = read("app/api/admin/overview/route.ts");
const schema = readFileSync(path.join(root, "..", "prisma", "schema.prisma"), "utf8");

/* ─────────────────────────────────────────────────────────────────────────────
   Контракт «Обзора» как начала смены (этапы Г1–Г4).

   Тест сторожит не вёрстку, а решения: порядок вопросов на экране, единственный
   источник чисел и механику окна «Пока вас не было». Именно они ломаются молча.
   ───────────────────────────────────────────────────────────────────────── */

describe("«Обзор» — начало смены", () => {
  it("ведёт робуксами к выкупу, а не оборотом эквайринга", () => {
    const heroAt = screen.indexOf("styles.hero");
    const showcaseAt = screen.indexOf("<Showcase");
    expect(heroAt).toBeGreaterThan(-1);
    expect(showcaseAt).toBeGreaterThan(heroAt);
    // Крупное число героя — грязные робуксы очереди.
    expect(screen).toMatch(/num\(buyout\.gross\)}<small>R\$ грязными/);
    // «Чистый оборот» больше не подпись на экране (в комментарии — можно).
    expect(screen).not.toMatch(/>\s*Чистый оборот/);
    // Эквайринг остался, но в витрине и в одну строку.
    expect(screen).toMatch(/Эквайринг <b>/);
  });

  it("держит порядок вопросов: работа → диф → здоровье → витрина", () => {
    const order = ["styles.hero", "styles.lanes", "<DiffPanel", "<HealthStrip", "<Showcase"]
      .map(marker => screen.indexOf(marker));
    expect(order.every(index => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("не заводит вторую правду о числах очереди", () => {
    // Границы очереди берутся из общего предиката «Заказов», а не переписаны.
    expect(lib).toContain("BUYOUT_QUEUE_SQL");
    expect(lib).toContain("loadOrderSlices");
    expect(lib).toContain("loadWbDeliveryQueueSnapshot");
    expect(lib).not.toMatch(/status IN \('PENDING','IN_PROGRESS'\)/);
  });

  it("окно «Пока вас не было» у каждого админа своё", () => {
    expect(schema).toContain("model AdminPresence");
    expect(schema).toContain("telegramId     String    @id");
    expect(presence).toContain("windowStartAt");
    expect(presence).toContain("ADMIN_AWAY_GAP_MINUTES");
  });

  it("не двигает окно на каждом обновлении страницы", () => {
    // Сидит на месте — окно прежнее; ушёл дольше паузы — окно начинается там,
    // где он ушёл. Иначе три обновления подряд съедали бы весь диф.
    expect(presence).toContain("away >= ADMIN_AWAY_GAP_MINUTES ? previous.lastSeenAt : previous.windowStartAt");
    // Отметку ставит только загрузка страницы, не автообновление.
    expect(page).toContain("touchAdminPresence");
    expect(route).not.toContain("touchAdminPresence");
    expect(route).toContain('searchParams.get("since")');
  });

  it("ограничивает окно, пришедшее из адресной строки", () => {
    expect(route).toContain("ADMIN_WINDOW_MAX_DAYS");
    expect(route).toContain("Math.max(floor, parsed)");
  });

  /* Старейшие заказы стоят прямо в дорожке выкупа: типовая смена начинается
     с них, и ради трёх нажатий незачем уходить в ленту. Пачками с обзора не
     выкупают — у «Выкуплено» нет обратного действия, и подтверждать пачку
     на обзорном экране значило бы разводить второе рабочее место. */
  it("даёт выкупить старейшие поштучно и не заводит пачку на обзоре", () => {
    expect(screen).toContain("styles.oldest");
    expect(screen).toContain("completeOne");
    expect(screen).not.toContain("Выкуплено ×");
  });

  it("выкуп с обзора идёт тем же действием, что и в «Заказах»", () => {
    expect(screen).toContain('"/api/admin/orders"');
    expect(screen).toContain('action: "complete"');
  });

  it("пустая дорожка сжимается в строку, а не показывает ноль крупно", () => {
    expect(screen).toContain("styles.calmRow");
    expect(screen).toContain("errors.orders > 0 &&");
  });
});
