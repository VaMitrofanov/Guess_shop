import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

/**
 * «Создать сейчас» уже привязанным ключом — на сайте, а не только в ботах.
 *
 * Ради этого ключи и хранятся: человек привязал ключ один раз (в кабинете или
 * на прошлом заказе), и в следующий раз ему остаётся подтвердить заказ. Боты
 * это умели с 07.09.2026 (`createPassesWithStoredKey`), а сайт просил ключ
 * заново — у того же покупателя, который десять минут назад привязал его в
 * кабинете. Владелец 07.09.2026: «должна быть умная, бесшовная экосистема».
 *
 * Главное, что здесь нельзя ослабить: КТО владелец ключа. Решает код заказа —
 * ключ берётся строго у покупателя этого заказа и строго на этот ник. «По нику»
 * означало бы, что чужой ник — способ создать геймпасс на чужом аккаунте.
 */

const mockCreate = jest.fn();
const mockFlag = jest.fn();
const mockRemember = jest.fn();
const mockAudit = jest.fn();
const mockOrderFind = jest.fn();
const mockOrderUpdate = jest.fn();
const mockLoadForUser = jest.fn();

jest.mock("@/lib/roblox-gamepass-create", () => ({
  createGamePassViaBridge: (...args: unknown[]) => mockCreate(...args),
}));
jest.mock("@/lib/gamepass-autocreate-flag", () => ({
  gamepassAutocreateEnabled: () => mockFlag(),
}));
jest.mock("@/lib/roblox-api-key-store", () => ({
  rememberRobloxApiKey: (...args: unknown[]) => mockRemember(...args),
  loadRobloxApiKeyForUser: (...args: unknown[]) => mockLoadForUser(...args),
}));
jest.mock("@/lib/order-audit", () => ({
  auditGamepassAutocreated: (...args: unknown[]) => mockAudit(...args),
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    wbOrder: {
      findFirst: (...args: unknown[]) => mockOrderFind(...args),
      update: (...args: unknown[]) => mockOrderUpdate(...args),
    },
  },
}));

import { GET, POST } from "@/app/api/roblox/gamepass-create/route";

const KEY = "Oc567XuPVUmyo8yc0PP27WLic2c3NZcAhUStwG1vt9m8+PhA";

const post = (body: unknown, ip: string) =>
  POST(new NextRequest("https://robloxbank.ru/api/roblox/gamepass-create", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  }));

const get = (query: string, ip: string) =>
  GET(new NextRequest(`https://robloxbank.ru/api/roblox/gamepass-create?${query}`, {
    headers: { "x-forwarded-for": ip },
  }));

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true, gamePassId: 991, priceInRobux: 715 });
  mockFlag.mockReset().mockReturnValue(true);
  mockRemember.mockReset().mockResolvedValue("updated");
  mockAudit.mockReset().mockResolvedValue(undefined);
  mockOrderFind.mockReset().mockResolvedValue({ id: "ord_1", userId: "user_1", adminNote: null });
  mockOrderUpdate.mockReset().mockResolvedValue({});
  mockLoadForUser.mockReset().mockResolvedValue({ id: "k1", robloxUsername: "alumette277", key: KEY, lastUsedAt: null, createdPasses: 0 });
});

describe("GET — есть ли привязанный ключ", () => {
  test("да, если ключ лежит у покупателя ЭТОГО заказа", async () => {
    const body = await (await get("code=JS6NQB9&nick=Alumette277", "10.1.0.1")).json();
    expect(body).toEqual({ stored: true });
    expect(mockLoadForUser).toHaveBeenCalledWith("user_1", "Alumette277");
  });

  test("кривой код или ник — «нет», в базу не ходим", async () => {
    const body = await (await get("code=NOPE&nick=Alumette277", "10.1.0.2")).json();
    expect(body).toEqual({ stored: false });
    expect(mockLoadForUser).not.toHaveBeenCalled();
  });

  test("сам ключ наружу не уходит ни при каком ответе", async () => {
    const raw = await (await get("code=JS6NQB9&nick=Alumette277", "10.1.0.3")).text();
    expect(raw).not.toContain(KEY);
  });
});

describe("POST useStored — одно нажатие вместо похода в Roblox", () => {
  test("ключ берётся у владельца заказа и создаёт набор", async () => {
    const res = await post({ useStored: true, code: "JS6NQB9", nick: "Alumette277", targets: [715] }, "10.1.1.1");
    const body = await res.json();

    expect(mockLoadForUser).toHaveBeenCalledWith("user_1", "Alumette277");
    expect(mockCreate).toHaveBeenCalledWith({ apiKey: KEY, priceInRobux: 715, username: "Alumette277" });
    expect(body).toMatchObject({ ok: true, created: [{ gamePassId: 991, priceInRobux: 715 }] });
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  test("ключа нет — честный отказ, а не молчание", async () => {
    mockLoadForUser.mockResolvedValue(null);
    const body = await (await post({ useStored: true, code: "JS6NQB9", nick: "Alumette277", targets: [715] }, "10.1.1.2")).json();
    expect(body).toEqual({ ok: false, error: "no_stored_key" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("без кода заказа владельца ключа определить не по чему — отказ", async () => {
    const body = await (await post({ useStored: true, nick: "Alumette277", targets: [715] }, "10.1.1.3")).json();
    expect(body).toEqual({ ok: false, error: "no_stored_key" });
    expect(mockLoadForUser).not.toHaveBeenCalled();
  });

  test("обычный режим по-прежнему требует ключ в теле", async () => {
    const body = await (await post({ code: "JS6NQB9", nick: "Alumette277", targets: [715] }, "10.1.1.4")).json();
    expect(body).toEqual({ ok: false, error: "bad_key" });
  });
});

describe("квест на сайте показывает эту дверь", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/app/guide/GamepassCheck.tsx"), "utf8");

  test("спрашивает про сохранённый ключ и умеет им создать", () => {
    expect(source).toContain("/api/roblox/gamepass-create?code=");
    expect(source).toContain("useStored: true");
  });

  test("набор берётся эталонный под номинал, а не «чего не хватает»", () => {
    expect(source).toMatch(/runStoredKey[\s\S]{0,900}createTargetsFor\(amount, !isSite\)/);
  });
});
