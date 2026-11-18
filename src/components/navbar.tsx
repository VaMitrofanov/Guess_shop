"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowRight, Menu, Shield, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import ActiveOrderBar from "@/components/active-order-bar";

const NAV_LINKS: { href: string; label: string; match?: string; external?: boolean; mobileOnly?: boolean }[] = [
  // Витрина 2.0 (15.11.2026): шапка ведёт по главной — коды первыми.
  // Якоря — обычные `<a>`: на главной это прокрутка, с других страниц — переход.
  { href: "/#codes", match: "/#codes", label: "Коды", external: true },
  { href: "/#gift", match: "/#gift", label: "В подарок", external: true },
  { href: "/#calculator", match: "/#calculator", label: "Геймпасс", external: true },
  // Вход по коду с карточки WB — такой же, как «напиши код боту». До 07.09.2026
  // его на сайте не было вообще: человек с картой в руках попадал на витрину и
  // шёл платить второй раз. `?source=wb` обслуживает инструкция.
  { href: "/guide?source=wb", match: "/guide", label: "Код с WB", external: true },
  { href: "/#reviews", match: "/#reviews", label: "Отзывы", external: true },
  { href: "/faq", label: "Помощь" },
  // Инструкция по геймпассу — только в меню телефона: на десктопе шапка из
  // мокапа (5 разделов + «Помощь»), а инструкция есть в блоке геймпасса.
  { href: "/guide?source=site&amount=1000", match: "/guide", label: "Инструкция по геймпассу", mobileOnly: true },
];

/* 🎞 Вкладки следят за скроллом (18.11.2026, мокап А1). Раньше активной
   считалась вкладка с адресом «/#codes», а `usePathname()` отдаёт путь без «#» —
   совпадения не было никогда, шапка не знала, где человек. Теперь на главной
   IntersectionObserver выбирает раздел под шапкой, «пилюля» переезжает к нему. */
const SPY = [
  { id: "codes", href: "/#codes", short: "Коды" },
  { id: "gift", href: "/#gift", short: "Подарок" },
  { id: "calculator", href: "/#calculator", short: "Геймпасс" },
  { id: "reviews", href: "/#reviews", short: "Отзывы" },
] as const;

/** На телефоне без «Подарка»: он — режим блока кодов, а не отдельный раздел. */
const MOBILE_TABS = SPY.filter((t) => t.id !== "gift");

