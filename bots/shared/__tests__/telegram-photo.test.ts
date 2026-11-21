/**
 * Фото из VK едет в Telegram байтами (разбор 27.09.2026): CDN VK за рубеж не
 * отдаёт, и Telegram не мог забрать ни одного скрина оплаты по ссылке.
 */
import { downloadPhoto, telegramRequestInit } from "../telegram-photo";

describe("telegramRequestInit", () => {
  it("без байтов — прежний JSON с parse_mode по умолчанию", () => {
    const init = telegramRequestInit({ chat_id: 1, text: "hi" });
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ parse_mode: "HTML", chat_id: 1, text: "hi" });
  });

  it("с photo_base64 — multipart: файл, кнопки JSON-строкой, без токена", async () => {
    const init = telegramRequestInit({
      chat_id: 42,
      photo_base64: Buffer.from("jpegbytes").toString("base64"),
      caption: "<b>оплата</b>",
      reply_markup: { inline_keyboard: [[{ text: "ok", callback_data: "x" }]] },
      reply_to_message_id: 7,
      token: "secret",
    });
    expect(init.headers).toBeUndefined();
    const form = init.body as FormData;
    expect(form.get("chat_id")).toBe("42");
    expect(form.get("parse_mode")).toBe("HTML");
    expect(form.get("reply_to_message_id")).toBe("7");
    expect(JSON.parse(String(form.get("reply_markup")))).toEqual({ inline_keyboard: [[{ text: "ok", callback_data: "x" }]] });
    expect(form.get("token")).toBeNull();
    expect(form.get("photo_base64")).toBeNull();
    const file = form.get("photo") as Blob;
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe("jpegbytes");
  });
});

describe("downloadPhoto", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it("не трогает file_id Telegram", async () => {
    global.fetch = jest.fn() as never;
    await expect(downloadPhoto("AgACAgIAAxkBAAI")).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("отдаёт байты картинки", async () => {
    global.fetch = jest.fn(async () => new Response(Buffer.from("img"), { headers: { "content-type": "image/jpeg" } })) as never;
    await expect(downloadPhoto("https://sun9-1.userapi.com/x.jpg")).resolves.toEqual(Buffer.from("img"));
  });

  it("null на не-картинку и на сетевую ошибку — вызывающий шлёт ссылку", async () => {
    global.fetch = jest.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } })) as never;
    await expect(downloadPhoto("https://x/y")).resolves.toBeNull();
    global.fetch = jest.fn(async () => { throw new Error("timeout"); }) as never;
    await expect(downloadPhoto("https://x/y")).resolves.toBeNull();
  });
});
