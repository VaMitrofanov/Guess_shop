const syncVerifiedBotUser = jest.fn();
const vkGetProfile = jest.fn();

jest.mock("../db", () => ({
  syncVerifiedBotUser: (...args: unknown[]) => syncVerifiedBotUser(...args),
}));
jest.mock("../notify", () => ({
  vkGetProfile: (...args: unknown[]) => vkGetProfile(...args),
}));

import { syncTelegramActor, syncVkActor } from "../user-profile-sync";

beforeEach(() => {
  syncVerifiedBotUser.mockReset().mockResolvedValue({ id: "user-1" });
  vkGetProfile.mockReset();
});

it("persists Telegram actor fields as provider-verified profile data", async () => {
  await syncTelegramActor({
    id: 900001,
    first_name: "Иван",
    last_name: "Клиент",
    username: "client_tg",
    language_code: "ru",
    is_premium: true,
  });

  expect(syncVerifiedBotUser).toHaveBeenCalledWith("TG", 900001, {
    name: "Иван Клиент",
    username: "client_tg",
    metadata: { languageCode: "ru", isPremium: true },
  });
});

it("persists VK screen name, avatar and account state from users.get", async () => {
  vkGetProfile.mockResolvedValue({
    name: "Мария Клиент",
    username: "maria_vk",
    image: "https://example.test/avatar.jpg",
    deactivated: null,
    isClosed: true,
  });

  await syncVkActor(900002);

  expect(vkGetProfile).toHaveBeenCalledWith(900002);
  expect(syncVerifiedBotUser).toHaveBeenCalledWith("VK", 900002, {
    name: "Мария Клиент",
    username: "maria_vk",
    image: "https://example.test/avatar.jpg",
    metadata: {
      deactivated: null,
      isClosed: true,
      providerProfileAvailable: true,
    },
  });
});

it("does not invent VK names when the provider API is unavailable", async () => {
  vkGetProfile.mockResolvedValue(null);

  await syncVkActor(900003);

  expect(syncVerifiedBotUser).toHaveBeenCalledWith("VK", 900003, {
    name: undefined,
    username: undefined,
    image: undefined,
    metadata: {
      deactivated: undefined,
      isClosed: undefined,
      providerProfileAvailable: false,
    },
  });
});

it("throttles repeated profile synchronization for the same actor", async () => {
  await syncTelegramActor({ id: 900004, first_name: "Первый" });
  await syncTelegramActor({ id: 900004, first_name: "Второй" });

  expect(syncVerifiedBotUser).toHaveBeenCalledTimes(1);
});