function useSectionSpy(enabled: boolean): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !("IntersectionObserver" in window)) return;
    const ids = ["codes", "calculator", "reviews"];
    const seen = new Map<string, number>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
      let best: string | null = null, ratio = 0;
      for (const id of ids) { const r = seen.get(id) ?? 0; if (r > ratio) { ratio = r; best = id; } }
      setActive(best);
    }, { rootMargin: "-140px 0px -45% 0px", threshold: [0, 0.1, 0.25, 0.5] });
    for (const id of ids) { const el = document.getElementById(id); if (el) io.observe(el); }
    return () => io.disconnect();
  }, [enabled]);
  return active;
}

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const onHome = pathname === "/";
  const spy = useSectionSpy(onHome);
  // «В подарок» живёт внутри блока кодов: подсвечиваем его, пока открыт режим подарка.
  const [giftMode, setGiftMode] = useState(false);
  useEffect(() => {
    if (!onHome) return;
    const sync = () => setGiftMode(window.location.hash === "#gift");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [onHome]);
  // На широком экране «Коды» и «Геймпасс» стоят рядом — после клика по
  // вкладке оба блока видны, и наблюдатель выбирал «Коды». Нажатая вкладка
  // держится, пока человек сам не прокрутит страницу.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!onHome) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href^='/#']") as HTMLAnchorElement | null;
      const id = a?.getAttribute("href")?.slice(2);
      if (id && SPY.some((x) => x.id === id)) setPicked(id);
    };
    const release = () => setPicked(null);
    document.addEventListener("click", onClick);
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    window.addEventListener("keydown", release);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      window.removeEventListener("keydown", release);
    };
  }, [onHome]);
  const activeSpy = picked ?? (spy === "codes" && giftMode ? "gift" : spy);
  const mobileActive = activeSpy === "gift" ? "codes" : activeSpy;
  const linksRef = useRef<HTMLDivElement | null>(null);
  // Пилюля берёт ВСЮ геометрию у ссылки (x, y, ширина, высота). До 18.11.2026
  // вертикаль центрировалась классом `-translate-y-1/2`, а inline-`transform`
  // ещё раз сдвигал на −50%: в Tailwind 4 это разные свойства (`translate` и
  // `transform`), они складывались, и пилюля висела на 20 px выше текста.
  const [pill, setPill] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const box = linksRef.current;
    const measure = () => {
      const el = activeSpy && box ? box.querySelector<HTMLElement>(`[data-spy="${activeSpy}"]`) : null;
      if (!box || !el) { setPill(null); return; }
      setPill({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    // Шрифт догружается и ширина окна меняется — ссылки сдвигаются, пилюля за ними.
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure);
    return () => window.removeEventListener("resize", measure);
  }, [activeSpy]);
  const { data: session, status } = useSession();
  const loggedIn = status === "authenticated" && !!session?.user;
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN";

  return (
    <nav className="sticky top-0 z-50 border-b border-[var(--rb-border)] bg-[var(--rb-nav)] text-[var(--rb-text)] backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-[1280px] items-center justify-between px-5 md:px-7">
        <Link href="/" className="group flex shrink-0 items-center gap-3" aria-label="RobloxBank — главная">
          <span className="grid h-9 w-9 -rotate-6 place-items-center rounded-[11px] border-2 border-[var(--rb-text)] bg-[#7556e8] text-sm font-black text-white shadow-[3px_3px_0_#45d6aa] transition-transform group-hover:rotate-0">R$</span>
          <span className="text-[15px] font-black tracking-[-0.04em] sm:text-[18px]">ROBLOXBANK</span>
        </Link>

        {/* D12: ссылки секций показываем только с lg. На 768 px они не помещались
            рядом с ЛК и CTA — шапка вылезала за экран на 160 px (iPad Mini в
            портрете). В 768–1023 px секции живут в бургере, который теперь
            прячется только с lg. */}
        <div ref={linksRef} className="relative mx-3 hidden items-center gap-1 lg:flex">
          {/* «Пилюля» под разделом, где сейчас человек (только главная). */}
          <span aria-hidden="true" className="rb-tabstrip-ind pointer-events-none absolute left-0 top-0 rounded-full bg-[var(--rb-accent-soft)]"
            style={{ transform: `translate(${pill?.x ?? 0}px, ${pill?.y ?? 0}px)`, width: pill?.w ?? 0, height: pill?.h ?? 0, opacity: pill ? 1 : 0 }} />
          {NAV_LINKS.filter((item) => !item.mobileOnly).map((item) => {
            const spyId = SPY.find((x) => x.href === item.href)?.id;
            const active = onHome ? Boolean(spyId && spyId === activeSpy) : pathname === (item.match ?? item.href);
            // Подписи в одну строку всегда: на 1024–1279 px «В подарок» и «Код с WB»
            // ломались на две строки и раздували шапку (18.11.2026).
            const className = cn("whitespace-nowrap rounded-full px-3 py-2 text-[15px] font-bold transition-colors xl:px-4 xl:text-base", active ? "bg-[var(--rb-accent-soft)] text-[var(--rb-accent)]" : "text-[var(--rb-muted)] hover:bg-[var(--rb-surface)] hover:text-[var(--rb-text)]");
            return item.external
              ? <a key={item.href} href={item.href} data-spy={spyId} aria-current={active ? "location" : undefined} className={cn(className, "relative z-[1]", active && onHome && "bg-transparent")}>{item.label}</a>
              : <Link key={item.href} href={item.href} className={className}>{item.label}</Link>;
          })}
        </div>

        <div className="flex shrink-0 items-center gap-3 lg:gap-4 xl:gap-6">
          <ThemeToggle compact />
          {/* D2: ссылка была `lg:flex`, а бургер — `md:hidden`, поэтому на
              768–1023 px (все iPad в портрете) в личный кабинет было не попасть
              вообще. На md показываем иконку, подпись возвращаем с lg. */}
          {/* Раньше «Кабинет» у админа вёл в /admin — значит в собственный ЛК он
              не мог попасть вообще, а выйдя из админки, не мог туда вернуться:
              ссылки на /admin не было больше нигде. Теперь у админа два разных
              входа, у обычного клиента — прежний один. */}
          {isAdmin && (
            <Link href="/admin" aria-label="Админка" title="Админка" className="hidden items-center gap-2 text-sm font-bold text-[var(--rb-accent)] transition-colors hover:opacity-80 md:flex">
              <Shield size={15} /> <span className="hidden 2xl:inline">Админка</span>
            </Link>
          )}
          <Link href={loggedIn ? "/dashboard" : "/login"} aria-label={loggedIn ? "Личный кабинет" : "Войти"} title={loggedIn ? "Личный кабинет" : "Войти"} className="hidden items-center gap-2 text-sm font-bold text-[var(--rb-muted)] transition-colors hover:text-[var(--rb-accent)] md:flex">
            <User size={15} /> <span className="hidden 2xl:inline">{loggedIn ? "Кабинет" : "Войти"}</span>
          </Link>
          <Link href="/#codes" className="hidden h-11 items-center gap-2 whitespace-nowrap rounded-xl bg-[var(--rb-strong)] px-4 text-base font-extrabold text-white shadow-[3px_3px_0_#45d6aa] transition-transform hover:-translate-y-0.5 md:flex">
            Купить<span className="hidden xl:inline"> Robux</span> <ArrowRight size={15} />
          </Link>
          <button type="button" onClick={() => setOpen((value) => !value)} className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--rb-border)] bg-[var(--rb-surface)] text-[var(--rb-text)] lg:hidden" aria-label={open ? "Закрыть меню" : "Открыть меню"}>
            {open ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>

      {/* 📱 Разделы главной на телефоне и планшете. До 18.11.2026 это была
          «таблетка» с ползунком и вкладкой «Подарок» — двойник переключателя
          «Себе / В подарок» в блоке кодов: на экране было два одинаковых
          контрола про одно и то же. Теперь — обычные вкладки с подчёркиванием,
          а подарок выбирается только в самом блоке кодов. */}
      {onHome && !open && (
        <div className="border-t border-[var(--rb-border)] px-4 lg:hidden">
          <div className="relative mx-auto grid max-w-[620px] grid-cols-3">
            <span aria-hidden="true" className="rb-tabstrip-ind absolute bottom-0 left-0 h-[3px] rounded-t-full bg-[var(--rb-accent)]"
              style={{ width: `${100 / MOBILE_TABS.length}%`, transform: `translateX(${Math.max(0, MOBILE_TABS.findIndex((x) => x.id === mobileActive)) * 100}%)`, opacity: mobileActive ? 1 : 0 }} />
            {MOBILE_TABS.map((t) => (
              <a key={t.id} href={t.href} aria-current={t.id === mobileActive ? "location" : undefined}
                className={cn("flex h-11 items-center justify-center text-[14px] font-extrabold transition-colors duration-300",
                  t.id === mobileActive ? "text-[var(--rb-text)]" : "text-[var(--rb-muted)]")}>{t.short}</a>
            ))}
          </div>
        </div>
      )}

      {open && (
        <div className="rb-menu-sheet border-t border-[var(--rb-border)] bg-[var(--rb-bg)] px-5 py-4 lg:hidden">
          <div className="mx-auto flex max-w-[620px] flex-col gap-1">
            {NAV_LINKS.map((item) => item.external
              ? <a key={item.href} href={item.href} onClick={() => setOpen(false)} className="rounded-xl px-4 py-3 text-sm font-bold text-[var(--rb-muted)] hover:bg-[var(--rb-accent-soft)] hover:text-[var(--rb-accent)]">{item.label}</a>
              : <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="rounded-xl px-4 py-3 text-sm font-bold text-[var(--rb-muted)] hover:bg-[var(--rb-accent-soft)] hover:text-[var(--rb-accent)]">{item.label}</Link>)}
            {/* D1: здесь были литеральные `bg-white` и `border-[#dcd5ef]` без
                цвета текста — он наследовался от `--rb-text`, и в тёмной теме
                получался белый текст на белом фоне (контраст ≈1.05:1).
                D7: подпись была всегда «Кабинет», даже когда клиент не вошёл.
                Цвета публичного шелла — только через токены `--rb-*`. */}
            <div className="mt-2 grid grid-cols-2 gap-2 md:hidden">
              {isAdmin && (
                <Link href="/admin" onClick={() => setOpen(false)} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--rb-accent)] bg-[var(--rb-accent-soft)] text-sm font-bold text-[var(--rb-accent)]"><Shield size={15} /> Админка</Link>
              )}
              <Link href={loggedIn ? "/dashboard" : "/login"} onClick={() => setOpen(false)} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--rb-border)] bg-[var(--rb-surface)] text-sm font-bold text-[var(--rb-text)]"><User size={15} /> {loggedIn ? "Кабинет" : "Войти"}</Link>
              <Link href="/#codes" onClick={() => setOpen(false)} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--rb-strong)] text-base font-bold text-white">Купить <ArrowRight size={15} /></Link>
            </div>
          </div>
        </div>
      )}

      {/* Заказ всегда перед глазами: пока он живой, строка едет вместе с шапкой
          на каждой странице сайта — так же, как приветствие бота показывает его
          в Telegram и ВКонтакте. */}
      <ActiveOrderBar enabled={loggedIn} />
    </nav>
  );
}
