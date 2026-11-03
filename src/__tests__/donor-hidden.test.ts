import fs from "fs";
import path from "path";
import { DONOR_ENABLED } from "@/lib/donor-mode";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/* Донор выключен 20.10.2026 (решение владельца), но не удалён: каждое донорское
   место в интерфейсе спрятано за флагом, а не вырезано. Тест держит оба факта. */
describe("донорский интерфейс спрятан за одним флагом", () => {
  test("флаг выключен", () => expect(DONOR_ENABLED).toBe(false));

  test.each([
    ["app/twa/_components/screens/OrdersScreen.tsx", "hasGamepass && DONOR_ENABLED"],
    ["app/twa/_components/screens/OrdersScreen.tsx", "canPurchase && DONOR_ENABLED"],
    ["app/twa/_components/screens/SettingsScreen.tsx", "{DONOR_ENABLED && <section>"],
    ["app/twa/_components/screens/BossrobuxScreen.tsx", "if (!DONOR_ENABLED)"],
    ["app/twa/_components/BottomNav.tsx", "DONOR_ENABLED"],
    ["components/admin/buyout-client.tsx", "{DONOR_ENABLED && <section className={styles.panel}>"],
    ["components/admin/orders/orders-workspace.tsx", "{DONOR_ENABLED && <button"],
  ])("%s прячет донора (%s)", (file, marker) => {
    expect(read(file)).toContain(marker);
  });

  test("счётчик доставок — на вкладке «Доставка», а не на «Ещё»", () => {
    const nav = read("app/twa/_components/BottomNav.tsx");
    expect(nav).toContain('id === "delivery" ? dbsBadge');
    const more = nav.slice(nav.indexOf("<Ellipsis"));
    expect(more.slice(0, 200)).not.toContain("dbsBadge");
  });
});
