"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   ⌘K со всех страниц админки (P1.4, 19.10.2026).

   Палитра жила только в рабочем месте заказов: с «Обзора» или с полной
   карточки заказа найти другой заказ можно было, лишь вернувшись в ленту.
   Здесь та же палитра (тот же поиск, те же срезы), но выбор ведёт в рабочее
   место. На самой странице `/admin/orders` палитру держит рабочее место —
   этот компонент лишь просит его открыть, чтобы не было двух окон сразу.
   ───────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import CommandPalette from "@/components/admin/orders/command-palette";
import ordersStyles from "@/components/admin/orders/orders.module.css";

/** Событие, которым кнопка просит рабочее место открыть свою палитру. */
export const OPEN_PALETTE_EVENT = "admin:open-palette";

export default function GlobalOrderSearch({ className }: { className?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const inWorkspace = pathname === "/admin/orders";

  const openPalette = useCallback(() => {
    if (inWorkspace) window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
    else setOpen(true);
  }, [inWorkspace]);

  useEffect(() => {
    if (inWorkspace) return;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(value => !value);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [inWorkspace]);

  return (
    <>
      <button type="button" className={className} onClick={openPalette} aria-keyshortcuts="Meta+K">
        <Search aria-hidden="true" size={15} />
        Найти заказ
        <kbd>⌘K</kbd>
      </button>
      {/* Портал: боковая панель на телефоне скрыта, а `fixed` внутри неё
          не вышел бы за её границы. */}
      {open && !inWorkspace && createPortal(
        <div className={ordersStyles.paletteScope}>
          <CommandPalette
            slice="BUYOUT"
            cursorOrder={null}
            onClose={() => setOpen(false)}
            onOpenOrder={id => { setOpen(false); router.push(`/admin/orders?order=${encodeURIComponent(id)}`); }}
            onSlice={slice => { setOpen(false); router.push(`/admin/orders?slice=${encodeURIComponent(slice)}`); }}
            onCommand={() => { setOpen(false); router.push("/admin/orders"); }}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
