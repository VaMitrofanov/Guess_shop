/**
 * 🚫 Аннулирование кода гейта — «деньги вернулись, код больше не работает».
 *
 * Тест сторожит ровно то, ради чего фича заводилась: код отменённого заказа не
 * должен активироваться НИ ОДНИМ путём. Дверей девять, и они разбросаны по
 * сайту, обоим ботам и админке — именно поэтому проверка читает исходники, а
 * не гоняет happy path: новая дверь без гарда компилируется молча, а стоит она
 * номинал заказа в робуксах.
 *
 * Живой случай: `XKFFJUU` (WB #5722328333), 12.09.2026. WB вернул покупателю
 * 453 ₽, код на 500 R$ остался `AVAILABLE` и принимался везде.
 */

import { readFileSync } from "fs";
import { join } from "path";
import {
  REVOKED_CODE_REFUSAL,
  REVOKED_CODE_STATUS,
  isRevokedCode,
  revocationHoldReason,
} from "@/lib/wb-code-revocation";
import { canRevokeGateCode, wbDeliveryStage } from "../../bots/shared/wb-delivery-policy";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("предикат аннулирования", () => {
  it("узнаёт аннулированный код и не выдумывает его", () => {
    expect(isRevokedCode({ status: REVOKED_CODE_STATUS })).toBe(true);
    expect(isRevokedCode({ status: "AVAILABLE" })).toBe(false);
    expect(isRevokedCode({ status: "CLAIMED" })).toBe(false);
    expect(isRevokedCode(null)).toBe(false);
    expect(isRevokedCode(undefined)).toBe(false);
  });

  it("отказ покупателю называет причину и не обвиняет", () => {
    // Заявку на возврат мог подать не тот, кто сейчас вводит код (карту дарили).
    expect(REVOKED_CODE_REFUSAL).toContain("отменён");
    expect(REVOKED_CODE_REFUSAL).toContain("напиши нам");
  });

  it("причина заморозки отсылает к конкретному заказу WB", () => {
    expect(revocationHoldReason("5722328333")).toContain("5722328333");
  });
});

/** Каждая дверь, за которой код превращается в заказ. Пропущенная дверь —
 * это выданные бесплатно робуксы, а не косметика. */
describe("двери активации закрыты", () => {
  it.each([
    ["сайт: ввод кода", "src/app/api/wb-code/route.ts"],
    ["сайт: подстановка пасса", "src/app/api/wb-code/select-gamepass/route.ts"],
    ["вход по коду", "src/auth.ts"],
    ["TG-бот", "bots/tg/handlers.ts"],
    ["VK-бот", "bots/vk/handlers.ts"],
    ["ручное создание заказа в TWA", "src/app/api/twa/orders/route.ts"],
  ])("%s спрашивает isRevokedCode", (_name, file) => {
    expect(read(file)).toContain("isRevokedCode");
  });

  it("коридор VK не привязывает аннулированный код по статусу-исключению", () => {
    // `status: { not: "CLAIMED" }` пропускал REVOKED: условие отсекало только
    // уже активированные коды, а не отменённые.
    const link = read("src/app/api/wb-link/route.ts");
    expect(link).not.toContain('not: "CLAIMED"');
    expect(link).toContain('status: { in: ["AVAILABLE", "RESERVED"] }');
  });
});

describe("две защёлки, а не одна", () => {
  const core = read("bots/shared/wb-code-revocation.ts");

  it("аннулирование ставит ещё и заморозку", () => {
    // Заморозка перекрывает ВЫКУП во всех путях сразу и уже покрыта тестами:
    // если новая дверь активации появится без гарда, робуксы всё равно не уйдут.
    expect(core).toContain("holdByCode");
    const revoke = core.slice(core.indexOf("export async function revokeGateCode"));
    expect(revoke).toContain("holdByCode");
  });

  it("гард активации никогда не бросает", () => {
    // Недоступная база не имеет права превратить активацию оплаченного заказа
    // в отказ: цена ошибки несимметрична.
    const guard = core.slice(
      core.indexOf("export async function codeActivationRefusal"),
      core.indexOf("export interface RevokeInput"),
    );
    expect(guard).toContain("catch");
    expect(guard).toContain("return null");
  });

  it("выкупленный заказ автоматика не трогает", () => {
    // Робуксы потрачены — это разбор человека, а не одна кнопка.
    expect(canRevokeGateCode({ cancelledAt: new Date(), gateState: "SENT", internalStatus: "COMPLETED" })).toBe(false);
    expect(canRevokeGateCode({ cancelledAt: new Date(), gateState: "SENT", internalStatus: "PENDING" })).toBe(false);
    expect(canRevokeGateCode({ cancelledAt: new Date(), gateState: "SENT", internalStatus: "REJECTED" })).toBe(true);
    expect(canRevokeGateCode({ cancelledAt: new Date(), gateState: "SENT", internalStatus: null })).toBe(true);
  });

  it("живой заказ аннулировать нельзя", () => {
    expect(canRevokeGateCode({ cancelledAt: null, gateState: "SENT", internalStatus: null })).toBe(false);
  });

  it("невыпущенный код аннулировать нечем", () => {
    expect(canRevokeGateCode({ cancelledAt: new Date(), gateState: "NOT_ISSUED", internalStatus: null })).toBe(false);
  });
});

describe("отменённый заказ уходит из «Нужна проверка»", () => {
  const base = { chatState: "CODE_RECEIVED", supplierStatus: "receive", cancelledAt: new Date() };

  it("до аннулирования — держим перед глазами", () => {
    expect(wbDeliveryStage({ ...base, gateState: "SENT", internalStatus: null })).toBe("attention");
  });

  it("после аннулирования — закрыт", () => {
    // Единственный выход: до 12.09.2026 снятие требовало закрытого внутреннего
    // заказа, то есть код сначала надо было дать активировать.
    expect(wbDeliveryStage({ ...base, gateState: "REVOKED", internalStatus: null })).toBe("cancelled");
  });
});

describe("исход отмены назван честно", () => {
  const notify = read("bots/shared/wb-delivery-admin-notify.ts");
  const sync = read("bots/shared/wb-delivery-sync.ts");

  it("у выкупленного заказа свой исход", () => {
    // Раньше `outcome` считался только когда статус не COMPLETED/REJECTED,
    // и отмена уже выкупленного заказа приходила с текстом «гейт выдан, но не
    // активирован» и спокойным значком.
    expect(notify).toContain("already_delivered");
    expect(sync).toContain('outcome = "already_delivered"');
  });

  it("потраченные робуксы — срочно", () => {
    expect(notify).toContain('outcome === "needs_human" || outcome === "already_delivered" ? "urgent"');
  });

  it("аннулирование названо в уведомлении, а не спрятано", () => {
    expect(notify).toContain("аннулирован");
  });
});

describe("хвост «код не открыт» отделён от воронки", () => {
  const sent = new Date(Date.now() - 3 * 24 * 60 * 60_000);
  const base = { chatState: "CODE_RECEIVED", supplierStatus: "receive", gateState: "SENT" };

  it("трое суток без активации — не «идёт по воронке»", () => {
    expect(wbDeliveryStage({ ...base, internalStatus: null, gateSentAt: sent })).toBe("stalled");
  });

  it("свежий гейт остаётся в боте", () => {
    expect(wbDeliveryStage({ ...base, internalStatus: null, gateSentAt: new Date() })).toBe("in_bot");
  });

  it("активированный код — обычная воронка", () => {
    expect(wbDeliveryStage({ ...base, internalStatus: "AWAITING_GAMEPASS", gateSentAt: sent })).toBe("in_bot");
  });
});
