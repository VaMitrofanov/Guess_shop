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
    expect(profile).toContain("Открыть в Roblox");
    expect(profile).toContain("Официальный профиль Roblox");
    expect(profile).not.toContain("Открыть профиль <ExternalLink");
    expect(profile).toContain("styles.robloxBonusCompact");
    expect(profile).toContain("styles.robloxHeroAvatar");
    expect(profile).toContain("Подтверждён заказом");
    expect(profile).toContain("Это не проверка владения аккаунтом");
    expect(profile).toContain("styles.robloxAccountSwitcher");
    expect(profile).toContain("Добавить ник");
  });

  // Аватар обязан грузиться БРАУЗЕРОМ. С RF-хоста `tr.rbxcdn.com` не резолвится
  // (CNAME обрывается на `trns1.rbxcdn.com` без A-записи), поэтому любой путь,
  // который тянет картинку с нашей стороны, обречён: оптимизатор Next отдаёт
  // 500, а прежний прокси `/api/account/roblox-avatar/` — 502. У покупателя тот
  // же адрес резолвится, и картинка приходит.
  it("loads the avatar in the browser and falls back to an icon if it fails", () => {
    expect(profile).toContain("unoptimized");
    expect(profile).not.toContain("/_next/image");
    expect(profile).not.toContain("/api/account/roblox-avatar/");
    expect(profile).toContain("onError={() => markAvatarFailed(visibleMainAvatarUrl)}");
    expect(profile).toContain("onError={() => markAvatarFailed(visibleAvatarUrl)}");
    expect(profile).toContain("<UserRound size={42} />");
  });

  it("checkout carries the same rule on every Roblox image", () => {
    const checkout = readFileSync(path.join(ROOT, "src/app/checkout/page.tsx"), "utf8");
    const optimized = checkout.match(/<Image (?![^>]*unoptimized)[^>]*>/g) ?? [];
    expect(optimized).toEqual([]);
  });

  it("protects long Roblox names from horizontal overflow on mobile", () => {
    expect(css).toMatch(/\.robloxHeroShell\{[^}]*minmax\(0,/);
    expect(css).toMatch(/\.robloxHeroTitle\{[^}]*overflow-wrap:anywhere/);
    expect(css).toMatch(/\.robloxHeroCopy\{min-width:0/);
    expect(css).toContain(".robloxHeroIdentity{grid-template-columns:1fr;gap:13px");
  });
});
