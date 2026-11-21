/**
 * HTTP 200 от WB на отправку в чат — ещё не доставка (разбор 27.09.2026:
 * гейт `5890328310` записан «отправлен», а в ленте WB его нет). Отказ WB
 * приходит в `errors` того же ответа и обязан стать ошибкой.
 */
import { sendBuyerChatMessage, WbDeliveryApiError } from "../wb-delivery-api";

const realFetch = global.fetch;

function respond(body: unknown) {
  global.fetch = jest.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as never;
}

beforeEach(() => {
  process.env.WB_CHAT_TOKEN = "test-token";
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

it("успех — result с addTime и пустой errors", async () => {
  respond({ result: { addTime: 1790527032246, chatID: "1:x", sign: "" }, errors: [] });
  await expect(sendBuyerChatMessage("sign", "текст")).resolves.toBeUndefined();
});

it("непустой errors при HTTP 200 — отказ, а не успех", async () => {
  respond({ result: null, errors: ["message rejected"] });
  const error = await sendBuyerChatMessage("sign", "текст").catch((e) => e);
  expect(error).toBeInstanceOf(WbDeliveryApiError);
  expect(error.providerCode).toBe("SEND_REJECTED");
});
