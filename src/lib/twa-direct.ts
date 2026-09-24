/* ─────────────────────────────────────────────────────────────────────────────
   twa-direct.ts — обработка заявок прямых заказов (DirectIntent) из TWA.

   Зеркало TG-хендлеров sqi:/spi:/cai: (bots/tg/handlers.ts) — тексты клиенту и
   переходы статусов идентичны, чтобы для покупателя не было разницы, откуда
   менеджер нажал кнопку: из TG-карточки или из TWA.

   Отправка:
   - TG — через мост (VALIDATOR_SOURCE_URL → /tg-proxy, как twa-notify): фото
     передаётся HTTPS-ссылкой на /api/sbp-qr?t=<HMAC> (Telegram скачает сам);
     мост авто-детектит sendPhoto по полю `photo`.
   - VK — прямой upload-флоу (photos.getMessagesUploadServer → upload → save →
     messages.send), порт vkSendPhoto из bots/shared/notify.ts.

   Приём скриншота оплаты после этого работает без участия ботовской памяти:
   TG-бот имеет DB-fallback (userId + PAYMENT_PENDING), VK-роутинг целиком
   DB-driven (PAYMENT_PENDING + isDirectOrder).
   ───────────────────────────────────────────────────────────────────────── */
import { prisma } from "@/lib/prisma";
import { createHmac } from "crypto";

export interface IntentUserRef {
  id: string;
  tgId?: string | null;
  vkId?: string | null;
}

/* ── СБП-QR ─────────────────────────────────────────────────────────────── */

/** Стабильный токен ссылки /api/sbp-qr?t=… — HMAC от секрета, без слота в БД. */
export function sbpQrToken(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "";
  return createHmac("sha256", secret).update("sbp-qr-v1").digest("hex").slice(0, 32);
}

export function sbpQrUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru").replace(/\/$/, "");
  return `${base}/api/sbp-qr?t=${sbpQrToken()}`;
}

/** QR из GlobalSettings.sbpQrBase64 (та же колонка, что читают боты). */
export async function getSbpQrBuffer(): Promise<Buffer | null> {
  try {
    const settings = await (prisma as any).globalSettings.findUnique({
      where: { id: "global" },
      select: { sbpQrBase64: true },
    });
    const b64 = settings?.sbpQrBase64;
    return b64 ? Buffer.from(b64, "base64") : null;
  } catch (e: any) {
    console.warn("[twa-direct] getSbpQrBuffer:", e?.message);
    return null;
  }
}

/* ── Низкоуровневая отправка (зеркало twa-notify, + фото) ───────────────── */

async function tgApi(payload: Record<string, unknown>): Promise<boolean> {
  const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
  const body = { token: process.env.TG_TOKEN, parse_mode: "HTML", ...payload };
  if (bridgeUrl) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.VALIDATOR_KEY) headers["x-validator-key"] = process.env.VALIDATOR_KEY;
    try {
      const r = await fetch(`${bridgeUrl}/tg-proxy`, { method: "POST", headers, body: JSON.stringify(body) });
      const j: any = await r.json().catch(() => null);
      return r.ok && j?.ok !== false;
    } catch (e: any) {
      console.warn("[twa-direct] tg bridge error:", e?.message);
      return false;
    }
  }
  const method = payload.photo ? "sendPhoto" : "sendMessage";
  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j: any = await r.json().catch(() => null);
    if (j?.ok !== true) console.warn("[twa-direct] tg send failed:", j?.description ?? r.status);
    return j?.ok === true;
  } catch (e: any) {
    console.warn("[twa-direct] tg direct error:", e?.message);
    return false;
  }
}

async function vkText(vkUserId: string, message: string): Promise<boolean> {
  const params = new URLSearchParams({
    user_id: vkUserId,
    message,
    random_id: String(Date.now() + Math.floor(Math.random() * 1000)),
    access_token: process.env.VK_TOKEN ?? "",
    v: "5.131",
  });
  try {
    const r = await fetch("https://api.vk.com/method/messages.send", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const j: any = await r.json().catch(() => null);
    if (j?.error) { console.warn("[twa-direct] vk error:", j.error.error_msg); return false; }
    return j?.response !== undefined;
  } catch (e: any) {
    console.warn("[twa-direct] vk error:", e?.message);
    return false;
  }
}

/** VK-фото сырыми байтами — порт vkSendPhoto из bots/shared/notify.ts. */
async function vkPhoto(vkUserId: string, photo: Buffer, caption: string): Promise<boolean> {
  const token = process.env.VK_TOKEN ?? "";
  const v = "5.131";
  const api = (m: string) => `https://api.vk.com/method/${m}`;
  try {
    const srvRes = await fetch(`${api("photos.getMessagesUploadServer")}?peer_id=${vkUserId}&access_token=${token}&v=${v}`);
    const srv = (await srvRes.json()) as any;
    const uploadUrl = srv?.response?.upload_url;
    if (!uploadUrl) throw new Error("no upload_url: " + JSON.stringify(srv?.error ?? srv));

    const fd = new FormData();
    fd.append("photo", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "qr.jpg");
    const upRes = await fetch(uploadUrl, { method: "POST", body: fd });
    const up = (await upRes.json()) as any;
    if (!up?.photo) throw new Error("upload failed: " + JSON.stringify(up));

    const saveRes = await fetch(api("photos.saveMessagesPhoto"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        server: String(up.server), photo: up.photo, hash: up.hash,
        access_token: token, v,
      }).toString(),
    });
    const saved = (await saveRes.json()) as any;
    const ph = saved?.response?.[0];
    if (!ph) throw new Error("save failed: " + JSON.stringify(saved));

    await fetch(api("messages.send"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        user_id: vkUserId,
        message: caption,
        attachment: `photo${ph.owner_id}_${ph.id}`,
        random_id: String(Date.now() + Math.floor(Math.random() * 1000)),
        access_token: token, v,
      }).toString(),
    });
    return true;
  } catch (e: any) {
    console.warn("[twa-direct] vkPhoto error:", e?.message);
    return false;
  }
}

