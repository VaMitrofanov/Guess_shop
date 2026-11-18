"use client";

import { useEffect } from "react";

/**
 * 🎞 Движение главной (18.11.2026, мокап А1).
 *  • Подсветка раздела, куда привёл якорь («Купить код», вкладки шапки и т.п.):
 *    сам плавный скролл делает CSS (`scroll-behavior` + `scroll-margin-top`).
 *  • Появление блоков при прокрутке: `[data-reveal]` проявляется один раз.
 *    Класс `rb-reveal-ready` ставится только из JS — без JS всё видно сразу.
 */
const FLASH_TARGET: Record<string, string> = { gift: "codes" };

function flash(hash: string) {
  const id = FLASH_TARGET[hash] ?? hash;
  const el = id ? document.getElementById(id) : null;
  if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  el.classList.remove("rb-arrive");
  window.setTimeout(() => {
    void el.offsetWidth;
    el.classList.add("rb-arrive");
    window.setTimeout(() => el.classList.remove("rb-arrive"), 1200);
  }, 420);
}

export default function SiteMotion() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const a = (event.target as HTMLElement | null)?.closest?.("a[href*='#']") as HTMLAnchorElement | null;
      if (!a) return;
      const url = new URL(a.href, window.location.href);
      if (url.pathname !== window.location.pathname || !url.hash) return;
      flash(url.hash.slice(1));
    };
    document.addEventListener("click", onClick);
    if (window.location.hash) flash(window.location.hash.slice(1));

    const root = document.documentElement;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    let io: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window && nodes.length) {
      // Уже видимое сверху экрана — сразу «в», чтобы ничего не мигало.
      for (const n of nodes) if (n.getBoundingClientRect().top < window.innerHeight * 0.9) n.classList.add("rb-in");
      root.classList.add("rb-reveal-ready");
      io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add("rb-in"); io?.unobserve(e.target); }
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
      for (const n of nodes) if (!n.classList.contains("rb-in")) io.observe(n);
    }
    return () => {
      document.removeEventListener("click", onClick);
      io?.disconnect();
      root.classList.remove("rb-reveal-ready");
    };
  }, []);
  return null;
}
