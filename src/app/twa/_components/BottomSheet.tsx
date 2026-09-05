"use client";

import { useEffect, useRef, type ReactNode } from "react";
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

    const frame = window.requestAnimationFrame(() => sheetRef.current?.focus());
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
        <div className="twa-sheet-handle-zone">
          <button
            type="button"
            className="twa-sheet-handle"
            aria-label={expandable ? (expanded ? "Свернуть карточку" : "Развернуть карточку") : "Закрыть карточку"}
            onClick={() => expandable ? onExpandedChange?.(!expanded) : onClose()}
          />
        </div>
        <div className="twa-sheet-scroll">{children}</div>
        {footer && <div className="twa-sheet-footer">{footer}</div>}
      </section>
    </div>,
    document.body,
  );
}
