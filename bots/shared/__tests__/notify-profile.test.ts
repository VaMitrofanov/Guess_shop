import { vkGetName, vkGetProfile } from "../notify";

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.VK_TOKEN;
  jest.restoreAllMocks();
});

it("parses the current VK users.get profile fields", async () => {
  process.env.VK_TOKEN = "secret";
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      response: [{
        id: 42,
        first_name: "Мария",
        last_name: "Клиент",
        screen_name: "maria_vk",
        photo_100: "https://example.test/avatar.jpg",
        is_closed: true,
      }],
    }),
  });

  await expect(vkGetProfile(42)).resolves.toEqual({
    name: "Мария Клиент",
    username: "maria_vk",
    image: "https://example.test/avatar.jpg",
    deactivated: null,
    isClosed: true,
  });
  const request = (global.fetch as jest.Mock).mock.calls[0];
  expect(request[0]).toBe("https://api.vk.com/method/users.get");
  expect(String(request[1].body)).toContain("v=5.199");
  expect(String(request[1].body)).toContain("screen_name");
});

it("returns null profile on provider error and keeps the old name fallback contract", async () => {
  process.env.VK_TOKEN = "secret";
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ error: { error_code: 5 } }),
  });

  await expect(vkGetProfile(43)).resolves.toBeNull();
  await expect(vkGetName(43)).resolves.toBe("VK #43");
});
