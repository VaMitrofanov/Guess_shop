import { NextRequest } from "next/server";

/**
 * Ключ для геймпассов в личном кабинете.
 *
 * Что здесь нельзя сломать молча:
 *   • **Ключ не выходит наружу.** Ни в ответе роута, ни в уведомлении админам.
 *     Утечка обнаруживается не падением теста, а через месяц.
 *   • **«Принят» значит принят.** Ключ сохраняется только после успешной
 *     проверки; неудачные попытки в базе не оседают.
 *   • **Не сохранили — не врём.** Без ключа шифрования ответ отрицательный:
 *     покупатель ждёт, что в следующий заказ делать ничего не придётся.
 *   • **Чужой ключ не удалить.** Удаление всегда ограничено своим userId.
 */

const mockAuth = jest.fn();
const mockVerify = jest.fn();
const mockFlag = jest.fn();
const mockRemember = jest.fn();
const mockList = jest.fn();
const mockForget = jest.fn();
const mockSend = jest.fn();
const mockUserFind = jest.fn();
const mockOrderCount = jest.fn();

jest.mock("@/auth", () => ({ auth: () => mockAuth() }));
jest.mock("@/lib/roblox-gamepass-create", () => ({
  verifyGamePassKeyViaBridge: (...args: unknown[]) => mockVerify(...args),
}));
jest.mock("@/lib/gamepass-autocreate-flag", () => ({
  gamepassAutocreateEnabled: () => mockFlag(),
}));
jest.mock("@/lib/roblox-api-key-store", () => ({
  rememberRobloxApiKey: (...args: unknown[]) => mockRemember(...args),
  listRobloxApiKeys: (...args: unknown[]) => mockList(...args),
  forgetRobloxApiKey: (...args: unknown[]) => mockForget(...args),
}));
jest.mock("@/lib/telegram", () => ({
  sendTelegramMessageId: (...args: unknown[]) => mockSend(...args),
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockUserFind(...args) },
    wbOrder: { count: (...args: unknown[]) => mockOrderCount(...args) },
  },
}));

import { DELETE, POST } from "@/app/api/account/roblox-key/route";

const KEY = "Oc567XuPVUmyo8yc0PP27WLic2c3NZcAhUStwG1vt9m8+PhA";
const realEnv = process.env;

