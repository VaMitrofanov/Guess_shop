import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("admin performance contracts", () => {
  it("renders heavy screens with initial server data instead of hydrate-then-fetch", () => {
    const economicsPage = read("app/admin/(protected)/economics/page.tsx");
    const economicsClient = read("components/admin/economics-client.tsx");
    const buyoutPage = read("app/admin/(protected)/buyout/page.tsx");
    const buyoutClient = read("components/admin/buyout-client.tsx");
    const antonPage = read("app/admin/(protected)/partners/anton/page.tsx");

    expect(economicsPage).toContain("loadDirectEconomics");
    expect(economicsClient).not.toContain('fetch("/api/admin/economics"');
    expect(buyoutPage).toContain("loadAdminBuyoutData");
    expect(buyoutClient).toContain("initialData");
    expect(antonPage).toContain("loadPartnerAdminInitialStateJson");
  });

  it("keeps order/user/activity lists bounded and server-filtered", () => {
    const ecosystem = read("lib/admin-ecosystem.ts");
    const audience = read("lib/admin-audience.ts");
    expect(ecosystem).toContain("getAdminOrdersPage");
    expect(ecosystem).toContain("getAdminActivityPage");
    expect(ecosystem).toContain("take: limit + 1");
    expect(audience).toContain("nextCursor");
    expect(audience).toContain("input.limit ?? 50");
  });

  it("cancels stale buyout reads and does not auto-run the donor check", () => {
    const buyout = read("components/admin/buyout-client.tsx");
    expect(buyout).toContain("loadAbortRef.current?.abort()");
    expect(buyout).toContain("requestId !== loadRequestRef.current");
    expect(buyout).not.toMatch(/useEffect\(\(\) => \{ void loadDonor\(\)/);
  });

  it("has real route loading boundaries and no fixed global 1500ms loader", () => {
    expect(fs.existsSync(path.join(root, "app/admin/(protected)/loading.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(root, "app/admin/(protected)/error.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(root, "components/page-loader.tsx"))).toBe(false);
  });
});
