/**
 * Драйвер покупки геймпасса через реальный Chrome на сервере выкупа.
 *
 * Зачем: Roblox снял cookie-only economy endpoint, а новый game-passes endpoint при верной
 * цене требует chef-challenge (проверку browser fingerprint). Голый HTTP его не проходит
 * никогда — ловит `blocksession: AutomatedTampering`. Реальный Chrome проходит: проверено
 * живой покупкой 17.07 (295 → 275 R$, ownership подтверждён). Подробности и результаты
 * тестов — docs/roblox-plus-buyout-plan.md.
 *
 * Контракт: JSON на stdin → JSON на stdout. Текст покупочного скрипта приходит ИЗВНЕ
 * (его собирает roblox-purchase-script.ts на стороне бота) — так на хосте не нужен репозиторий,
 * а гарды [ЦЕНА-СТОП]/[ПРОДАВЕЦ-СТОП]/[АККАУНТ-СТОП] остаются в одном месте.
 *
 *   echo '{"script":"(async()=>{…})()","gamepassId":"123","expectedBuyerId":456,"expectedPrice":715}' \
 *     | node browser-buy-gamepass.mjs
 *
 * Ответ: { purchased, reason, price, balanceBefore, balanceAfter, ownedBefore, ownedAfter }
 *
 * Подключается к УЖЕ запущенному Chrome (session.sh), а не поднимает свой:
 * puppeteer.launch() добавил бы --enable-automation → navigator.webdriver=true. При
 * connect к чистому Chrome маркера нет (проверено).
 */
import puppeteer from "puppeteer-core";
import { pathToFileURL } from "node:url";

const BROWSER_URL = process.env.BROWSER_URL ?? "http://127.0.0.1:9222";
/** Chef решается нативно и требует времени: сеть + возможный retry запроса Roblox. */
const SETTLE_MS = 35_000;
const POLL_MS = 2_500;

const readStdin = () => new Promise((res) => {
  let b = "";
  process.stdin.on("data", (c) => (b += c));
  process.stdin.on("end", () => res(b));
});

const done = (o) => o;

/**
 * Roblox рисует окно покупки на radix-ui, а на странице живёт ещё пачка скрытых
 * legacy-.modal — querySelector цепляет не то. Берём видимый диалог с наибольшим текстом.
 */
const DIALOG_FN = `() => {
  const all = [...document.querySelectorAll('[role="dialog"], [class*="modal"]')];
  const vis = all.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 80 && r.height > 80; });
  return vis.sort((a, b) => (b.innerText || "").length - (a.innerText || "").length)[0] ?? null;
}`;

