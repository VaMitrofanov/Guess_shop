"use client";

import { useEffect } from "react";

export function useVisiblePolling(callback: () => Promise<void>, intervalMs: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let running = false;
    let timer: number | undefined;

    const schedule = (delay = intervalMs) => {
      window.clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") timer = window.setTimeout(() => void tick(), delay);
    };
    const tick = async () => {
      if (stopped) return;
      if (running) {
        schedule(250);
        return;
      }
      if (document.visibilityState !== "visible") return;
      running = true;
      try {
        await callback();
      } finally {
        running = false;
        schedule();
      }
    };
    const resume = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible") schedule(0);
    };

    schedule();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [callback, enabled, intervalMs]);
}
