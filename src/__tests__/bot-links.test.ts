import fs from "node:fs";
import path from "node:path";

import { TG_BOT_URL, TG_HELP_START, tgBotHref } from "@/lib/bot-links";

/**
 * Голой ссылки на бота больше нет.
 *
 * Кнопка «Telegram» жила в четырёх местах инструкции, и во всех четырёх без
 * кода вела на `t.me/RobloxBankBot`. Человек, открывший `robloxbank.ru/guide`
 * из запасной строки сообщения WB и не введший код, приходил в бота, который
 * его не знает: постоянный клиент получал апселл «купи напрямую», новый — общий
 * велком. Владелец 07.09.2026: «голая ссылка всё руинит, пользователи тыкают по
 * сайту как неприкаянные».
 */

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

const CORRIDOR = [
  "src/app/guide/GamepassCheck.tsx",
  "src/app/guide/GuideClient.tsx",
  "src/app/guide/WBInstructionV2.tsx",
];

describe("tgBotHref", () => {
  test("с кодом — прямо в заказ", () => {
    expect(tgBotHref("JS6NQB9", "sess-1")).toBe(`${TG_BOT_URL}?start=wb_JS6NQB9_sess-1`);
  });

  test("без кода — за помощью, а не в пустоту", () => {
    expect(tgBotHref()).toBe(`${TG_BOT_URL}?start=${TG_HELP_START}`);
    expect(tgBotHref("")).toBe(`${TG_BOT_URL}?start=${TG_HELP_START}`);
  });

  test("payload помощи не спутать с кодом ВБ — иначе бот пойдёт искать его в базе", () => {
    expect(/^[A-Z0-9]{7}$/.test(TG_HELP_START.toUpperCase())).toBe(false);
  });
});

describe("страницы коридора", () => {
  test.each(CORRIDOR)("%s не собирает ссылку на бота руками", (file) => {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const bare = source.match(/"https:\/\/t\.me\/RobloxBankBot"/g) ?? [];
    expect(bare).toHaveLength(0);
    expect(source).toContain("tgBotHref(");
  });
});

describe("боты знают этот payload", () => {
  test("Telegram разбирает wbhelp и не идёт с ним в базу за кодом", () => {
    const source = read("bots/tg/handlers.ts");
    expect(source).toContain("TG_HELP_START");
    expect(source).toContain("if (helpMode) code = \"\";");
  });

  test("ВКонтакте разбирает ref=WBHELP", () => {
    const source = read("bots/vk/handlers.ts");
    expect(source).toContain("VK_HELP_REF");
    expect(source).toContain("handleHelpRef");
  });

  test("кнопка ВК без кода несёт тот же признак", () => {
    expect(read("src/components/auth/VKAuthButton.tsx")).toContain("VK_HELP_REF");
  });
});
