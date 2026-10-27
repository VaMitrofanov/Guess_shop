jest.mock("../../bots/shared/wb-delivery-api", () => ({ sendBuyerChatMessage: jest.fn() }));
jest.mock("../../bots/shared/wb-dbs-thread", () => ({ dbsRef: jest.fn(), refreshDbsCard: jest.fn() }));

import { detectWbCancelIntent } from "../../bots/shared/wb-cancel-mode";
import {
  canReceiveWbOrder,
  wbReceiveGracePending,
  WB_RECEIVE_GRACE_MS,
} from "../../bots/shared/wb-delivery-policy";
import { wbCancelAcceptedMessage } from "../../bots/shared/wb-gate-link";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Слово «отмена» в чате WB", () => {
  it.each([
    "Отмените заказ пожалуйста",
    "хочу отменить",
    "отмена",
    "Оформите отказ",
    "я передумал",
    "верните деньги",
    "Хочу возврат денег",
    "отмена, код 123 456",
  ])("«%s» — отмена", (text) => {
    expect(detectWbCancelIntent(text)).toBe("cancel");
  });

  it.each([
    "продолжить",
    "Продолжаем",
    "не отменяйте",
    "не надо отменять, я разобрался",
    "Не хочу отменять",
  ])("«%s» — продолжить", (text) => {
    expect(detectWbCancelIntent(text)).toBe("resume");
  });

  it.each([
    "123456",
    "Здравствуйте, где мои робуксы?",
    "Как создать геймпасс",
    "",
  ])("«%s» — ни то ни другое", (text) => {
    expect(detectWbCancelIntent(text)).toBeNull();
  });
});

describe("Пауза перед автозакрытием", () => {
  it("две минуты", () => {
    expect(WB_RECEIVE_GRACE_MS).toBe(120_000);
  });

  it("код минуту назад — ждём, три минуты назад — можно закрывать", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    expect(wbReceiveGracePending(new Date(now.getTime() - 60_000), now)).toBe(true);
    expect(wbReceiveGracePending(new Date(now.getTime() - 3 * 60_000), now)).toBe(false);
  });
});

describe("Режим отмены не даёт закрыть доставку", () => {
  const base = {
    chatState: "CODE_RECEIVED",
    gateState: "NOT_ISSUED",
    supplierStatus: "deliver",
    hasLiveSecret: true,
    secretFailedAttempts: 0,
  };

  it("без отмены закрыть можно, с отменой — нельзя", () => {
    expect(canReceiveWbOrder(base)).toBe(true);
    expect(canReceiveWbOrder({ ...base, cancelRequestedAt: new Date() })).toBe(false);
  });
});

describe("Сообщение покупателю", () => {
  it("просит код текстом, «продолжить» — только если отменил сам покупатель", () => {
    const own = wbCancelAcceptedMessage({ hasCode: false, byBuyer: true });
    expect(own).toContain("код доставки");
    expect(own).toContain("«продолжить»");
    expect(wbCancelAcceptedMessage({ hasCode: false, byBuyer: false })).not.toContain("продолжить");
  });
});

describe("Воркер: порядок проверок", () => {
  const sync = readFileSync(join(process.cwd(), "bots/shared/wb-delivery-sync.ts"), "utf8");

  it("«отмена» разбирается до захвата кода в том же сообщении", () => {
    expect(sync.indexOf("detectWbCancelIntent(rawText)")).toBeLessThan(sync.indexOf("await captureDeliveryCode(db, order, deliveryCode"));
  });

  it("свип автозакрытия и алерт «застрял» не трогают режим отмены", () => {
    expect(sync.match(/cancelRequestedAt: null,/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("отмена проверяется раньше паузы и окна", () => {
    const fn = sync.slice(sync.indexOf("async function tryAutoReceive"));
    expect(fn.indexOf('skip: "cancel_requested"')).toBeLessThan(fn.indexOf('skip: "grace"'));
  });
});
