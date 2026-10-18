export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  INTAKE_NUDGE_AFTER_MS,
  INTAKE_TTL_MS,
  MAX_PROBLEM_LEN,
  __resetIntakeCache,
  cancelIntake,
  clipProblemText,
  intakeAckText,
  intakePromptText,
  isIntakeCancel,
  isUsableProblem,
  looksLikeFlowInput,
  openIntake,
  readIntake,
  sweepSilentIntakes,
  takeIntake,
  type IntakeSweepDb,
} from "../support-intake";

/**
 * Поддержка: сначала описание проблемы, потом уведомление в админку.
 *
 * Замечание владельца 18.10.2026: алерт уходил в момент нажатия кнопки, в нём
 * стоял ЭТАП («Общий вопрос»), а не слова человека, и каждый мисклик поднимал
 * тревогу. Эти тесты держат три правила: нажатие ничего не шлёт, ожидание
 * переживает рестарт процесса, ввод флоу выигрывает у описания.
 */

/** Минимальная «база»: одна строка `User` на площадку. */
function fakeDb() {
  const rows: Array<Record<string, any>> = [
    { tgId: "777", vkId: null, supportIntakeAt: null, supportIntakeCtx: null },
    { tgId: null, vkId: "555", supportIntakeAt: null, supportIntakeCtx: null },
  ];
  const match = (row: Record<string, any>, where: Record<string, any>) =>
    Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    rows,
    user: {
      findFirst: async ({ where }: any) => rows.find((r) => match(r, where)) ?? null,
      findMany: async ({ where }: any) =>
        rows.filter((r) => (where?.supportIntakeAt?.not === null ? r.supportIntakeAt !== null : true)),
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of rows) {
          if (!match(row, where)) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      },
    },
  };
}

beforeEach(() => __resetIntakeCache());

describe("ожидание описания", () => {
  it("нажатие кнопки ставит ожидание и ничего не шлёт", async () => {
    const db = fakeDb();
    await openIntake(db, { tgId: "777" }, { platform: "TG", contextKey: "pending_long", wbCode: "VGAA3F2" });

    expect(db.rows[0].supportIntakeAt).toBeInstanceOf(Date);
    const intake = await readIntake(db, { tgId: "777" });
    expect(intake).toMatchObject({ platform: "TG", contextKey: "pending_long", wbCode: "VGAA3F2" });
  });

  it("переживает рестарт процесса — читается из базы, а не из памяти", async () => {
    const db = fakeDb();
    await openIntake(db, { vkId: "555" }, { platform: "VK", contextKey: "general", denomination: 1000 });

    __resetIntakeCache(); // деплой/рестарт бота
    const intake = await readIntake(db, { vkId: "555" });
    expect(intake).toMatchObject({ platform: "VK", contextKey: "general", denomination: 1000 });
  });

  it("описание забирается один раз — второго алерта из того же ожидания не будет", async () => {
    const db = fakeDb();
    await openIntake(db, { tgId: "777" }, { platform: "TG", contextKey: "general" });

    expect(await takeIntake(db, { tgId: "777" })).not.toBeNull();
    expect(await takeIntake(db, { tgId: "777" })).toBeNull();
    expect(db.rows[0].supportIntakeAt).toBeNull();
  });

  it("«отмена» снимает ожидание без алерта", async () => {
    const db = fakeDb();
    await openIntake(db, { tgId: "777" }, { platform: "TG", contextKey: "general" });
    await cancelIntake(db, { tgId: "777" });

    expect(await readIntake(db, { tgId: "777" })).toBeNull();
    expect(db.rows[0].supportIntakeCtx).toBeNull();
  });

  it("просроченное ожидание не ловит сообщение «из ниоткуда»", async () => {
    const db = fakeDb();
    await openIntake(db, { tgId: "777" }, { platform: "TG", contextKey: "general" });
    db.rows[0].supportIntakeAt = new Date(Date.now() - INTAKE_TTL_MS - 1000);
    __resetIntakeCache();

    expect(await readIntake(db, { tgId: "777" })).toBeNull();
  });

  it("ожидание одной площадки не задевает другую", async () => {
    const db = fakeDb();
    await openIntake(db, { tgId: "777" }, { platform: "TG", contextKey: "general" });
    expect(await readIntake(db, { vkId: "555" })).toBeNull();
  });
});

describe("что считается описанием", () => {
  it.each(["отмена", "Отмена", "+бот", "передумал"])("«%s» — это отказ", (word) => {
    expect(isIntakeCancel(word)).toBe(true);
  });

  it("рассказ о проблеме отказом не считается", () => {
    expect(isIntakeCancel("не пришли робуксы, уже три дня")).toBe(false);
  });

  it("скриншот без подписи — описание (решение владельца О3)", () => {
    expect(isUsableProblem("", true)).toBe(true);
  });

  it("«?» описанием не считается — такой алерт не лучше пустого нажатия", () => {
    expect(isUsableProblem("?", false)).toBe(false);
    expect(isUsableProblem("не вижу геймпасс", false)).toBe(true);
  });

  it("длинное описание режется, а не ломает алерт", () => {
    const clipped = clipProblemText(`${"я".repeat(900)}`);
    expect(clipped).toHaveLength(MAX_PROBLEM_LEN);
    expect(clipped.endsWith("…")).toBe(true);
  });

  it("переносы строк не рвут строку алерта", () => {
    expect(clipProblemText("не вижу\n\nгеймпасс")).toBe("не вижу геймпасс");
  });
});

