import { readFileSync } from "fs";
import path from "path";

const root = path.join(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const sidebar = read("components/admin/sidebar.tsx");
const css = read("components/admin/admin-shell.module.css");
const orders = read("components/admin/orders-client.tsx");
const buyout = read("components/admin/buyout-client.tsx");
const economics = read("components/admin/economics-client.tsx");
const anton = read("components/admin/anton-client.tsx");
const users = read("app/admin/(protected)/users/page.tsx");
const reviews = read("components/admin/review-list.tsx");
const faq = read("components/admin/faq-list.tsx");

describe("мобильный контракт Control Center", () => {
  it("держит четыре стабильных пункта нижней навигации", () => {
    expect(sidebar).toContain('label: "Обзор"');
    expect(sidebar).toContain('label: "Заказы"');
    expect(sidebar).toContain('label: "Выкуп"');
    expect(sidebar).toContain("<span>Ещё</span>");
    expect(sidebar).toContain('aria-label="Основная навигация"');
  });

  it("учитывает обе safe-area и динамическую высоту iOS", () => {
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("100dvh");
  });

  it("не оставляет рабочие таблицы горизонтальными на телефоне", () => {
    for (const source of [orders, buyout, economics, anton, users]) {
      expect(source).toContain("styles.responsiveTable");
      expect(source).toContain("data-label=");
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
    expect(css).toMatch(/\.mobileBottomLink\s*\{[\s\S]*?min-height:\s*54px/);
    expect(css).toMatch(/\.mobileMoreHeader button\s*\{[\s\S]*?width:\s*44px;\s*height:\s*44px/);
    expect(css).toMatch(/\.rowActions button\s*\{[\s\S]*?width:\s*44px;\s*height:\s*44px/);
  });
});
