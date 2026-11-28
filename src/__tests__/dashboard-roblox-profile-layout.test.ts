import { readFileSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..");
const page = readFileSync(path.join(ROOT, "src/app/dashboard/page.tsx"), "utf8");
const profile = readFileSync(path.join(ROOT, "src/components/customer-roblox-profile.tsx"), "utf8");
const css = readFileSync(path.join(ROOT, "src/app/dashboard/dashboard.module.css"), "utf8");

describe("dashboard Roblox-first hero", () => {
  // 🪪 18.11.2026: лицо профиля — `ProfileHero` (персонаж Roblox на подиуме) над
  // сеткой кабинета; управление ником и ключом — тот же компонент в режиме
  // `manage` в сайдбаре.
  it("renders the profile card on top and Roblox account management in the sidebar", () => {
    const gridStart = page.indexOf("<div className={styles.dashboardGrid}>");
    const sidebar = page.slice(page.indexOf("<aside className={styles.sidebar}>"));
    expect(page.indexOf("<ProfileHeroSection")).toBeGreaterThan(-1);
    expect(page.indexOf("<ProfileHeroSection")).toBeLessThan(gridStart);
    expect(sidebar).toContain("<RobloxManageSection");
    expect(sidebar).not.toContain("<ProfileHeroSection");
    expect(page).not.toContain("<h1>Привет,");
  });

  it("profile card loads Roblox renders in the browser, never through our server", () => {
    const hero = readFileSync(path.join(ROOT, "src/components/account/profile-hero.tsx"), "utf8");
    expect(hero).not.toContain("/_next/image");
    expect(hero).not.toContain("next/image");
    expect(hero).toContain("onError={() => fail(src)}");
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