describe("ввод флоу выигрывает у описания", () => {
  it("ссылка/ID геймпасса уходит в квест, а не в поддержку", () => {
    expect(looksLikeFlowInput("https://www.roblox.com/game-pass/123", { passId: true })).toBe(true);
  });

  it("код ВБ — тоже флоу", () => {
    expect(looksLikeFlowInput("VGAA3F2")).toBe(true);
  });

  it("ник — только когда флоу его ждёт", () => {
    expect(looksLikeFlowInput("lox23_limon", { expectsNick: true })).toBe(true);
    expect(looksLikeFlowInput("lox23_limon", { expectsNick: false })).toBe(false);
  });

  it("ключ Open Cloud не уезжает менеджеру текстом", () => {
    expect(looksLikeFlowInput("a".repeat(120))).toBe(true);
  });

  it("а живая фраза о проблеме — это описание", () => {
    expect(looksLikeFlowInput("помогите, не пришли робуксы за 1000")).toBe(false);
  });
});

describe("нажал и молчит (О2)", () => {
  it("до 10 минут админам не говорим ничего", async () => {
    const db = fakeDb();
    await openIntake(db, { tgId: "777" }, { platform: "TG", contextKey: "general" });
    expect(await sweepSilentIntakes(db as unknown as IntakeSweepDb)).toHaveLength(0);
  });

  it("после 10 минут — один тихий одностроч, и больше не повторяется", async () => {
    const db = fakeDb();
    await openIntake(db, { tgId: "777" }, { platform: "TG", contextKey: "pending_long", wbCode: "VGAA3F2" });
    db.rows[0].supportIntakeAt = new Date(Date.now() - INTAKE_NUDGE_AFTER_MS - 1000);
    __resetIntakeCache();

    const first = await sweepSilentIntakes(db as unknown as IntakeSweepDb);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ who: { tgId: "777" }, ctx: { contextKey: "pending_long", wbCode: "VGAA3F2" } });

    expect(await sweepSilentIntakes(db as unknown as IntakeSweepDb)).toHaveLength(0);
    // Ожидание при этом ЖИВО: человек ещё может описать проблему.
    expect(db.rows[0].supportIntakeAt).not.toBeNull();
  });

  it("просроченное ожидание свип снимает и тревогу не поднимает", async () => {
    const db = fakeDb();
    await openIntake(db, { vkId: "555" }, { platform: "VK", contextKey: "general" });
    db.rows[1].supportIntakeAt = new Date(Date.now() - INTAKE_TTL_MS - 1000);
    __resetIntakeCache();

    expect(await sweepSilentIntakes(db as unknown as IntakeSweepDb)).toHaveLength(0);
    expect(db.rows[1].supportIntakeAt).toBeNull();
  });
});

describe("слова бота", () => {
  it("на нажатие бот просит описание, а не обещает менеджера", () => {
    const prompt = intakePromptText("VK");
    expect(prompt).toContain("Опиши");
    expect(prompt).not.toContain("Готово");
  });

  it("менеджера обещаем только после описания", () => {
    expect(intakeAckText("VK")).toContain("Передал менеджеру");
    expect(intakeAckText("TG")).toContain("@RobloxBank_PA");
  });
});

/** Границы: алерт на нажатии кнопки больше не собирается ни в одном боте. */
describe("боты не шлют алерт на нажатии", () => {
  const ROOT = join(__dirname, "..", "..", "..");
  const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

  it("TG: ветка sup: ставит ожидание и не шлёт уведомление", () => {
    const tg = read("bots/tg/handlers.ts");
    const start = tg.indexOf('if (data.startsWith("sup:"))');
    expect(start).toBeGreaterThan(-1);
    const block = tg.slice(start, tg.indexOf('if (data.startsWith("ps:"))', start));
    expect(block).toContain("openIntake(");
    expect(block).not.toContain("notifySupportShown(");
  });

  it("VK: кнопка поддержки ставит ожидание, пауза — только после описания", () => {
    const vk = read("bots/vk/handlers.ts");
    const start = vk.indexOf("async function triggerSupport(");
    const block = vk.slice(start, vk.indexOf("async function deliverSupportIntake(", start));
    expect(block).toContain("openIntake(");
    // Ожидание ставится ДО алерта и паузы: под паузой бот молчит и проглотил бы
    // описание (ровно это и было сломано до 18.10.2026).
    expect(block.indexOf("openIntake(")).toBeLessThan(block.indexOf("pauseSupport("));
  });

  it.each(["bots/tg/handlers.ts", "bots/vk/handlers.ts"])("%s передаёт слова человека в алерт", (file) => {
    expect(read(file)).toContain("problemText");
  });
});
