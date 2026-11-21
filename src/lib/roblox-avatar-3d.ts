import "server-only";

import { sendTelegramMessage } from "@/lib/telegram";
import { adminTargets } from "../../bots/shared/admin-route";
import { formatAdminNotice } from "../../bots/shared/notify-format";

/* 🧊 3D-персонаж в кабинете (19.11.2026, подготовка под служебную cookie).

   `thumbnails.roblox.com/v1/users/avatar-3d` с 2025 года отвечает только
   залогиненной сессии (без неё 403 «Invalid authentication data»). Сессия —
   ОТДЕЛЬНЫЙ пустой аккаунт владельца, не донорский (single egress, см.
   docs/security.md): `ROBLOX_AVATAR_COOKIE` в env Web, значение
   `.ROBLOSECURITY` с префиксом `_|WARNING…` или без.

   Сервер отдаёт браузеру только АДРЕС манифеста (JSON с камерой, рамкой и
   хешами obj/mtl/текстур). Сами файлы — на rbxcdn: с RF-хоста он не
   резолвится, браузер покупателя грузит их сам (CORS `*`). Сервер — только
   «ключ от двери».

   Cookie не вечна: её гасят смена пароля, «выйти везде», защита Roblox от
   угона (в том числе смена страны). Умерла — 3D молча выключается (кабинет
   показывает 2D), админам раз в 12 часов уходит алерт в «Систему». */

export type Avatar3dResult =
  | { status: "ready"; manifestUrl: string }
  | { status: "pending" }
  | { status: "off" };

const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const ALERT_EVERY_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; url: string }>();
let deadSince: number | null = null;
let lastAlertAt = 0;

/** Значение cookie из env или `null`. Принимает и `.ROBLOSECURITY=…`. */
export function avatarCookie(): string | null {
  const raw = (process.env.ROBLOX_AVATAR_COOKIE ?? "").trim();
  if (!raw) return null;
  const value = raw.replace(/^\.ROBLOSECURITY=/, "").replace(/;.*$/, "").trim();
  return value.length > 50 ? value : null;
}

/** Включён ли 3D: cookie задана и не признана мёртвой за последний час. */
export function avatar3dEnabled(now = Date.now()): boolean {
  if (!avatarCookie()) return false;
  // Мёртвую cookie перепроверяем раз в час — вдруг env поменяли без рестарта
  // (не бывает) или Roblox ответил отказом по ошибке (бывает).
  return deadSince === null || now - deadSince > TTL_MS;
}

/** Адрес манифеста 3D для игрока Roblox. Ошибки — `off`, страница не ждёт. */
export async function loadAvatar3d(robloxUserId: string | null | undefined): Promise<Avatar3dResult> {
  const cookie = avatarCookie();
  if (!cookie || !robloxUserId || !/^\d{1,20}$/.test(robloxUserId) || !avatar3dEnabled()) return { status: "off" };
  const hit = cache.get(robloxUserId);
  if (hit && Date.now() - hit.at < TTL_MS) return { status: "ready", manifestUrl: hit.url };
  try {
    const res = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-3d?userId=${robloxUserId}`, {
      headers: { accept: "application/json", cookie: `.ROBLOSECURITY=${cookie}` },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 401 || res.status === 403) {
      markDead(res.status);
      return { status: "off" };
    }
    if (!res.ok) return hit ? { status: "ready", manifestUrl: hit.url } : { status: "off" };
    deadSince = null;
    const body = (await res.json().catch(() => null)) as { state?: string; imageUrl?: string | null } | null;
    if (body?.state === "Pending") return { status: "pending" };
    const url = body?.state === "Completed" ? body.imageUrl : null;
    if (typeof url !== "string" || !/^https:\/\/[a-z0-9.-]+\.rbxcdn\.com\//i.test(url)) return { status: "off" };
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(robloxUserId, { at: Date.now(), url });
    return { status: "ready", manifestUrl: url };
  } catch {
    return hit ? { status: "ready", manifestUrl: hit.url } : { status: "off" };
  }
}

function markDead(status: number) {
  const now = Date.now();
  deadSince = now;
  console.warn(`[avatar-3d] Roblox отказал служебной сессии (${status}) — 3D выключен, кабинет показывает 2D`);
  if (now - lastAlertAt < ALERT_EVERY_MS) return;
  lastAlertAt = now;
  void alertCookieDead(status).catch(() => undefined);
}

async function alertCookieDead(status: number) {
  const token = process.env.TG_TOKEN;
  const targets = await adminTargets("system", { loud: false });
  if (!token || targets.length === 0) return;
  const text = formatAdminNotice({
    marker: "action",
    zone: "САЙТ",
    title: "3D-персонаж выключен — служебная cookie Roblox умерла",
    lines: [
      `Roblox ответил ${status} на запрос 3D-модели. Кабинет показывает 2D, клиенты ничего не замечают.`,
      "Причины: смена пароля, «выйти везде», защита Roblox (новая страна/IP).",
    ],
    next: "зайти в служебный аккаунт, взять новую .ROBLOSECURITY → ROBLOX_AVATAR_COOKIE в Coolify (Web) → пересборка",
  });
  await Promise.allSettled(targets.map((t) => sendTelegramMessage(token, t.chatId, text, t.extra)));
}