function req(body: unknown, ip = "10.0.0.7", method: "POST" | "DELETE" = "POST") {
  return new NextRequest("https://robloxbank.ru/api/account/roblox-key", {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

const linkedRow = {
  id: "key_1",
  robloxUsername: "lokomotiv_2018",
  createdAt: new Date("2026-09-07T10:00:00Z"),
  lastUsedAt: null,
  createdPasses: 0,
};

beforeEach(() => {
  process.env = { ...realEnv, TG_TOKEN: "tok", ADMIN_IDS: "1,2" };
  mockAuth.mockReset().mockResolvedValue({ user: { id: "user_1" } });
  mockFlag.mockReset().mockReturnValue(true);
  mockVerify.mockReset().mockResolvedValue({
    ok: true,
    universeId: "77",
    username: "Lokomotiv_2018",
    account: { id: "1", name: "Lokomotiv_2018", displayName: "Локо", avatarUrl: "https://tr.rbxcdn.com/x" },
  });
  mockRemember.mockReset().mockResolvedValue("saved");
  mockList.mockReset().mockResolvedValue([linkedRow]);
  mockForget.mockReset().mockResolvedValue(true);
  mockSend.mockReset().mockResolvedValue(1);
  mockUserFind.mockReset().mockResolvedValue({ name: "Вадим", username: "guess", vkId: null, tgId: "5", email: null });
  mockOrderCount.mockReset().mockResolvedValue(3);
});
afterAll(() => { process.env = realEnv; });

describe("POST /api/account/roblox-key", () => {
  test("гость — 401, до Roblox не доходим", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(req({ key: KEY, username: "lokomotiv_2018" }));
    expect(res.status).toBe(401);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test("выключенный флаг — метода нет (404), а не тихое бездействие", async () => {
    mockFlag.mockReturnValue(false);
    const res = await POST(req({ key: KEY, username: "lokomotiv_2018" }));
    expect(res.status).toBe(404);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test("успех: ключ сохранён, наружу — только метаданные", async () => {
    const res = await POST(req({ key: KEY, username: "lokomotiv_2018" }));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.keys[0]).toMatchObject({ username: "lokomotiv_2018", createdPasses: 0 });
    expect(JSON.stringify(body)).not.toContain(KEY);
    // Сохраняется КАНОНИЧЕСКИЙ ник от Roblox, а не то, что напечатали: по нему
    // потом ищется сохранённый ключ на заказе, и регистр не должен разъехаться.
    expect(mockRemember).toHaveBeenCalledWith(expect.objectContaining({
      key: KEY, robloxUsername: "Lokomotiv_2018", userId: "user_1", result: "verified",
    }));
  });

  test("в ответ уходит аккаунт с аватаром — покупатель видит, что привязал ТОТ", () => {
    return POST(req({ key: KEY, username: "lokomotiv_2018" }, "10.0.0.14"))
      .then((res) => res.json())
      .then((body) => {
        expect(body.account).toMatchObject({ name: "Lokomotiv_2018", avatarUrl: "https://tr.rbxcdn.com/x" });
      });
  });

  test("уведомление админам уходит и НЕ содержит ключа", async () => {
    await POST(req({ key: KEY, username: "lokomotiv_2018" }));
    // Уведомление не блокирует ответ — даём микрозадачам добежать.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSend).toHaveBeenCalledTimes(2); // два админа
    const text = String(mockSend.mock.calls[0][2]);
    expect(text).toContain("привязал ключ");
    // Ник в уведомлении — канонический от Roblox, тот же, что сохранён.
    expect(text).toContain("Lokomotiv_2018");
    expect(text).not.toContain(KEY);
  });

  test("ключ не принят Roblox — не сохраняем и не уведомляем", async () => {
    mockVerify.mockResolvedValue({ ok: false, error: "bad_scope_write" });
    const res = await POST(req({ key: KEY, username: "lokomotiv_2018" }, "10.0.0.8"));
    const body = await res.json();

    expect(body).toEqual({ ok: false, error: "bad_scope_write" });
    expect(mockRemember).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("хранилище не готово — честный отказ, а не «сохранили»", async () => {
    mockRemember.mockResolvedValue("skipped");
    const res = await POST(req({ key: KEY, username: "lokomotiv_2018" }, "10.0.0.9"));
    expect(await res.json()).toEqual({ ok: false, error: "storage" });
  });

  test("мусор вместо ключа отсекается без похода в Roblox", async () => {
    const res = await POST(req({ key: "привет", username: "lokomotiv_2018" }, "10.0.0.10"));
    expect(await res.json()).toEqual({ ok: false, error: "bad_key" });
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test("без ника проверять нечего — опыт не найти", async () => {
    const res = await POST(req({ key: KEY, username: "!!" }, "10.0.0.11"));
    expect(await res.json()).toEqual({ ok: false, error: "no_universe" });
    expect(mockVerify).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/account/roblox-key", () => {
  test("удаление всегда ограничено своим userId", async () => {
    mockList.mockResolvedValue([]);
    const res = await DELETE(req({ id: "key_1" }, "10.0.0.12", "DELETE"));
    expect(res.status).toBe(200);
    expect(mockForget).toHaveBeenCalledWith("user_1", "key_1");
  });

  test("чужой id — 404", async () => {
    mockForget.mockResolvedValue(false);
    const res = await DELETE(req({ id: "key_чужой" }, "10.0.0.13", "DELETE"));
    expect(res.status).toBe(404);
  });
});
