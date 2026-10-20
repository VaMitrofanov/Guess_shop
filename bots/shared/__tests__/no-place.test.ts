/**
 * «Нет игры» в ветке ключа → сразу инструкция по плейсу (20.10.2026).
 * Вопроса «аккаунт новый?» нет — решение владельца: только пояснение и шаги.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { keyCreateVerdict } from "../gamepass-create-messages";
import { questKeyFailScreen } from "../gamepass-quest";
import {
  PLACE_HELP_EVENT,
  PLACE_STEPS,
  STUDIO_DOWNLOAD_URL,
  placeGuideUrl,
  placeHelpInfo,
  placeStepsText,
  showsPlaceHelp,
} from "../no-place";
import { placeHelpAdminText, recordPlaceHelp, shouldNotifyPlaceHelp } from "../no-place-notice";
import { buyerStepEventText, buyerStepMessage } from "../buyer-step";

const root = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("когда показываем инструкцию по плейсу", () => {
  it("на «игр нет» и «игры скрыты», и больше нигде", () => {
    expect(showsPlaceHelp("no_universe")).toBe(true);
    expect(showsPlaceHelp("games_hidden")).toBe(true);
    for (const code of ["bad_key", "bad_scope", "bad_game_link", "network", null, undefined]) {
      expect(showsPlaceHelp(code)).toBe(false);
    }
    expect(keyCreateVerdict("no_universe").placeHelp).toBe("no_universe");
    expect(keyCreateVerdict("games_hidden").placeHelp).toBe("games_hidden");
    expect(keyCreateVerdict("bad_key").placeHelp).toBeUndefined();
  });

  it("пояснение — формулировка владельца, без вопроса", () => {
    expect(placeHelpInfo("no_universe")).toContain("Скорее всего у тебя новый аккаунт");
    expect(placeHelpInfo("no_universe")).toContain("это нормально");
    expect(placeHelpInfo("no_universe")).toContain("раз и навсегда");
    // У «скрыты» игра может быть — фраза мягче.
    expect(placeHelpInfo("games_hidden")).toContain("Если своей игры у тебя ещё нет");
  });

  it("экран отказа: пояснение, Studio и шаги — без кнопок «да/нет»", () => {
    const screen = questKeyFailScreen({ verdict: keyCreateVerdict("no_universe"), wbCode: "AB12CD3", nick: "lox23" });
    expect(screen.text).toContain("Скорее всего у тебя новый аккаунт");
    const buttons = screen.rows.flat();
    expect(buttons.some((b) => b.url === STUDIO_DOWNLOAD_URL)).toBe(true);
    expect(buttons.some((b) => b.url?.includes("stage=place"))).toBe(true);
    expect(buttons.some((b) => /Да|Нет/.test(b.label))).toBe(false);
    expect(screen.rows.length).toBeLessThanOrEqual(6);
  });

  it("другие отказы инструкцию по плейсу не показывают", () => {
    const screen = questKeyFailScreen({ verdict: keyCreateVerdict("bad_key"), wbCode: "AB12CD3" });
    expect(screen.text).not.toContain("новый аккаунт");
  });
});

describe("шаги и кадры", () => {
  it("три кадра на нашем домене, и они лежат в public/guide", () => {
    expect(PLACE_STEPS).toHaveLength(3);
    for (const step of PLACE_STEPS) {
      expect(step.image.startsWith("https://robloxbank.ru/guide/place-")).toBe(true);
      const file = join(root, "public", new URL(step.image).pathname);
      expect(readFileSync(file).length).toBeGreaterThan(10_000);
      expect(step.caption.length).toBeLessThanOrEqual(1024);
    }
  });

  it("шаги называют Studio, New Experience и Publish to Roblox", () => {
    const text = placeStepsText();
    for (const word of ["Roblox Studio", "New Experience", "Publish to Roblox", "только на компьютере", "ключ ещё раз"]) {
      expect(text).toContain(word);
    }
  });

  it("ссылка на инструкцию открывает раздел плейса", () => {
    expect(placeGuideUrl("AB12CD3", "lox23")).toBe("https://robloxbank.ru/guide?source=wb&skip=1&code=AB12CD3&username=lox23&stage=place");
    expect(placeGuideUrl(null)).toBe("https://robloxbank.ru/guide?source=direct&stage=place");
  });

  it("админка может попросить этот шаг сама", () => {
    const msg = buyerStepMessage("place", { wbCode: "AB12CD3", amount: 500 });
    expect(msg.html).toContain("New Experience");
    expect(msg.buttons.flat().some((b) => "url" in b && b.url === STUDIO_DOWNLOAD_URL)).toBe(true);
  });
});

describe("админам и в заказ", () => {
  it("карточка называет код, ник и что ушло покупателю", () => {
    const text = placeHelpAdminText({ via: "tg-bot", verdict: "no_universe", wbCode: "AB12CD3", denomination: 500, nick: "lox<23>", buyer: "@kid" });
    expect(text).toContain("нет плейса");
    expect(text).toContain("AB12CD3");
    expect(text).toContain("lox&lt;23&gt;");
    expect(text).toContain("Publish to Roblox");
  });

  it("карточка не чаще раза в 30 минут на покупателя", () => {
    const t = 1_000_000_000;
    expect(shouldNotifyPlaceHelp("tg:1", t)).toBe(true);
    expect(shouldNotifyPlaceHelp("tg:1", t + 60_000)).toBe(false);
    expect(shouldNotifyPlaceHelp("tg:1", t + 31 * 60_000)).toBe(true);
  });

  it("событие пишется в заказ и читается в карточке", async () => {
    const created: Array<{ type: string; idempotencyKey: string }> = [];
    await recordPlaceHelp({
      wbOrder: { findFirst: async () => ({ id: "ord1" }) },
      orderEvent: { create: async (args: unknown) => { created.push((args as { data: (typeof created)[number] }).data); return {}; } },
    }, { via: "site", verdict: "games_hidden", wbCode: "AB12CD3" });
    expect(created[0].type).toBe(PLACE_HELP_EVENT);
    expect(created[0].idempotencyKey).toMatch(/^noplace:ord1:\d+$/);
    expect(buyerStepEventText(PLACE_HELP_EVENT, { via: "site" })).toContain("на сайте");
  });
});

describe("проводка", () => {
  it("оба бота шлют помощь после экрана отказа", () => {
    expect(read("bots/tg/handlers.ts").match(/if \(verdict\.placeHelp\) await sendPlaceHelpTg/g)?.length).toBe(3);
    expect(read("bots/vk/handlers.ts").match(/if \(verdict\.placeHelp\) await sendPlaceHelpVk/g)?.length).toBe(3);
  });

  it("сайт: раздел в блоке ключа и по ?stage=place, сигнал админам", () => {
    expect(read("src/app/guide/KeyCreate.tsx")).toContain("showsPlaceHelp(error) &&");
    expect(read("src/app/guide/KeyCreate.tsx")).toContain("/api/wb-code/place-help");
    expect(read("src/app/guide/page.tsx")).toContain('stage === "place"');
    expect(read("src/app/guide/GamepassCheck.tsx")).toContain('initialStage === "place" && <PlaceSteps />');
  });
});
