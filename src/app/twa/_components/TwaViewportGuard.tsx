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
    // Последние записанные значения. Нужны, чтобы не перезаписывать переменные
    // из-за дрожания в пару пикселей.
    let lastInset = -1;
    let lastHeight = -1;
    // Мерить ли в ближайшем кадре высоту (панорама её не меняет — см. ниже).
    let heightPending = false;

    root.classList.add(ACTIVE_CLASS);
    body.classList.add(ACTIVE_CLASS);

    const measure = () => {
      animationFrame = 0;

      /* Высота визуального окна. Ею заданы `height` всего стеклянного корпуса и
         `max-height` шторки, на которой висит `transition: max-height` — то есть
         КАЖДАЯ запись перезапускает анимацию геометрии поверх слоёв с блюром.
         31.08.2026: на 10 символов приходилось 10 записей, и набор в форме
         заказа «лагал и вылетал». Порог в 2 px глушит субпиксельное дрожание
         iOS и пропускает то, ради чего переменная заведена: клавиатуру и
         телеграмовскую шапку. Заниженная на пару пикселей высота не видна —
         под корпусом тот же фон. */
      if (heightPending) {
        heightPending = false;
        const height = visualViewport?.height ?? window.innerHeight;
        if (Number.isFinite(height) && height > 0) {
          // Round up so fractional device pixels cannot reveal a one-pixel strip.
          const rounded = Math.ceil(height);
          if (lastHeight < 0 || Math.abs(rounded - lastHeight) > 2) {
            lastHeight = rounded;
            root.style.setProperty("--twa-visual-height", `${rounded}px`);
          }
        }
      }

      /* Сколько снизу занимает клавиатура.
         `position: fixed` считается от МАКЕТНОГО окна, а клавиатура ужимает
         только визуальное — поэтому шторка, прижатая к низу, уезжает под
         клавиатуру, и экран «дёргается». Разница двух окон и есть высота
         клавиатуры; ею подпирается нижний отступ слоя со шторкой. */
      const layout = window.innerHeight;
      const raw = visualViewport
        ? Math.max(0, Math.round(layout - visualViewport.height - visualViewport.offsetTop))
        : 0;
      // Мелкие расхождения на 1–2 px бывают и без клавиатуры — не двигаем из-за них.
      const inset = raw > 24 ? raw : 0;
      /* Пишем, только когда отступ реально изменился.
         `visualViewport.scroll` срабатывает и на микро-панораме во время
         набора текста, а на слое со шторкой висит `transition: padding-bottom`
         — от каждой перезаписи он дёргался бы заново. Порог в 8 px пропускает
         появление и скрытие клавиатуры и глушит дрожание. */
      if (lastInset < 0 || Math.abs(inset - lastInset) > 8) {
        lastInset = inset;
        root.style.setProperty("--twa-keyboard-inset", `${inset}px`);
      }
    };

    /** `withHeight: false` — панорама: сдвиг окна, а не смена его высоты. */
    const syncViewport = (withHeight = true) => {
      if (withHeight) heightPending = true;
      if (animationFrame) return;
      animationFrame = requestAnimationFrame(measure);
    };

    // Панорама во время набора меняет только `offsetTop`, а не высоту окна:
    // мерить высоту на каждый `scroll` не нужно, а вредно — см. `measure`.
    const syncOffsetOnly = () => syncViewport(false);

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
    visualViewport?.addEventListener("scroll", syncOffsetOnly);
    window.addEventListener("resize", scheduleSettle);
    window.addEventListener("orientationchange", scheduleSettle);
    document.addEventListener("focusin", scheduleSettle);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      cancelAnimationFrame(animationFrame);
      settleTimers.forEach(timer => window.clearTimeout(timer));
      visualViewport?.removeEventListener("resize", scheduleSettle);
      visualViewport?.removeEventListener("scroll", syncOffsetOnly);
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
