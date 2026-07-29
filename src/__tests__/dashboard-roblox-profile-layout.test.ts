import { readFileSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..");
const page = readFileSync(path.join(ROOT, "src/app/dashboard/page.tsx"), "utf8");
const profile = readFileSync(path.join(ROOT, "src/components/customer-roblox-profile.tsx"), "utf8");
const css = readFileSync(path.join(ROOT, "src/app/dashboard/dashboard.module.css"), "utf8");

describe("dashboard Roblox-first hero", () => {
  it("renders the Roblox profile in the top hero instead of the sidebar", () => {
    const heroStart = page.indexOf("<header className={styles.hero}>");
    const heroEnd = page.indexOf("</header>", heroStart);
    const sidebar = page.slice(page.indexOf("<aside className={styles.sidebar}>"));

    expect(page.slice(heroStart, heroEnd)).toContain("<RobloxProfileSection");
    expect(sidebar).not.toContain("<RobloxProfileSection");
    expect(page).not.toContain("<h1>Привет,");
  });

  it("keeps profile purchase and compact bonus actions in one component", () => {
    expect(profile).toContain("Купить на этот аккаунт");
    expect(profile).toContain("styles.robloxBonusCompact");
    expect(profile).toContain("styles.robloxHeroAvatar");
  });

  it("protects long Roblox names from horizontal overflow on mobile", () => {
    expect(css).toMatch(/\.robloxHeroShell\{[^}]*minmax\(0,/);
    expect(css).toMatch(/\.robloxHeroTitle\{[^}]*overflow-wrap:anywhere/);
    expect(css).toMatch(/\.robloxHeroCopy\{min-width:0/);
    expect(css).toContain(".robloxHeroIdentity{grid-template-columns:1fr;gap:13px");
  });
});
