"use client";

import { useEffect } from "react";

const ACTIVE_CLASS = "twa-route-active";
const EDITABLE_SELECTOR = "input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='file']), textarea, select, [contenteditable='true']";

/**
 * Keeps Telegram's iOS WebView stable while the software keyboard animates.
 *
 * Telegram's CSS viewport variable can settle a frame later than WebKit's
 * visual viewport. During that gap the document underneath the app used to
 * become visible, and WebKit could leave the page panned after an input lost
 * focus. This guard is event-driven: no timer or polling runs while idle.
 */
export default function TwaViewportGuard() {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const visualViewport = window.visualViewport;
    let animationFrame = 0;
    const settleTimers = new Set<number>();

    root.classList.add(ACTIVE_CLASS);
    body.classList.add(ACTIVE_CLASS);

    const syncViewport = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const height = visualViewport?.height ?? window.innerHeight;
        if (Number.isFinite(height) && height > 0) {
          // Round up so fractional device pixels cannot reveal a one-pixel strip.
          root.style.setProperty("--twa-visual-height", `${Math.ceil(height)}px`);
        }
        /* Сколько снизу занимает клавиатура.
           `position: fixed` считается от МАКЕТНОГО окна, а клавиатура ужимает
           только визуальное — поэтому шторка, прижатая к низу, уезжает под
           клавиатуру, и экран «дёргается». Разница двух окон и есть высота
           клавиатуры; ею подпирается нижний отступ слоя со шторкой. */
        const layout = window.innerHeight;
        const inset = visualViewport
          ? Math.max(0, Math.round(layout - visualViewport.height - visualViewport.offsetTop))
          : 0;
        // Мелкие расхождения на 1–2 px бывают и без клавиатуры — не двигаем из-за них.
        root.style.setProperty("--twa-keyboard-inset", `${inset > 24 ? inset : 0}px`);
      });
    };

    const scheduleSettle = () => {
      syncViewport();
      for (const delay of [80, 240]) {
        const timer = window.setTimeout(() => {
          settleTimers.delete(timer);
          syncViewport();
        }, delay);
        settleTimers.add(timer);
      }
    };

    const onFocusOut = () => {
      scheduleSettle();
      const timer = window.setTimeout(() => {
        settleTimers.delete(timer);
        const active = document.activeElement;
        if (!(active instanceof Element) || !active.matches(EDITABLE_SELECTOR)) {
          // iOS can retain a document-level pan after dismissing the keyboard.
          // The actual TWA scroll position lives in .twa-liquid-content.
          window.scrollTo(0, 0);
          syncViewport();
        }
      }, 260);
      settleTimers.add(timer);
    };

    syncViewport();
    visualViewport?.addEventListener("resize", scheduleSettle);
    visualViewport?.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", scheduleSettle);
    window.addEventListener("orientationchange", scheduleSettle);
    document.addEventListener("focusin", scheduleSettle);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      cancelAnimationFrame(animationFrame);
      settleTimers.forEach(timer => window.clearTimeout(timer));
      visualViewport?.removeEventListener("resize", scheduleSettle);
      visualViewport?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", scheduleSettle);
      window.removeEventListener("orientationchange", scheduleSettle);
      document.removeEventListener("focusin", scheduleSettle);
      document.removeEventListener("focusout", onFocusOut);
      root.classList.remove(ACTIVE_CLASS);
      body.classList.remove(ACTIVE_CLASS);
      root.style.removeProperty("--twa-visual-height");
      root.style.removeProperty("--twa-keyboard-inset");
    };
  }, []);

  return null;
}
