"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";

const ENDPOINT = "/api/observability/client";
const sentInMemory = new Set<string>();

function route() {
  return window.location.pathname.replace(/[^A-Za-z0-9_\-./]/g, "").slice(0, 160) || "/";
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

export function SiteObservability() {
  // A stable callback is required by Next.js to avoid duplicate metric reports.
  useReportWebVitals(reportWebVital);

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
