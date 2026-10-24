/** @jest-environment node */
jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/prisma", () => ({
  prisma: {
    wbCode: { findFirst: jest.fn() },
    wbOrder: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));
jest.mock("@/lib/vk-reach", () => ({ checkVkReachableFresh: jest.fn() }));

import { prisma } from "@/lib/prisma";
import { checkVkReachableFresh } from "@/lib/vk-reach";
import { GET } from "@/app/api/wb-code/route";

// Шаг «нажми «Начать»» на странице инструкции держится на этом поле.
// Ошибка в сторону «true» запирает покупателя, в сторону «false» — снова
// оставляет его без уведомлений (37 таких за месяц до 11.10.2026).
const db = prisma as unknown as {
  wbCode: { findFirst: jest.Mock };
  wbOrder: { findFirst: jest.Mock };
  user: { findUnique: jest.Mock };
};
const reach = checkVkReachableFresh as jest.Mock;

let ip = 0;
async function status(): Promise<Record<string, unknown>> {
  ip += 1;
  const res = await GET(new Request("https://robloxbank.ru/api/wb-code?code=ABC1234", {
    headers: { "x-forwarded-for": `10.0.0.${ip}` },
  }));
  return res.json();
}

beforeEach(() => {
  jest.clearAllMocks();
  db.wbCode.findFirst.mockResolvedValue({ status: "CLAIMED", userId: "u1", denomination: 1000 });
  db.wbOrder.findFirst.mockResolvedValue({ platform: "VK", status: "AWAITING_GAMEPASS", robloxUsername: null });
  db.user.findUnique.mockResolvedValue({ tgId: null, vkId: "7166316" });
});

describe("needsVkMessages", () => {
  it("VK-покупатель без разрешения на сообщения — держим на шаге", async () => {
    reach.mockResolvedValue(false);
    expect((await status()).needsVkMessages).toBe(true);
    expect(reach).toHaveBeenCalledWith("7166316");
  });

  it("написал боту — пускаем к инструкции", async () => {
    reach.mockResolvedValue(true);
    expect((await status()).needsVkMessages).toBe(false);
  });

  it("VK не ответил — не запираем по сбою", async () => {
    reach.mockResolvedValue(null);
    expect((await status()).needsVkMessages).toBe(false);
  });

  it("есть Telegram — VK не спрашиваем", async () => {
    db.user.findUnique.mockResolvedValue({ tgId: "1", vkId: "7166316" });
    expect((await status()).needsVkMessages).toBe(false);
    expect(reach).not.toHaveBeenCalled();
  });

  it("заказ уже выполнен — писать больше нечего, шаг не нужен", async () => {
    db.wbOrder.findFirst.mockResolvedValue({ platform: "VK", status: "COMPLETED", robloxUsername: "x" });
    expect((await status()).needsVkMessages).toBe(false);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("код ещё не забран — шага нет", async () => {
    db.wbCode.findFirst.mockResolvedValue({ status: "AVAILABLE", userId: null, denomination: 1000 });
    const body = await status();
    expect(body.claimed).toBe(false);
    expect(body.needsVkMessages).toBe(false);
  });
});
