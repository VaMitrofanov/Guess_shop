"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type React from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export default function BottomSheet({
  open,
  onClose,
  ariaLabel,
  children,
  footer,
  className = "",
  expandable = false,
  expanded = false,
  onExpandedChange,
}: {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  expandable?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  /* Последний `onClose` — через ref, а сам эффект зависит ТОЛЬКО от `open`.
   *
   * Потребители передают инлайновую стрелку (`onClose={() => setX(null)}`), то
   * есть новую функцию на каждый рендер. Пока эффект зависел от `onClose`, он
   * на каждом рендере разбирался и собирался заново — а в его уборке стоит
   * `returnFocusRef.current?.focus()`. В шторке-просмотре это было незаметно:
   * она перерисовывается редко. В шторке с формой рендер идёт на КАЖДОЕ нажатие
   * клавиши, поэтому каждый введённый символ выбивал фокус из поля, ронял
   * клавиатуру и мигал кнопкой «назад» Telegram. Ref разрывает эту связь и
   * оставляет ловушку фокуса, BackButton и блокировку скролла собранными один
   * раз на открытие. */
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return;

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const telegramBack = window.Telegram?.WebApp?.BackButton;
    const close = () => onCloseRef.current();
    telegramBack?.show();
    telegramBack?.onClick(close);

    // preventScroll: фокус на самой шторке не должен двигать прокрутку — без
    // него браузер «доводил» шторку в видимую область и экран дёргался при открытии.
    const frame = window.requestAnimationFrame(() => sheetRef.current?.focus({ preventScroll: true }));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const controls = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(element => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
      if (!controls.length) {
        event.preventDefault();
        sheetRef.current.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      telegramBack?.offClick(close);
      telegramBack?.hide();
      returnFocusRef.current?.focus();
    };
  }, [open]);

  /* Раскрытие жестом. Шторка-просмотр растёт тремя путями: свайп по ручке
   * вверх, прокрутка содержимого (первый же сдвиг вниз по списку = «хочу
   * дальше») и тап по ручке. Свайп вниз по ручке сворачивает, а из свёрнутой —
   * закрывает. Порог 36 px: короче — это дрожание пальца при тапе. */
  const dragStart = useRef<number | null>(null);
  const onHandleTouchStart = (event: React.TouchEvent) => { dragStart.current = event.touches[0]?.clientY ?? null; };
  const onHandleTouchEnd = (event: React.TouchEvent) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (start == null || !expandable) return;
    const dy = (event.changedTouches[0]?.clientY ?? start) - start;
    if (dy < -36 && !expanded) onExpandedChange?.(true);
    else if (dy > 36) { if (expanded) onExpandedChange?.(false); else onClose(); }
  };
  /* Сразу после сворачивания содержимое ещё доезжает до верха — эти кадры
   * прокрутки не должны раскрывать шторку обратно. */
  const collapsedAt = useRef(0);
  useEffect(() => { if (!expanded) collapsedAt.current = Date.now(); }, [expanded]);
  /* Раскрывает только палец. Прокрутку запускает и iOS сам — когда доводит до
   * поля при фокусе; раньше это раскрывало шторку, её высота анимировалась, и
   * поле «улетало» из-под пальца (жалоба владельца 11.11.2026). Окно 900 мс
   * покрывает инерцию после отпускания. */
  const lastTouchAt = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    // Вбок шторка не ездит никогда: даже если что-то внутри шире, iOS при
    // фокусе прокручивал контейнер по X, и картинка уезжала влево.
    if (el.scrollLeft !== 0) el.scrollLeft = 0;
    if (!expandable || expanded || Date.now() - collapsedAt.current < 600) return;
    if (Date.now() - lastTouchAt.current > 900) return;
    if (el.scrollTop > 12) onExpandedChange?.(true);
  };

  /* Поле в фокусе держим в центре видимой части шторки. iOS доводит до поля
   * сам, но по высоте ДО того, как клавиатура и шторка доедут (шторка
   * уменьшается вместе с visualViewport, переход 0,25 с), — и поле оказывалось
   * под клавиатурой или у края. Выравниваем после того, как всё встало. */
  useEffect(() => {
    if (!open) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const timers: number[] = [];
    let target: HTMLElement | null = null;
    const center = () => {
      if (!target || document.activeElement !== target || !scroller.contains(target)) return;
      const box = scroller.getBoundingClientRect();
      const field = target.getBoundingClientRect();
      const visibleBottom = Math.min(box.bottom, window.visualViewport ? window.visualViewport.height + window.visualViewport.offsetTop : box.bottom);
      const mid = box.top + (visibleBottom - box.top) / 2;
      const delta = field.top + field.height / 2 - mid;
      if (Math.abs(delta) > 8) scroller.scrollTo({ top: scroller.scrollTop + delta, left: 0, behavior: "smooth" });
    };
    const schedule = () => {
      timers.splice(0).forEach(window.clearTimeout);
      // Клавиатура и переход высоты шторки (0,25 с) — выравниваем, когда доедут.
      timers.push(window.setTimeout(center, 120), window.setTimeout(center, 380));
    };
    const onFocusIn = (event: FocusEvent) => {
      const el = event.target as HTMLElement | null;
      if (!el || !el.matches("input, textarea, select, [contenteditable='true']")) return;
      target = el;
      schedule();
    };
    const onFocusOut = () => { target = null; };
    scroller.addEventListener("focusin", onFocusIn);
    scroller.addEventListener("focusout", onFocusOut);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      timers.forEach(window.clearTimeout);
      scroller.removeEventListener("focusin", onFocusIn);
      scroller.removeEventListener("focusout", onFocusOut);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [open]);

  /* Тянуть вниз за само содержимое, когда оно у верха: развёрнутая шторка
   * сворачивается, свёрнутая закрывается. Раньше вернуться можно было только
   * мелкой стрелкой, а жест сверху уводил весь Telegram (вертикальные свайпы
   * Telegram теперь выключены в TwaApp). Пока палец тянет, шторка едет за ним. */
  const pull = useRef<{ y: number; atTop: boolean; dy: number } | null>(null);
  const onBodyTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    lastTouchAt.current = Date.now();
    pull.current = { y: event.touches[0]?.clientY ?? 0, atTop: event.currentTarget.scrollTop <= 0, dy: 0 };
  };
  const onBodyTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    lastTouchAt.current = Date.now();
    const p = pull.current;
    if (!p || !p.atTop || !sheetRef.current) return;
    p.dy = (event.touches[0]?.clientY ?? p.y) - p.y;
    if (p.dy > 0 && event.currentTarget.scrollTop <= 0) {
      sheetRef.current.style.transition = "none";
      sheetRef.current.style.transform = `translateY(${Math.min(p.dy * 0.55, 160)}px)`;
    }
  };
  const onBodyTouchEnd = () => {
    lastTouchAt.current = Date.now();
    const p = pull.current;
    pull.current = null;
    const sheet = sheetRef.current;
    if (sheet) {
      sheet.style.transition = "";
      sheet.style.transform = "";
    }
    if (!p || !p.atTop || p.dy < 70) return;
    if (expandable && expanded) onExpandedChange?.(false);
    else onClose();
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="twa-sheet-layer" role="presentation" onClick={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={sheetRef}
        className={`twa-sheet${expanded ? " is-expanded" : ""}${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        <div className="twa-sheet-handle-zone" onTouchStart={onHandleTouchStart} onTouchEnd={onHandleTouchEnd}>
          <button
            type="button"
            className="twa-sheet-handle"
            aria-label={expandable ? (expanded ? "Свернуть карточку" : "Развернуть карточку") : "Закрыть карточку"}
            onClick={() => expandable ? onExpandedChange?.(!expanded) : onClose()}
          />
        </div>
        <div
          ref={scrollRef}
          className="twa-sheet-scroll"
          onScroll={onScroll}
          onTouchStart={onBodyTouchStart}
          onTouchMove={onBodyTouchMove}
          onTouchEnd={onBodyTouchEnd}
          onTouchCancel={onBodyTouchEnd}
        >
          {children}
        </div>
        {footer && <div className="twa-sheet-footer">{footer}</div>}
      </section>
    </div>,
    document.body,
  );
}
