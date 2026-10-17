import { readFileSync } from "fs";
import path from "path";

const root = path.join(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const sidebar = read("components/admin/sidebar.tsx");
const css = read("components/admin/admin-shell.module.css");
const ordersWorkspace = read("components/admin/orders/orders-workspace.tsx");
const ordersCss = read("components/admin/orders/orders.module.css");
const buyout = read("components/admin/buyout-client.tsx");
const economics = read("components/admin/economics-client.tsx");
const anton = read("components/admin/anton-client.tsx");
const users = read("app/admin/(protected)/users/page.tsx");
const reviews = read("components/admin/review-list.tsx");
const faq = read("components/admin/faq-list.tsx");
const overview = read("components/admin/overview/overview-screen.tsx");
const overviewCss = read("components/admin/overview/overview.module.css");
const overviewPage = read("app/admin/(protected)/page.tsx");
const orderPresentation = read("lib/admin-order-presentation.ts");
const adminTime = read("lib/admin-time.ts");

describe("мобильный контракт Control Center", () => {
  it("держит четыре стабильных пункта нижней навигации", () => {
    expect(sidebar).toContain('label: "Обзор"');
    expect(sidebar).toContain('label: "Заказы"');
    expect(sidebar).toContain('label: "Выкуп"');
    expect(sidebar).toContain("<span>Ещё</span>");
    expect(sidebar).toContain('aria-label="Основная навигация"');
  });

  it("не показывает mobile-only KPI повторно на desktop", () => {
    expect(css).toMatch(/\.mobileOnly,\s*\n\.mobileList\s*\{\s*display:\s*none\s*!important;/);
    expect(css).toMatch(/\.mobileOnly, \.mobileList\s*\{\s*display:\s*grid\s*!important;/);
  });

  /* С Г2 «Обзор» не дублирует KPI двумя сетками: у него одна колонка данных,
     которая на телефоне просто разворачивается вертикально. */
  it("на телефоне разворачивает «Обзор» в одну колонку, а не сжимает сетку", () => {
    expect(overviewCss).toMatch(/@media \(max-width: 780px\)[\s\S]*?\.lanes \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(overviewCss).toMatch(/@media \(max-width: 780px\)[\s\S]*?\.hero \{ flex-direction: column;/);
    expect(overviewCss).toContain("calc(96px + env(safe-area-inset-bottom))");
  });

  it("учитывает обе safe-area и динамическую высоту iOS", () => {
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("100dvh");
  });

  it("не оставляет рабочие таблицы горизонтальными на телефоне", () => {
    for (const source of [buyout, economics, anton, users]) {
      expect(source).toContain("styles.responsiveTable");
      expect(source).toContain("data-label=");
    }
  });

  /* «Заказы» с В1 живут не таблицей: на телефоне те же данные показываются
     карточками, а режим «Таблица» просто не существует — переключатель скрыт,
     чтобы не предлагать тупик. */
  it("на телефоне отдаёт заказы карточками, а не горизонтальной таблицей", () => {
    expect(ordersWorkspace).toContain("styles.cards");
    expect(ordersWorkspace).toContain("QueueCard");
    expect(ordersCss).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.thead \{ display: none; \}/);
    expect(ordersCss).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.seg, \.barDesktopOnly \{ display: none; \}/);
  });

  /* Панель пачки обязана быть видна всегда: `sticky` внутри длинной ленты
     уезжала за нижний край экрана — выделил семь заказов и не увидел, чем с
     ними работать. На телефоне она поднята над нижней навигацией. */
  it("не прячет панель пачки ни под нижнюю навигацию, ни за край ленты", () => {
    expect(ordersCss).toMatch(/\.bulk \{[\s\S]*?position: fixed/);
    expect(ordersCss).toMatch(/bottom: calc\(70px \+ env\(safe-area-inset-bottom\)\)/);
    expect(ordersCss).toMatch(/\.toast \{[\s\S]*?position: fixed/);
  });

  /* «Последние заказы» с Г2 на «Обзоре» нет вовсе: это были первые пять строк
     /admin/orders, из которых нельзя было ничего сделать. Вместо них — очередь,
     нарезанная под выкупной аккаунт, и по ней можно работать прямо с обзора. */
  it("даёт на «Обзоре» работу, а не копию ленты заказов", () => {
    expect(overview).toContain("styles.oldest");
    expect(overview).toContain('action: "complete"');
    expect(overview).not.toContain("Последние заказы");
    expect(orderPresentation).toContain('PENDING: "В работе"');
    expect(orderPresentation).toContain('COMPLETED: "Выполнен"');
    expect(css).toContain("--admin-mobile-label: #a9abb8");
    expect(css).toMatch(/\.responsiveTable td::before\s*\{[^}]*text-transform:\s*none/);
  });

  it("не меняет даты после hydration из-за timezone браузера", () => {
    expect(adminTime).toContain('ADMIN_TIME_ZONE = "Europe/Moscow"');
    for (const source of [buyout, economics, anton]) {
      expect(source).toContain("ADMIN_TIME_ZONE");
    }
  });

  it("не прячет CRUD-действия за hover и не вызывает системный confirm", () => {
    expect(reviews).not.toContain("opacity-0");
    expect(faq).not.toContain("opacity-0");
    expect(reviews).not.toMatch(/\bconfirm\s*\(/);
    expect(faq).not.toMatch(/\bconfirm\s*\(/);
    expect(anton).not.toContain("window.confirm");
  });

  it("обеспечивает 44px для критичных мобильных действий", () => {
    expect(css).toMatch(/\.mobileBottomLink\s*\{[\s\S]*?min-height:\s*58px/);
    expect(css).toMatch(/\.mobileMoreHeader button\s*\{[\s\S]*?width:\s*44px;\s*height:\s*44px/);
    expect(css).toMatch(/\.rowActions button\s*\{[\s\S]*?width:\s*44px;\s*height:\s*44px/);
    // «Выкуплено» прямо с обзора — критичное действие, и на телефоне по нему
    // попадают пальцем: 26px кнопки хватало только курсору.
    expect(overviewCss).toMatch(/@media \(max-width: 780px\)[\s\S]*?\.tick \{ width: 44px; height: 44px; \}/);
    expect(overviewPage).toContain("touchAdminPresence");
  });
});
