"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";
import { usePathname } from "next/navigation";

const ENDPOINT = "/api/observability/client";
const sentInMemory = new Set<string>();

function route() {
  // Токен платёжной ссылки кода (`/pay/<токен>`) — доступ к оплате заказа,
  // в журналы он не уходит (14.11.2026).
  return window.location.pathname
    .replace(/^\/pay\/[^/]+/, "/pay/[token]")
    .replace(/[^A-Za-z0-9_\-./[\]]/g, "")
    .slice(0, 160) || "/";
}

function fingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function claimSignal(key: string): boolean {
  const storageKey = `rb-obsv:${fingerprint(key)}`;
  if (sentInMemory.has(storageKey)) return false;
  try {
    if (window.sessionStorage.getItem(storageKey)) return false;
    window.sessionStorage.setItem(storageKey, "1");
  } catch {
    // Private-mode/storage failures still get process-lifetime dedup below.
  }
  sentInMemory.add(storageKey);
  return true;
}

function send(payload: Record<string, unknown>, dedupeKey: string) {
  if (!claimSignal(dedupeKey)) return;
  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

const reportWebVital: Parameters<typeof useReportWebVitals>[0] = (metric) => {
  if (!["CLS", "FCP", "INP", "LCP", "TTFB"].includes(metric.name)) return;
  const currentRoute = route();
  send({
    type: "web-vital",
    route: currentRoute,
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
  }, `vital:${currentRoute}:${metric.name}:${metric.id}`);
};

/* 📊 Посещение (18.11.2026): устройство, встроенный браузер, источник. Без
   IP и без cookies: анонимный id — случайное число в localStorage. */
function deviceClass(): "phone" | "tablet" | "desktop" {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "tablet";
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return "phone";
  return "desktop";
}
function inApp(): "browser" | "telegram" | "vk" | "instagram" | "other" {
  const ua = navigator.userAgent;
  const w = window as unknown as Record<string, unknown>;
  if (/Telegram/i.test(ua) || "TelegramWebviewProxy" in w || "Telegram" in w) return "telegram";
  if (/VKAndroidApp|com\.vk\.|VKClient/i.test(ua)) return "vk";
  if (/Instagram/i.test(ua)) return "instagram";
  if (/; wv\)|FBAN|FBAV|Line\//i.test(ua)) return "other";
  return "browser";
}
function refClass(): "direct" | "wb" | "vk" | "telegram" | "yandex" | "google" | "internal" | "other" {
  if (/[?&]source=wb/.test(window.location.search) || /[?&]code=/.test(window.location.search)) return "wb";
  let host = "";
  try { host = document.referrer ? new URL(document.referrer).hostname : ""; } catch { host = ""; }
  if (!host) return "direct";
  if (host === window.location.hostname) return "internal";
  if (/wildberries|wb\.ru|wbbasket/.test(host)) return "wb";
  if (/(^|\.)vk\.(com|ru)$|vkontakte/.test(host)) return "vk";
  if (/t\.me$|telegram/.test(host)) return "telegram";
  if (/yandex|ya\.ru/.test(host)) return "yandex";
  if (/google/.test(host)) return "google";
  return "other";
}
function visitorId(): string {
  try {
    let id = localStorage.getItem("rb-visitor");
    if (!id) { id = Math.random().toString(16).slice(2, 10).padEnd(8, "0"); localStorage.setItem("rb-visitor", id); }
    return /^[a-f0-9]{8}$/.test(id) ? id : fingerprint(id);
  } catch { return fingerprint(navigator.userAgent + Date.now()); }
}

export function SiteObservability() {
  // A stable callback is required by Next.js to avoid duplicate metric reports.
  useReportWebVitals(reportWebVital);

  // 📊 Одно посещение на страницу за сессию (переходы внутри сайта — тоже).
  const pathname = usePathname();
  useEffect(() => {
    const currentRoute = route();
    if (currentRoute.startsWith("/admin") || currentRoute.startsWith("/twa")) return;
    send({ type: "visit", route: currentRoute, device: deviceClass(), app: inApp(), ref: refClass(), visitor: visitorId() }, `visit:${currentRoute}`);
  }, [pathname]);

  useEffect(() => {
    const report = (kind: string, source: string) => {
      const key = `${kind}:${fingerprint(source)}`;
      const currentRoute = route();
      send(
        { type: "client-error", route: currentRoute, kind, fingerprint: fingerprint(source) },
        `error:${currentRoute}:${key}`,
      );
    };
    // Keep the fingerprint stable across deploys: chunk filenames change on
    // every build and made one browser bug look like several unrelated errors.
    const onError = (event: ErrorEvent) => report(event.error?.name || "Error", event.message || "script-error");
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      report(reason instanceof Error ? reason.name : "UnhandledRejection", String(reason));
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
