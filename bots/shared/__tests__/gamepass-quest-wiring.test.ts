export {};

/**
 * Квест обязан быть ОДИНАКОВЫМ в трёх местах: на сайте, в TG и в VK.
 *
 * Проверять это на живых ботах нечем (Telegraf и vk-io требуют сети), поэтому
 * здесь — контракт по исходникам: те точки, где расхождение уже случалось или
 * стоило бы дорого.
 *
 * Почему именно эти пункты:
 *   • **Один разбор плана.** Пока ботовая ветка ника считала «один пасс ровно
 *     за ceil(номинал/0.7)», а сайт складывал заказ из выставленного, один и
 *     тот же аккаунт получал два разных ответа.
 *   • **Ключ читается раньше ника и ссылки.** Иначе длинная строка ключа
 *     уходит в разбор ника и получает «ник не похож на ник Roblox».
 *   • **Набор частей сохраняется в БД.** Заказ, собранный из двух пассов, без
 *     `WbOrderGamepass` уедет к админу как один пасс не той цены.
 *   • **Ядро — в `bots/shared`.** Боты не видят `src/`, и копия правил в
 *     двух местах разойдётся молча.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const TG = read("bots/tg/handlers.ts");
const VK = read("bots/vk/handlers.ts");

describe.each([
  ["TG", TG],
  ["VK", VK],
])("%s: квест собран из общего ядра", (_name, source) => {
  test("разбор аккаунта считает общий gamepass-plan, а не своя арифметика", () => {
    expect(source).toContain('from "../shared/gamepass-plan"');
    expect(source).toContain("planFromOwned(");
    expect(source).toContain("targetsToCreate(");
  });

  test("тексты и кнопки берутся из общего gamepass-quest", () => {
    expect(source).toContain('from "../shared/gamepass-quest"');
    expect(source).toContain("questResultScreen(");
    expect(source).toContain("questForkScreen(");
    expect(source).toContain("questKeyScreen(");
  });

  test("ветка ключа под флагом GAMEPASS_AUTOCREATE — тем же, что у сайта", () => {
    expect(source).toContain('from "../shared/gamepass-autocreate-flag"');
    expect(source).toContain("gamepassAutocreateEnabled()");
  });

  test("вердикты по ключу — общие с сайтом, своих формулировок нет", () => {
    expect(source).toContain('from "../shared/gamepass-create-messages"');
    expect(source).toContain("keyCreateVerdict(");
  });

  test("набор частей ложится в WbOrderGamepass и сумма сверяется", () => {
    expect(source).toContain("wbOrderGamepass.createMany");
    expect(source).toContain("badSplit");
  });

  test("замена пасса на одиночный стирает прежний набор частей", () => {
    // Иначе карточка менеджера покажет разбивку от ПРЕЖНЕГО пасса, и он купит
    // не то. Тот же пасс сюда не доходит — он возвращается выше как duplicate.
    expect(source).toContain("} else if (existingOrder) {");
  });

  test("сохранённый ключ берётся только СВОЙ (фильтр по userId)", () => {
    // Ключ — креденшл: брать его «по нику» значит позволить любому, кто знает
    // чужой ник, создавать геймпассы на чужом аккаунте.
    expect(source).toContain("createPassesWithStoredKey");
    expect(source).toContain("userId");
    expect(read("bots/shared/roblox-api-key-store.ts")).toContain("where: { userId, robloxUsername: nick }");
  });

  test("цена основного пасса на разбитом заказе — цена ЕГО части", () => {
    expect(source).toContain("parts ? parts[0].price");
  });
});

describe("ключ обрабатывается раньше ника и ссылки", () => {
  test("TG: ветка ключа стоит перед разбором ника", () => {
    const key = TG.indexOf("pendingApiKey.has(ctx.from.id)");
    const nick = TG.indexOf("pendingRobloxNick.has(ctx.from.id)");
    expect(key).toBeGreaterThan(-1);
    expect(nick).toBeGreaterThan(-1);
    expect(key).toBeLessThan(nick);
  });

  test("VK: стейт ключа читается перед AWAITING_ROBLOX_NICK/AWAITING_LINK", () => {
    const key = VK.indexOf('state?.type === "AWAITING_API_KEY"');
    const rest = VK.indexOf('state?.type === "AWAITING_ROBLOX_NICK" || state?.type === "AWAITING_LINK"');
    expect(key).toBeGreaterThan(-1);
    expect(key).toBeLessThan(rest);
  });

  test("TG удаляет сообщение с ключом из чата", () => {
    const branch = TG.slice(TG.indexOf("async function handleApiKeyInput"));
    expect(branch.slice(0, 1200)).toContain("deleteMessage");
  });
});

describe("маркеры в карточке админа", () => {
  test("🔑 берётся из событий заказа, а не со слов клиента", () => {
    for (const source of [TG, VK]) {
      expect(source).toContain("ORDER_AUDIT_TYPE.GAMEPASS_AUTOCREATED");
    }
    expect(TG).toContain("ПАСС СОЗДАН ПО API-КЛЮЧУ");
    expect(read("bots/shared/admin.ts")).toContain("ПАСС СОЗДАН ПО API-КЛЮЧУ");
  });

  test("разбивка называет главное: части идут с РАЗНЫХ доноров", () => {
    expect(TG).toContain("ОТДЕЛЬНОГО донора");
    expect(read("bots/shared/admin.ts")).toContain("ОТДЕЛЬНОГО донора");
  });
});

describe("ядро живёт в bots/shared, а веб только переэкспортирует", () => {
  test.each([
    ["src/lib/gamepass-plan.ts", "bots/shared/gamepass-plan"],
    ["src/lib/gamepass-create-messages.ts", "bots/shared/gamepass-create-messages"],
    ["src/lib/gamepass-autocreate-flag.ts", "bots/shared/gamepass-autocreate-flag"],
  ])("%s переэкспортирует %s", (webFile, core) => {
    const source = read(webFile);
    expect(source).toContain(core);
    // Признак копии: своя реализация вместо переэкспорта.
    expect(source).not.toContain("function planFromOwned");
  });

  test("формула цены пасса — одна на проект", () => {
    expect(read("src/lib/purchase-guard.ts")).toContain('from "../../bots/shared/gamepass-plan"');
    expect(read("bots/shared/gamepass-plan.ts")).toContain("export const expectedGamepassPrice");
  });
});