export const buyGamepass = async (input, { browserUrl = BROWSER_URL } = {}) => {
  const { script, gamepassId, expectedBuyerId, expectedPrice } = input ?? {};
  if (!script || !gamepassId) return done({ purchased: false, reason: "BadInput: нужны script и gamepassId" });

  const browser = await puppeteer.connect({ browserURL: browserUrl, defaultViewport: null }).catch(() => null);
  if (!browser) return done({ purchased: false, reason: "BrowserUnavailable: Chrome не отвечает на CDP" });

  try {
    const pages = await browser.pages();
    const page = pages.find((p) => p.url().includes("roblox.com")) ?? (await browser.newPage());
    const consoleLog = [];
    page.on("console", (m) => consoleLog.push(m.text()));

    await page.goto(`https://www.roblox.com/game-pass/${gamepassId}`, { waitUntil: "networkidle2", timeout: 60_000 });
    // Модуль покупки приезжает отдельным чанком уже после первой отрисовки.
    await new Promise((r) => setTimeout(r, 4_000));

    const snap = () => page.evaluate(async (gp) => {
      const f = (u) => fetch(u, { credentials: "include", cache: "no-store" });
      const me = await (await f("https://users.roblox.com/v1/users/authenticated")).json().catch(() => null);
      const bal = await (await f("https://economy.roblox.com/v1/user/currency")).json().catch(() => null);
      const inv = me?.id
        ? await (await f(`https://inventory.roblox.com/v1/users/${me.id}/items/GamePass/${gp}`)).json().catch(() => null)
        : null;
      return { userId: me?.id ?? null, userName: me?.name ?? null, balance: bal?.robux ?? null, owned: Array.isArray(inv?.data) ? inv.data.length > 0 : null };
    }, gamepassId);

    const before = await snap();
    if (!before.userId) return done({ purchased: false, reason: "NotLoggedIn: профиль браузера разлогинен" });
    // [АККАУНТ-СТОП] на стороне драйвера: скрипт проверяет то же, но покупка не тот
    // аккаунт — это списание не с того кошелька, дублируем до запуска.
    if (expectedBuyerId && Number(before.userId) !== Number(expectedBuyerId)) {
      return done({ purchased: false, reason: `WrongAccount: в браузере ${before.userName} (${before.userId}), ожидался ${expectedBuyerId}` });
    }
    if (before.owned === true) {
      return done({ purchased: false, reason: "AlreadyOwned: аккаунт уже владеет пассом", ownedBefore: true, balanceBefore: before.balance });
    }

    // Скрипт сам проверит гарды и откроет официальное окно Roblox.
    await page.evaluate(script);
    await new Promise((r) => setTimeout(r, 5_000));

    const guardStop = consoleLog.find((l) => /\[(ЦЕНА|ПРОДАВЕЦ|АККАУНТ|ПАСС)-СТОП\]/.test(l));
    if (guardStop) return done({ purchased: false, reason: `GuardStop: ${guardStop.replace(/%c/g, "").trim()}`, balanceBefore: before.balance });

    const modal = await page.evaluate((fn) => {
      const el = new Function("return " + fn)()();
      return el ? { text: el.innerText.replace(/\s+/g, " ").slice(0, 200), buttons: [...el.querySelectorAll("button")].map((b) => b.innerText.trim()) } : null;
    }, DIALOG_FN);
    if (!modal) {
      const err = consoleLog.filter((l) => l.includes("❌")).pop();
      return done({ purchased: false, reason: err ? `ScriptRefused: ${err.replace(/%c/g, "").trim()}` : "NoPurchaseDialog: окно не открылось", balanceBefore: before.balance });
    }

    const clicked = await page.evaluate((fn) => {
      const el = new Function("return " + fn)()();
      const btn = el && [...el.querySelectorAll("button")].find((b) => /^(buy now|buy|confirm|purchase)$/i.test(b.innerText.trim()));
      if (!btn) return false;
      btn.click();
      return true;
    }, DIALOG_FN);
    if (!clicked) return done({ purchased: false, reason: `BuyButtonMissing: в окне ${JSON.stringify(modal.buttons)}`, balanceBefore: before.balance });

    // Успех определяем ТОЛЬКО по ownership + точной дельте баланса: клик и текст
    // окна не доказывают списание, а balance API обновляется позже inventory.
    const deadline = Date.now() + SETTLE_MS;
    let after = before;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      after = await snap();
      const delta = before.balance !== null && after.balance !== null
        ? before.balance - after.balance
        : null;
      const balanceConfirmed = Number.isFinite(Number(expectedPrice))
        ? delta === Number(expectedPrice)
        : typeof delta === "number" && delta > 0;
      if (after.owned === true && balanceConfirmed) break;
    }

    if (after.owned === true) {
      const delta = before.balance !== null && after.balance !== null
        ? before.balance - after.balance
        : null;
      const expected = Number(expectedPrice);
      if (Number.isFinite(expected) && delta !== expected) {
        return done({
          purchased: false,
          reason: `BalanceMismatch: владение подтверждено, дельта ${delta ?? "unknown"} R$, ожидалось ${expected} R$`,
          price: delta,
          balanceBefore: before.balance, balanceAfter: after.balance,
          ownedBefore: false, ownedAfter: true,
        });
      }
      if (!Number.isFinite(expected) && !(typeof delta === "number" && delta > 0)) {
        return done({
          purchased: false,
          reason: "BalanceUnconfirmed: владение подтверждено, но списание не появилось в balance API",
          price: delta,
          balanceBefore: before.balance, balanceAfter: after.balance,
          ownedBefore: false, ownedAfter: true,
        });
      }
      return done({
        purchased: true,
        reason: "OK",
        price: delta,
        balanceBefore: before.balance, balanceAfter: after.balance, ownedBefore: false, ownedAfter: true,
      });
    }

    // 2SW на spending-окне: аккаунт с включённой 2FA требует код с почты на КАЖДУЮ
    // покупку, галки "trust this device" там нет. Донор без 2FA этого не увидит.
    const screen = await page.evaluate((fn) => {
      const el = new Function("return " + fn)()();
      return el ? el.innerText.replace(/\s+/g, " ").slice(0, 200) : "";
    }, DIALOG_FN);
    if (/2-step verification|enter the code/i.test(screen)) {
      return done({ purchased: false, reason: "TwoStepRequired: на аккаунте включена 2FA — нужен код с почты", balanceBefore: before.balance, balanceAfter: after.balance });
    }

    return done({ purchased: false, reason: `NotConfirmed: ${screen || "окно закрылось без подтверждения"}`, balanceBefore: before.balance, balanceAfter: after.balance, ownedAfter: after.owned });
  } catch (err) {
    return done({ purchased: false, reason: `DriverError: ${err?.message ?? String(err)}` });
  } finally {
    await browser.disconnect().catch(() => {});
  }
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    const input = JSON.parse(await readStdin());
    const result = await buyGamepass(input);
    console.log(JSON.stringify(result));
    process.exit(result.purchased ? 0 : 1);
  } catch (err) {
    console.log(JSON.stringify({ purchased: false, reason: `DriverError: ${err?.message ?? String(err)}` }));
    process.exit(1);
  }
}