/* ── Клиентские сообщения (тексты = ботовским, sqi:/spi:/cai:) ──────────── */

const statusKb = { inline_keyboard: [[{ text: "📊 Проверить статус", callback_data: "refresh_status" }]] };

/** СБП-QR + сумма. Возвращает канал реальной доставки. */
export async function sendSbpQrToUser(
  user: IntentUserRef,
  totalAmount: number,
  rublePrice: number,
): Promise<"tg" | "vk" | null> {
  if (user.tgId) {
    const ok = await tgApi({
      chat_id: user.tgId,
      photo: sbpQrUrl(),
      caption:
        `💳 <b>Оплата заказа на ${totalAmount} R$</b>\n\n` +
        `Сумма к оплате: <b>${rublePrice} ₽</b>\n` +
        `Отсканируй QR в приложении банка (по СБП) и переведи <b>точную сумму</b>.\n\n` +
        `После перевода пришли сюда <b>скриншот или чек об оплате</b> (фотографией, не файлом) 👇`,
      reply_markup: statusKb,
    });
    return ok ? "tg" : null;
  }
  if (user.vkId) {
    const qr = await getSbpQrBuffer();
    if (!qr) return null;
    const ok = await vkPhoto(
      user.vkId, qr,
      `💳 Оплата заказа на ${totalAmount} R$\n\n` +
      `Сумма к оплате: ${rublePrice} ₽\n` +
      `Отсканируй QR в приложении банка (по СБП) и переведи точную сумму.\n\n` +
      `После перевода пришли сюда скриншот или чек об оплате (фотографией, не файлом) 👇`,
    );
    return ok ? "vk" : null;
  }
  return null;
}

/** Реквизиты текстом. Возвращает канал реальной доставки. */
export async function sendPaymentDetailsToUser(
  user: IntentUserRef,
  amount: number,
  details: string,
): Promise<"tg" | "vk" | null> {
  if (user.tgId) {
    const esc = details.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ok = await tgApi({
      chat_id: user.tgId,
      text:
        `💳 <b>Реквизиты для оплаты заказа на ${amount} R$:</b>\n\n` +
        `<code>${esc}</code>\n\n` +
        `Переведи деньги и пришли скриншот подтверждения сюда (фотографией, не файлом) 👇`,
      reply_markup: statusKb,
    });
    return ok ? "tg" : null;
  }
  if (user.vkId) {
    const ok = await vkText(
      user.vkId,
      `💳 Реквизиты для оплаты заказа на ${amount} R$:\n\n` +
      `${details}\n\n` +
      `Переведи деньги и пришли скриншот подтверждения сюда (фотографией, не файлом) 👇`,
    );
    return ok ? "vk" : null;
  }
  return null;
}

/** «Заявка отклонена» (текст = TG cai:). */
export async function notifyIntentRejected(user: IntentUserRef): Promise<"tg" | "vk" | null> {
  if (user.tgId) {
    const ok = await tgApi({
      chat_id: user.tgId,
      text: `❌ <b>Заявка отклонена</b>\n\nМенеджер отклонил твою заявку. Попробуй оформить новую.`,
      reply_markup: { inline_keyboard: [[{ text: "💎 Заказать снова", callback_data: "start_direct" }]] },
    });
    return ok ? "tg" : null;
  }
  if (user.vkId) {
    const ok = await vkText(user.vkId, `❌ Заявка отклонена. Попробуй оформить новую.`);
    return ok ? "vk" : null;
  }
  return null;
}

/* ── Утилиты ────────────────────────────────────────────────────────────── */

/** DIR-код заказа — формат ботов (bots/shared/admin.ts generateDirectCode). */
export function generateDirectCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "DIR-";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export const INTENT_TTL_MS = 24 * 60 * 60 * 1000;
