"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import Navbar from "@/components/navbar";
import {
  AlertTriangle, CheckCircle2, ExternalLink, ArrowRight, ChevronRight,
  Globe, Gamepad2, Ticket, Tag, Link2, ShoppingCart,
  Lock, Send, ShoppingBag, Copy, Check, Search, CreditCard,
} from "lucide-react";

// ─── localStorage WB session helpers ──────────────────────────────────────────
const WB_SESSION_KEY = "rb_wb_session";
const WB_SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function saveWBSession(denomination: number) {
  try {
    localStorage.setItem(WB_SESSION_KEY, JSON.stringify({ denomination, ts: Date.now() }));
  } catch {}
}

function loadWBSession(): number | null {
  try {
    const raw = localStorage.getItem(WB_SESSION_KEY);
    if (!raw) return null;
    const { denomination, ts } = JSON.parse(raw);
    if (Date.now() - ts > WB_SESSION_TTL) {
      localStorage.removeItem(WB_SESSION_KEY);
      return null;
    }
    return denomination > 0 ? denomination : null;
  } catch {
    return null;
  }
}

// ─── Step definitions ──────────────────────────────────────────────────────────

// Steps shared between standard and WB (01–04)
const STEPS_COMMON = [
  {
    num: "01", icon: Globe,
    title: "Открой Creator Hub",
    desc: "Зайди на create.roblox.com и войди в аккаунт.",
    detail: "Официальный портал для создателей. Работает в любом браузере — на компьютере или телефоне. Никаких программ скачивать не нужно.",
    tip: null, warn: null,
  },
  {
    num: "02", icon: Gamepad2,
    title: "Выбери или создай игру",
    desc: "Нажми «Creations» → выбери игру. Нет игр — создай пустую.",
    detail: "Кнопка «Create Experience» в правом верхнем углу. Введи любое название — оно не важно. Игру не нужно публиковать или наполнять.",
    tip: "Игра нужна только как контейнер для геймпасса — название и содержимое не важны.",
    warn: null,
  },
  {
    num: "03", icon: Ticket,
    title: "Создай геймпасс",
    desc: "В настройках игры: «Monetization» → «Passes» → «Create a Pass».",
    detail: "Придумай любое название: «VIP», «Donate», «Premium». Иконку загружать необязательно — Roblox подставит стандартную. Нажми «Save».",
    tip: null, warn: null,
  },
  {
    num: "04", icon: Tag,
    title: "Установи цену",
    desc: "Настройки пасса → включи «For Sale» → укажи рассчитанную цену → сохрани.",
    detail: "Roblox удерживает 30% с каждой продажи. Поэтому цена пасса должна быть выше суммы, которую ты хочешь получить. Используй калькулятор выше — он уже посчитал нужную цену.",
    tip: null,
    warn: "Установи точную цену из калькулятора — она учитывает 30% комиссию Roblox.",
  },
];

// Steps 05 & 06 for standard (website) flow
const STEPS_STANDARD = [
  {
    num: "05", icon: Search,
    title: "Найди пасс на сайте",
    desc: "Вернись на robloxbank.ru → нажми «Купить Robux» → введи свой ник в поле поиска.",
    detail: "На странице оформления выбери игру, в которой создал пасс, затем выбери нужный геймпасс из списка. Цена подтянется автоматически.",
    tip: "Можно вставить прямую ссылку на пасс или его числовой ID — это самый быстрый способ.",
    warn: null,
  },
  {
    num: "06", icon: CreditCard,
    title: "Оплати заказ",
    desc: "Выбери геймпасс → нажми «К подтверждению» → «Оплатить» банковской картой.",
    detail: "Оплата проходит через Tinkoff — безопасно и мгновенно. Сразу после оплаты заказ уходит в обработку. Писать в поддержку не нужно — всё автоматически.",
    tip: null,
    warn: "Не удаляй геймпасс и не меняй цену до получения уведомления о завершении заказа.",
  },
];

// Steps 05 & 06 for WB (manager) flow
const STEPS_WB = [
  {
    num: "05", icon: Link2,
    title: "Скопируй ссылку на геймпасс",
    desc: "В Creator Hub открой игру → «Monetization» → «Passes» → кликни на пасс → скопируй URL.",
    detail: "Ссылка выглядит так: roblox.com/game-pass/1234567/название — скопируй её целиком из адресной строки.",
    tip: "URL можно скопировать прямо из адресной строки — нажми на неё и выдели весь текст.",
    warn: null,
  },
  {
    num: "06", icon: Send,
    title: "Отправь ссылку менеджеру",
    desc: "Скопируй ссылку на геймпасс и отправь её нам — в Telegram или ВКонтакте.",
    detail: "Менеджер выкупит пасс вручную и пришлёт подтверждение. Robux поступят на баланс через 5–7 дней — стандартное время зачисления по правилам Roblox.",
    tip: null,
    warn: "Не удаляй геймпасс и не меняй цену до получения уведомления о завершении заказа.",
  },
];

const TABLE = [
  [100, 143, "~55 ₽"],   [300, 429, "~165 ₽"],  [500, 715, "~275 ₽"],
  [800, 1143, "~440 ₽"], [1000, 1430, "~550 ₽"], [1500, 2143, "~825 ₽"],
  [2000, 2858, "~1100 ₽"],[3000, 4286, "~1650 ₽"],[5000, 7143, "~2750 ₽"],
];

const FAQ = [
  { q: "Сколько времени занимает создание?",       a: "Около 5 минут. Создать игру (1 мин) → создать пасс (2 мин) → установить цену (1 мин) → оформить заказ (1 мин)." },
  { q: "Когда придут Robux после оплаты?",          a: "Заказ обрабатывается до 24 часов. После покупки пасса Roblox зачисляет средства через 5–7 дней — это стандартная политика платформы." },
  { q: "Можно удалить геймпасс после оплаты?",      a: "Нет! Не удаляй и не меняй цену до получения подтверждения о завершении. Иначе заказ не выполнится и придётся делать возврат." },
  { q: "Нет игры в Roblox — что делать?",           a: "Создай пустую через Creator Hub за 1 минуту. Публиковать и наполнять контентом не нужно — игра нужна только как контейнер для пасса." },
  { q: "Почему цена пасса выше нужной суммы?",      a: "Roblox удерживает 30% с каждой продажи. Чтобы получить 1000 R$ — пасс должен стоить 1430 R$. Калькулятор учитывает это автоматически." },
  { q: "Геймпасс не находится при поиске по нику?", a: "Убедись, что игра с пассом существует. Можно вставить прямую ссылку на пасс или его числовой ID — поиск поддерживает все форматы." },
];

const MISTAKES = [
  { wrong: "Цена пасса = нужная сумма",       right: "Цена пасса = нужная сумма ÷ 0.7" },
  { wrong: "Удаляю пасс сразу после оплаты",  right: "Жду уведомления о завершении заказа" },
  { wrong: "Меняю цену пока идёт заказ",       right: "Цена неизменна до завершения" },
  { wrong: "Robux придут сразу",               right: "Roblox зачисляет R$ через 5–7 дней" },
];

// ─── Roblox Creator Hub realistic animations ──────────────────────────────────

/** SVG mouse cursor */
function RCursor() {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill="none" style={{ display: "block" }}>
      <path d="M1.5 1.5L1.5 13.5L4.5 10L6.5 15.5L8.5 14.8L6.5 9.5L11.5 9.5Z"
        fill="white" stroke="#1a1a1a" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

/** Mini Mac-style browser frame wrapping the Roblox UI */
function RCHBrowser({ children, url = "create.roblox.com" }: { children: React.ReactNode; url?: string }) {
  return (
    <div className="mt-4 overflow-hidden border border-[#1e2a45]" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: "11px", lineHeight: 1.4, position: "relative" }}>
      {/* Browser chrome */}
      <div style={{ background: "#2d2d2d", padding: "5px 8px", display: "flex", alignItems: "center", gap: "6px" }}>
        <div style={{ display: "flex", gap: "4px" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff5f57" }} />
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ffbd2e" }} />
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#28ca41" }} />
        </div>
        <div style={{ flex: 1, background: "#1c1c1c", border: "1px solid #444", borderRadius: 3, padding: "2px 8px", display: "flex", alignItems: "center", gap: 4, maxWidth: 220, margin: "0 auto" }}>
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="#5f6368" strokeWidth="1.2" /><path d="M8.5 8.5L11 11" stroke="#5f6368" strokeWidth="1.2" strokeLinecap="round" /></svg>
          <span style={{ fontSize: 9, color: "#9aa0a6", letterSpacing: "0.01em" }}>{url}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Roblox Creator Hub top nav bar */
function RCHTopNav() {
  return (
    <div style={{ background: "#1a1a1a", padding: "5px 10px", display: "flex", alignItems: "center", gap: 10 }}>
      {/* Roblox logo (R pill) */}
      <div style={{ background: "#e31e24", borderRadius: 3, padding: "1px 5px", display: "flex", alignItems: "center" }}>
        <span style={{ color: "white", fontWeight: 900, fontSize: 9, letterSpacing: "0.05em" }}>R</span>
      </div>
      <span style={{ color: "#ccc", fontSize: 9, fontWeight: 600 }}>Creator Hub</span>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#333", border: "1px solid #555", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#aaa", fontSize: 8, fontWeight: 700 }}>U</span>
        </div>
      </div>
    </div>
  );
}

/** Sidebar item for game configure page */
function SItem({ label, active, sub, expanded, highlight }: { label: string; active?: boolean; sub?: boolean; expanded?: boolean; highlight?: boolean }) {
  const bg = active ? "#dbeafe" : highlight ? "#f0f0f0" : "transparent";
  const color = active ? "#1d4ed8" : highlight ? "#1a1a1a" : "#3d3d3d";
  const fw = active ? 700 : 500;
  const bl = active ? "3px solid #1d4ed8" : "3px solid transparent";
  return (
    <div style={{ padding: sub ? "3px 6px 3px 16px" : "4px 6px", background: bg, borderLeft: bl, color, fontWeight: fw, fontSize: sub ? 9 : 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, transition: "all 0.2s", outline: highlight ? "1.5px solid #0e6fff" : "none", outlineOffset: "-1px" }}>
      <span>{label}</span>
      {expanded !== undefined && <span style={{ fontSize: 7, color: "#888" }}>{expanded ? "▾" : "▸"}</span>}
    </div>
  );
}

// ── Anim 01: Open Creator Hub ──────────────────────────────────────────────────
function Anim01() {
  const [f, setF] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setF(v => (v + 1) % 4), 1600);
    return () => clearInterval(id);
  }, []);

  const urlTexts = ["", "create.rob", "create.roblox.com", "create.roblox.com"];
  const showPage = f >= 2;
  const highlightCreations = f === 3;

  return (
    <>
    <RCHBrowser url={urlTexts[f] + (f < 2 ? "|" : "")}>
      {showPage ? (
        <>
          <RCHTopNav />
          <div style={{ display: "flex", background: "#fff" }}>
            {/* Left nav */}
            <div style={{ width: 110, background: "#f5f5f5", borderRight: "1px solid #e0e0e0", padding: "6px 4px" }}>
              <div style={{ fontSize: 8, color: "#888", padding: "2px 6px 4px", fontWeight: 700, letterSpacing: "0.08em" }}>НАВИГАЦИЯ</div>
              <SItem label="Dashboard" active={!highlightCreations} />
              <SItem label="Creations" highlight={highlightCreations} active={highlightCreations} />
              <SItem label="Marketplace" />
              <SItem label="Community" />
            </div>
            {/* Content */}
            <div style={{ flex: 1, padding: "10px 12px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1a1a1a", marginBottom: 6 }}>Welcome to Creator Hub</div>
              <div style={{ fontSize: 9, color: "#666", marginBottom: 8 }}>Build, publish and monetize your Roblox experiences.</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#0e6fff", borderRadius: 3, padding: "4px 10px", color: "white", fontWeight: 700, fontSize: 9, boxShadow: highlightCreations ? "0 0 0 3px #0e6fff44" : "none", transition: "box-shadow 0.3s" }}>
                {highlightCreations && <span>→ </span>}Creations
              </div>
            </div>
          </div>
          {/* Cursor */}
          {highlightCreations && (
            <div style={{ position: "absolute", top: 52, left: 85, pointerEvents: "none", zIndex: 10 }}>
              <RCursor />
            </div>
          )}
        </>
      ) : (
        <div style={{ background: "#fff", padding: "20px 16px", textAlign: "center" }}>
          <div style={{ color: "#bbb", fontSize: 10 }}>Загрузка...</div>
          <div style={{ margin: "6px auto", width: 60, height: 3, background: "#f0f0f0", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: f === 1 ? "60%" : "10%", height: "100%", background: "#0e6fff", transition: "width 1s ease" }} />
          </div>
        </div>
      )}
    </RCHBrowser>
    <div className="flex justify-center mt-4">
      <a
        href="https://create.roblox.com"
        target="_blank"
        rel="noopener noreferrer"
        className="h-12 px-7 border-2 border-[#1e2a45] hover:border-[#00b06f]/50 hover:text-[#00b06f] font-black text-[11px] uppercase tracking-widest transition-all rounded-none flex items-center gap-2 text-zinc-300"
      >
        Открыть Creator Hub <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
    </>
  );
}

// ── Anim 02: Select game from My Creations ─────────────────────────────────────
function Anim02() {
  const [f, setF] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setF(v => (v + 1) % 4), 1700);
    return () => clearInterval(id);
  }, []);

  // 0=grid shown, 1=hover game1, 2=hover "Create Experience", 3=create dialog
  const games = [
    { name: "My Game", color: "#4f46e5" },
    { name: "Test Place", color: "#0891b2" },
  ];
  const showCreate = f === 3;

  return (
    <RCHBrowser>
      <RCHTopNav />
      <div style={{ background: "#fff", padding: "8px 10px", position: "relative" }}>
        {/* Header row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#1a1a1a" }}>My Creations</div>
          <div style={{
            fontSize: 9, fontWeight: 700, color: "white", background: "#0e6fff",
            padding: "3px 8px", borderRadius: 3,
            boxShadow: f === 2 ? "0 0 0 3px #0e6fff55" : "none",
            outline: f === 2 ? "2px solid #0e6fff" : "none",
            outlineOffset: 1,
            transition: "all 0.3s",
          }}>+ Create Experience</div>
        </div>
        {/* Games grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {games.map((g, i) => (
            <div key={i} style={{
              background: "#f9f9f9",
              border: (f === 1 && i === 0) ? "2px solid #0e6fff" : "1px solid #e0e0e0",
              borderRadius: 4, overflow: "hidden",
              boxShadow: (f === 1 && i === 0) ? "0 0 0 2px #0e6fff33" : "none",
              transition: "all 0.3s",
            }}>
              <div style={{ height: 28, background: g.color, opacity: 0.85 }} />
              <div style={{ padding: "4px 6px" }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#1a1a1a" }}>{g.name}</div>
                <div style={{ fontSize: 8, color: "#888", marginTop: 1 }}>Private · 0 visits</div>
              </div>
            </div>
          ))}
        </div>

        {/* Create modal overlay */}
        {showCreate && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
            <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 6, padding: "10px 14px", width: "80%", boxShadow: "0 8px 24px rgba(0,0,0,0.15)" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#1a1a1a", marginBottom: 6 }}>Create New Experience</div>
              <div style={{ fontSize: 8, color: "#666", marginBottom: 4 }}>Experience Name</div>
              <div style={{ border: "2px solid #0e6fff", borderRadius: 3, padding: "3px 6px", fontSize: 9, color: "#1a1a1a", background: "#f8f9ff" }}>
                My Game<span style={{ animation: "rb-cursor-blink 0.8s step-end infinite", borderLeft: "1.5px solid #1a1a1a", marginLeft: 1 }}>&nbsp;</span>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 5, marginTop: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 600, color: "#555", background: "#f0f0f0", borderRadius: 3, padding: "3px 8px" }}>Cancel</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: "white", background: "#0e6fff", borderRadius: 3, padding: "3px 8px" }}>Create</div>
              </div>
            </div>
          </div>
        )}

        {/* Cursor */}
        <div style={{ position: "absolute", top: f === 1 ? 40 : f === 2 ? 12 : 40, left: f === 1 ? 20 : f === 2 ? 148 : 148, pointerEvents: "none", zIndex: 20, transition: "top 0.4s ease, left 0.4s ease" }}>
          {f <= 2 && <RCursor />}
        </div>
      </div>
    </RCHBrowser>
  );
}

// ── Anim 03: Create a Game Pass ────────────────────────────────────────────────
function Anim03() {
  const [f, setF] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setF(v => (v + 1) % 6), 1500);
    return () => clearInterval(id);
  }, []);

  // 0=overview sidebar, 1=click Monetization, 2=Game Passes visible,
  // 3=click Create a Game Pass, 4=modal typing name, 5=save button highlighted
  const monoExpanded = f >= 2;
  const passesHighlight = f === 2;
  const showCreateBtn = f >= 2;
  const showModal = f >= 4;
  const typedName = f >= 4 ? (f === 4 ? "VIP|" : "VIP") : "";
  const saveHighlight = f === 5;

  return (
    <RCHBrowser>
      <RCHTopNav />
      <div style={{ display: "flex", background: "#fff", position: "relative" }}>
        {/* Sidebar */}
        <div style={{ width: 108, background: "#f5f5f5", borderRight: "1px solid #e0e0e0", padding: "4px 4px", flexShrink: 0 }}>
          <div style={{ fontSize: 8, color: "#888", padding: "2px 6px 3px", fontWeight: 700 }}>CONFIGURE</div>
          <SItem label="Overview" active={f === 0} />
          <SItem label="Basic Settings" />
          <SItem label="Monetization" active={f >= 1} highlight={f === 1} expanded={monoExpanded} />
          {monoExpanded && <>
            <SItem label="Dev Products" sub />
            <SItem label="Game Passes" sub active={f >= 2} highlight={passesHighlight} />
            <SItem label="Paid Access" sub />
          </>}
          <SItem label="Analytics" />
        </div>

        {/* Main content */}
        <div style={{ flex: 1, padding: "8px 10px", minHeight: 110, position: "relative" }}>
          {!showCreateBtn ? (
            <div style={{ fontSize: 10, color: "#aaa" }}>Select a section from the sidebar.</div>
          ) : !showModal ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1a1a1a", marginBottom: 7 }}>Game Passes</div>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: f === 3 ? "#0a55d4" : "#0e6fff",
                color: "white", fontWeight: 700, fontSize: 9,
                padding: "4px 10px", borderRadius: 3,
                boxShadow: f === 3 ? "0 0 0 3px #0e6fff55" : "none",
                outline: f === 3 ? "2px solid #0e6fff" : "none",
                outlineOffset: 1,
                transition: "all 0.2s",
              }}>
                + Create a Game Pass
              </div>
              <div style={{ marginTop: 10, textAlign: "center", color: "#bbb", fontSize: 9 }}>No game passes yet.</div>
            </>
          ) : (
            /* Modal */
            <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 6, padding: "10px 12px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1a1a1a", marginBottom: 8, borderBottom: "1px solid #eee", paddingBottom: 5 }}>
                Create Game Pass
              </div>
              <div style={{ fontSize: 8, color: "#555", fontWeight: 600, marginBottom: 3 }}>Pass Name <span style={{ color: "#e31e24" }}>*</span></div>
              <div style={{
                border: f === 4 ? "2px solid #0e6fff" : "1px solid #ccc",
                borderRadius: 3, padding: "4px 7px", fontSize: 10, color: "#1a1a1a",
                background: f === 4 ? "#f8f9ff" : "#fff",
                marginBottom: 7, transition: "all 0.3s",
              }}>
                {typedName || <span style={{ color: "#bbb" }}>Enter pass name…</span>}
              </div>
              <div style={{ fontSize: 8, color: "#555", fontWeight: 600, marginBottom: 3 }}>Pass Description <span style={{ color: "#999" }}>(optional)</span></div>
              <div style={{ border: "1px solid #ccc", borderRadius: 3, padding: "3px 7px", fontSize: 9, color: "#bbb", marginBottom: 8, height: 18 }}>Add a description…</div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 5 }}>
                <div style={{ fontSize: 9, fontWeight: 600, color: "#555", background: "#f0f0f0", borderRadius: 3, padding: "4px 10px" }}>Cancel</div>
                <div style={{
                  fontSize: 9, fontWeight: 700, color: "white",
                  background: saveHighlight ? "#0a55d4" : "#0e6fff",
                  borderRadius: 3, padding: "4px 10px",
                  boxShadow: saveHighlight ? "0 0 0 3px #0e6fff55" : "none",
                  outline: saveHighlight ? "2px solid #0e6fff" : "none",
                  outlineOffset: 1,
                  transition: "all 0.3s",
                }}>Save</div>
              </div>
            </div>
          )}
        </div>

        {/* Cursor */}
        <div style={{
          position: "absolute",
          top: f === 0 ? 30 : f === 1 ? 55 : f === 2 ? 67 : f === 3 ? 42 : f === 4 ? 72 : 105,
          left: f === 0 ? 50 : f === 1 ? 55 : f === 2 ? 60 : f === 3 ? 145 : f === 4 ? 145 : 190,
          pointerEvents: "none", zIndex: 20,
          transition: "top 0.45s cubic-bezier(0.4,0,0.2,1), left 0.45s cubic-bezier(0.4,0,0.2,1)",
        }}>
          <RCursor />
        </div>
      </div>
    </RCHBrowser>
  );
}

// ── Anim 04: Set price — accurate Roblox Creator Hub dark UI ──────────────────
function Anim04Price({ passPrice }: { passPrice: number | null }) {
  const [f, setF] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setF(v => (v + 1) % 7), 1400);
    return () => clearInterval(id);
  }, []);

  // f=0: page loads, toggle OFF
  // f=1: cursor hovers toggle (blue glow)
  // f=2: toggle turns ON (blue), price field appears
  // f=3: cursor moves to Default Price field (focus)
  // f=4: price fully typed
  // f=5: cursor moves to checkbox with RED warning (don't check!)
  // f=6: cursor moves to Save Changes → saved state
  const toggleOn  = f >= 2;
  const priceFocus = f >= 3;
  const priceVal  = f >= 4 ? String(passPrice ?? 1430) : "";
  const checkWarn = f === 5;
  const saveHL    = f === 6;

  const cursorTop  = [18, 108, 108, 148, 148, 188, 232][f];
  const cursorLeft = [50,  148, 148, 195, 195, 155, 170][f];

  return (
    <div style={{
      borderRadius: 6, overflow: "hidden",
      border: "1px solid #2a2a2a", background: "#111",
      fontSize: 10, userSelect: "none", position: "relative", marginTop: 12,
    }}>
      {/* Mac window chrome */}
      <div style={{ background: "#1c1c1c", padding: "5px 10px", display: "flex", alignItems: "center", gap: 5, borderBottom: "1px solid #2a2a2a" }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff5f57" }} />
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#febc2e" }} />
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#28c840" }} />
        <div style={{ flex: 1, height: 14, background: "#2d2d2d", borderRadius: 3, marginLeft: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#666", fontSize: 7 }}>create.roblox.com</span>
        </div>
      </div>

      <div style={{ display: "flex" }}>
        {/* Icon sidebar */}
        <div style={{ width: 40, background: "#181818", borderRight: "1px solid #252525", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8, gap: 4 }}>
          <div style={{ width: 22, height: 22, background: "#e32f4a", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
            <span style={{ color: "white", fontWeight: 900, fontSize: 9 }}>R</span>
          </div>
          {["⌂","✦","◈","⊞","☰","↻","$","📊"].map((ic, i) => (
            <div key={i} style={{ width: 28, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 3, background: i === 1 ? "#1a3a2a" : "transparent" }}>
              <span style={{ fontSize: 9, color: i === 1 ? "#00b06f" : "#3a3a3a" }}>{ic}</span>
            </div>
          ))}
        </div>

        {/* Left nav */}
        <div style={{ width: 100, background: "#1a1a1a", borderRight: "1px solid #252525", paddingTop: 8 }}>
          <div style={{ padding: "0 8px 6px", fontSize: 7, color: "#444", fontWeight: 700, letterSpacing: "0.1em" }}>BASIC SETTINGS</div>
          {["Overview","Details","Sales","Analytics"].map((lbl) => (
            <div key={lbl} style={{
              padding: "5px 10px", fontSize: 8,
              color: lbl === "Sales" ? "#fff" : "#555",
              background: lbl === "Sales" ? "#242424" : "transparent",
              borderLeft: lbl === "Sales" ? "2px solid #4a9eff" : "2px solid transparent",
              fontWeight: lbl === "Sales" ? 700 : 400,
            }}>{lbl}</div>
          ))}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, background: "#111", padding: "10px 12px", minHeight: 250, position: "relative" }}>
          {/* Breadcrumb */}
          <div style={{ fontSize: 7, color: "#444", marginBottom: 6, display: "flex", flexWrap: "wrap", gap: 2 }}>
            {"Creations / My Place / Passes / VIP Pass /".split(" ").map((t, i) => (
              <span key={i} style={{ color: t === "/" ? "#333" : "#444" }}>{t} </span>
            ))}
            <span style={{ color: "#bbb", fontWeight: 700 }}>Sales</span>
          </div>

          {/* H1 */}
          <div style={{ fontSize: 13, fontWeight: 800, color: "#eee", marginBottom: 8 }}>Sales</div>

          {/* Blue info banner */}
          <div style={{ border: "1px solid #1e4070", background: "#0d1f3c", borderRadius: 3, padding: "5px 8px", marginBottom: 8, display: "flex", alignItems: "flex-start", gap: 6 }}>
            <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#4a9eff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
              <span style={{ color: "white", fontSize: 7, fontWeight: 900, lineHeight: 1 }}>i</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: "#ddd", marginBottom: 1 }}>New Regional Pricing</div>
              <div style={{ fontSize: 7, color: "#666" }}>Roblox can now automate different prices for countries and regions.</div>
            </div>
            <span style={{ fontSize: 8, color: "#4a9eff", cursor: "pointer" }}>✕</span>
          </div>

          {/* Price section */}
          <div style={{ fontSize: 8, fontWeight: 700, color: "#666", marginBottom: 6, letterSpacing: "0.05em" }}>Price</div>

          {/* Item for Sale toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{
              width: 30, height: 16, borderRadius: 8,
              background: toggleOn ? "#4a9eff" : "#333",
              position: "relative", transition: "background 0.3s",
              boxShadow: f === 1 ? "0 0 0 3px #4a9eff44" : "none",
              cursor: "pointer", flexShrink: 0,
            }}>
              <div style={{
                width: 12, height: 12, borderRadius: "50%", background: "white",
                position: "absolute", top: 2,
                left: toggleOn ? 16 : 2,
                transition: "left 0.3s", boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
              }} />
            </div>
            <span style={{ fontSize: 10, color: "#ddd", fontWeight: 600 }}>Item for Sale</span>
          </div>

          {/* Default Price field */}
          {toggleOn && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 7, color: "#555", marginBottom: 3 }}>Default Price</div>
              <div style={{
                border: priceFocus ? "2px solid #4a9eff" : "1px solid #2a2a2a",
                borderRadius: 3, background: "#1a1a1a",
                padding: "5px 10px", display: "flex", alignItems: "center", gap: 6,
                transition: "border-color 0.3s",
              }}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", border: "2px solid #4a9eff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#4a9eff" }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#eee", fontFamily: "monospace" }}>
                  {priceVal || <span style={{ color: "#444" }}>0</span>}
                  {priceFocus && f <= 4 ? <span style={{ borderLeft: "1.5px solid #eee", marginLeft: 1 }}>&nbsp;</span> : null}
                </span>
              </div>
            </div>
          )}

          {/* Enable regional pricing checkbox */}
          {toggleOn && (
            <div style={{ marginBottom: 8 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 7, padding: "4px 6px",
                border: checkWarn ? "1.5px solid #ef4444" : "1px solid transparent",
                background: checkWarn ? "#250a0a" : "transparent",
                borderRadius: 3, transition: "all 0.3s",
                boxShadow: checkWarn ? "0 0 0 3px #ef444420" : "none",
              }}>
                <div style={{
                  width: 12, height: 12,
                  border: checkWarn ? "2px solid #ef4444" : "1.5px solid #3a3a3a",
                  background: "transparent", borderRadius: 2, flexShrink: 0, transition: "border-color 0.3s",
                }} />
                <span style={{ fontSize: 8.5, color: checkWarn ? "#ff8888" : "#888", fontWeight: checkWarn ? 700 : 400 }}>
                  Enable regional pricing
                </span>
                {checkWarn && (
                  <span style={{ marginLeft: "auto", fontSize: 7, color: "#ef4444", fontWeight: 700, background: "#ef444420", padding: "1px 5px", borderRadius: 2 }}>
                    ← НЕ ТРОГАТЬ
                  </span>
                )}
              </div>
              {checkWarn && (
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, padding: "3px 6px", background: "#1e1400", border: "1px solid #c9a84c33", borderRadius: 2 }}>
                  <span style={{ color: "#c9a84c", fontSize: 8 }}>⚠</span>
                  <span style={{ fontSize: 7, color: "#c9a84c88" }}>Roblox изменит цену для разных стран — оставь выключенным</span>
                </div>
              )}
            </div>
          )}

          {/* Buttons */}
          {toggleOn && (
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <div style={{ padding: "5px 14px", border: "1px solid #2a2a2a", borderRadius: 4, fontSize: 8.5, color: "#666" }}>Cancel</div>
              <div style={{
                padding: "5px 18px", borderRadius: 4, fontSize: 8.5, fontWeight: 700, color: "white",
                background: saveHL ? "#1d4ed8" : "#4a9eff",
                boxShadow: saveHL ? "0 0 0 3px #4a9eff33" : "none",
                transition: "all 0.3s",
              }}>
                {saveHL ? "✓ Saved!" : "Save Changes"}
              </div>
            </div>
          )}

          {/* Cursor */}
          <div style={{
            position: "absolute", top: cursorTop, left: cursorLeft,
            pointerEvents: "none", zIndex: 20,
            transition: "top 0.45s cubic-bezier(0.4,0,0.2,1), left 0.45s cubic-bezier(0.4,0,0.2,1)",
          }}>
            <RCursor />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Anim 05 Standard: Find gamepass on RobloxBank site ─────────────────────────
function Anim05Standard() {
  const [f, setF] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setF(v => (v + 1) % 4), 1600);
    return () => clearInterval(id);
  }, []);
  // 0=checkout page, 1=typing nick, 2=games list, 3=pass selected
  const typed = f >= 1 ? "MyRobloxNick" : "";
  const showGames = f >= 2;
  const showPass = f === 3;

  return (
    <RCHBrowser url="robloxbank.ru/checkout">
      <div style={{ background: "#080c18", padding: "8px 10px", fontFamily: "inherit" }}>
        <div style={{ color: "#eee", fontSize: 10, fontWeight: 700, marginBottom: 6 }}>Поиск геймпасса</div>
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          <div style={{
            flex: 1, border: f === 1 ? "2px solid #00b06f" : "1px solid #1e2a45",
            background: "#050810", padding: "4px 8px", fontSize: 9, color: "#eee",
            display: "flex", alignItems: "center",
          }}>
            {typed || <span style={{ color: "#555" }}>Никнейм Roblox…</span>}
            {f === 1 && <span style={{ borderLeft: "1.5px solid #eee", marginLeft: 1 }}>&nbsp;</span>}
          </div>
          <div style={{ background: "#00b06f", color: "white", fontWeight: 700, fontSize: 9, padding: "4px 10px", display: "flex", alignItems: "center" }}>НАЙТИ</div>
        </div>
        {showGames && !showPass && (
          <div style={{ border: "1px solid #1e2a45", background: "#0a0f1e", padding: "5px 7px" }}>
            <div style={{ fontSize: 8, color: "#666", fontWeight: 700, marginBottom: 4 }}>ВЫБЕРИТЕ ИГРУ</div>
            {[{ name: "My Game", id: "123" }, { name: "Test Place", id: "456" }].map((g, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", borderBottom: "1px solid #1a2035" }}>
                <div style={{ width: 20, height: 14, background: i === 0 ? "#4f46e5" : "#0891b2", borderRadius: 1 }} />
                <span style={{ fontSize: 9, color: "#ddd", fontWeight: 600 }}>{g.name}</span>
                <span style={{ marginLeft: "auto", fontSize: 8, color: "#555" }}>→</span>
              </div>
            ))}
          </div>
        )}
        {showPass && (
          <div style={{ border: "2px solid #00b06f", background: "#00b06f11", padding: "5px 8px", display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 24, height: 24, background: "#4f46e5", borderRadius: 2, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 9, color: "white", fontWeight: 700 }}>VIP Pass</div>
              <div style={{ fontSize: 8, color: "#00b06f" }}>1430 R$ · ✓ ВЫБРАН</div>
            </div>
          </div>
        )}
      </div>
    </RCHBrowser>
  );
}

// ── Anim 06 Standard: Pay order ────────────────────────────────────────────────
function Anim06Standard() {
  const [f, setF] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setF(v => (v + 1) % 4), 1600);
    return () => clearInterval(id);
  }, []);
  // 0=confirm page, 1=highlight pay btn, 2=payment redirect, 3=processing

  return (
    <RCHBrowser url="robloxbank.ru/checkout">
      <div style={{ background: "#080c18", padding: "8px 10px" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <div style={{ flex: 1, background: "#0a0f1e", border: "1px solid #1e2a45", padding: "6px 8px" }}>
            <div style={{ fontSize: 8, color: "#666", fontWeight: 700 }}>ПОЛУЧИШЬ</div>
            <div style={{ fontSize: 13, fontWeight: 900, color: "white" }}>1000 R$</div>
          </div>
          <div style={{ flex: 1, background: "#0a0f1e", border: "1px solid #00b06f33", padding: "6px 8px" }}>
            <div style={{ fontSize: 8, color: "#666", fontWeight: 700 }}>К ОПЛАТЕ</div>
            <div style={{ fontSize: 13, fontWeight: 900, color: "#00b06f" }}>550 ₽</div>
          </div>
        </div>
        {f <= 1 && (
          <div style={{
            background: f === 1 ? "#00d084" : "#00b06f",
            color: "white", fontWeight: 700, fontSize: 10,
            padding: "8px", textAlign: "center",
            boxShadow: f === 1 ? "0 0 0 4px #00b06f44" : "none",
            outline: f === 1 ? "2px solid #00b06f" : "none",
            outlineOffset: 1,
            transition: "all 0.3s",
          }}>
            {f === 1 ? "▶ ОПЛАТИТЬ" : "ОПЛАТИТЬ →"}
          </div>
        )}
        {f === 2 && (
          <div style={{ background: "#0a0f1e", border: "1px solid #1e2a45", padding: "8px", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#888" }}>Переход к оплате...</div>
            <div style={{ margin: "4px auto", width: "60%", height: 2, background: "#1e2a45", borderRadius: 1, overflow: "hidden" }}>
              <div style={{ width: "70%", height: "100%", background: "#00b06f", borderRadius: 1 }} />
            </div>
          </div>
        )}
        {f === 3 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", background: "#00b06f11", border: "1px solid #00b06f33" }}>
            <div style={{ fontSize: 14, color: "#00b06f" }}>✓</div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#00b06f" }}>Оплата успешна!</div>
              <div style={{ fontSize: 8, color: "#555" }}>Заказ в обработке · R$ придут через 5–7 дней</div>
            </div>
          </div>
        )}
      </div>
    </RCHBrowser>
  );
}

// ── Anim 05 WB: Copy gamepass link from Creator Hub ────────────────────────────
function Anim05WB() {
  const [f, setF] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setF(v => (v + 1) % 4), 1600);
    return () => clearInterval(id);
  }, []);
  // 0=pass page, 1=click share/address bar, 2=URL selected, 3=copied!

  return (
    <RCHBrowser url={f >= 1 ? "roblox.com/game-pass/1234567/VIP" : "create.roblox.com"}>
      <RCHTopNav />
      <div style={{ display: "flex", background: "#fff", position: "relative" }}>
        <div style={{ width: 108, background: "#f5f5f5", borderRight: "1px solid #e0e0e0", padding: "4px 4px", flexShrink: 0 }}>
          <SItem label="Overview" />
          <SItem label="Game Passes" active />
          <SItem label="Settings" />
        </div>
        <div style={{ flex: 1, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#1a1a1a", marginBottom: 5 }}>VIP Pass</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 7 }}>
            <div style={{ width: 32, height: 32, background: "#4f46e5", borderRadius: 3 }} />
            <div>
              <div style={{ fontSize: 9, color: "#555" }}>Pass ID: 1234567</div>
              <div style={{ fontSize: 9, color: "#22c55e", fontWeight: 700 }}>● For Sale · 1430 R$</div>
            </div>
          </div>
          {/* Address bar highlight */}
          <div style={{
            background: f === 2 ? "#e8f0fe" : "#f5f5f5",
            border: f >= 1 ? "2px solid #0e6fff" : "1px solid #e0e0e0",
            borderRadius: 3, padding: "3px 7px",
            fontSize: 9, color: f === 2 ? "#0e6fff" : "#555",
            fontWeight: f === 2 ? 700 : 400,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            transition: "all 0.3s",
          }}>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              roblox.com/game-pass/1234567/VIP
            </span>
            {f >= 1 && (
              <span style={{
                marginLeft: 6, fontSize: 8, fontWeight: 700, flexShrink: 0,
                color: f === 3 ? "#22c55e" : "#0e6fff",
              }}>
                {f === 3 ? "✓ Copied!" : "Copy"}
              </span>
            )}
          </div>
        </div>
        {/* Cursor */}
        <div style={{ position: "absolute", top: f === 0 ? 55 : 88, left: f === 0 ? 150 : 210, pointerEvents: "none", zIndex: 20, transition: "all 0.45s" }}>
          {f <= 2 && <RCursor />}
        </div>
      </div>
    </RCHBrowser>
  );
}

function Anim06WB() {
  const [f, setF] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setF(v => (v + 1) % 4), 1600);
    return () => clearInterval(id);
  }, []);
  // 0=tg open, 1=pasting link, 2=sending, 3=reply received

  return (
    <div className="mt-4 overflow-hidden border border-[#1e2a45]">
      {/* TG header */}
      <div style={{ background: "#2d2d2d", padding: "5px 8px", display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff5f57" }} />
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ffbd2e" }} />
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#28ca41" }} />
        </div>
        <div style={{ fontSize: 9, color: "#aaa", fontWeight: 600 }}>Telegram · @RobloxBank_PA</div>
      </div>
      {/* Chat area */}
      <div style={{ background: "#17212b", padding: "8px 10px", minHeight: 90, position: "relative" }}>
        <div style={{ fontSize: 8, color: "#666", textAlign: "center", marginBottom: 6 }}>Manager RobloxBank</div>

        {/* Manager message */}
        <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 5 }}>
          <div style={{ background: "#182533", border: "1px solid #1e2a45", borderRadius: "2px 8px 8px 8px", padding: "4px 8px", maxWidth: "75%" }}>
            <div style={{ fontSize: 9, color: "#eee" }}>Привет! Пришли ссылку на геймпасс 👋</div>
            <div style={{ fontSize: 7, color: "#5f6368", marginTop: 2 }}>10:30</div>
          </div>
        </div>

        {/* User message (appears at frame 1+) */}
        {f >= 1 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 5 }}>
            <div style={{ background: "#2b5278", borderRadius: "8px 2px 8px 8px", padding: "4px 8px", maxWidth: "80%", opacity: f === 1 ? 0.7 : 1, transition: "opacity 0.3s" }}>
              <div style={{ fontSize: 9, color: "#eee", wordBreak: "break-all" }}>
                {f === 1 ? "roblox.com/game-pass/1234567…|" : "roblox.com/game-pass/1234567/VIP"}
              </div>
              <div style={{ fontSize: 7, color: "#5f6368", marginTop: 2, textAlign: "right" }}>
                {f >= 2 ? "10:31 ✓✓" : "10:31"}
              </div>
            </div>
          </div>
        )}

        {/* Manager reply */}
        {f >= 3 && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ background: "#182533", border: "1px solid #22c55e33", borderRadius: "2px 8px 8px 8px", padding: "4px 8px", maxWidth: "75%" }}>
              <div style={{ fontSize: 9, color: "#22c55e" }}>✅ Принято! Выкупаем пасс, ожидайте уведомление.</div>
              <div style={{ fontSize: 7, color: "#5f6368", marginTop: 2 }}>10:31</div>
            </div>
          </div>
        )}

        {/* Input area */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "#17212b", borderTop: "1px solid #1e2a45", padding: "4px 8px", display: "flex", gap: 5, alignItems: "center" }}>
          <div style={{ flex: 1, background: "#182533", border: "1px solid #1e2a45", borderRadius: 12, padding: "3px 8px", fontSize: 9, color: f <= 1 ? "#eee" : "#555" }}>
            {f === 0 ? <span style={{ color: "#555" }}>Сообщение…</span> : f === 1 ? "roblox.com/game-pass/…|" : <span style={{ color: "#555" }}>Сообщение…</span>}
          </div>
          <div style={{ width: 22, height: 22, borderRadius: "50%", background: f === 1 ? "#229ED9" : "#1e2a45", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.3s" }}>
            <span style={{ fontSize: 10, color: f === 1 ? "white" : "#555" }}>↑</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const ANIM_MAP: Record<string, () => React.ReactElement> = {
  "01": () => <Anim01 />,
  "02": () => <Anim02 />,
  "03": () => <Anim03 />,
};

// ─── Steps Grid ───────────────────────────────────────────────────────────────

function StepsGrid({
  denomination,
  isWB,
  passPrice,
  onCopyPassPrice,
  priceCopied,
  onPassPriceChange,
}: {
  denomination?: number;
  isWB?: boolean;
  passPrice: number | null;
  onCopyPassPrice: () => void;
  priceCopied: boolean;
  onPassPriceChange: (p: number | null) => void;
}) {
  const steps05 = isWB ? STEPS_WB : STEPS_STANDARD;
  const allSteps = [...STEPS_COMMON, ...steps05];

  const stepsTop    = allSteps.filter(s => ["01","02","03"].includes(s.num));
  const step04      = allSteps.find(s => s.num === "04")!;
  const stepsBottom = allSteps.filter(s => ["05","06"].includes(s.num));

  const renderCard = (step: (typeof allSteps)[0]) => {
        const StepIcon = step.icon;
        const isStep04 = step.num === "04";
        const isStep05WB = isWB && step.num === "05";
        const isStep06WB = isWB && step.num === "06";
        const isStep05Std = !isWB && step.num === "05";
        const isStep06Std = !isWB && step.num === "06";

        // Dynamic warn for step 04
        const dynamicWarn = isStep04 && passPrice
          ? "Убери галочку «Regional Pricing» / «Региональные цены» в настройках пасса — иначе Roblox изменит цену для других регионов."
          : step.warn;

        return (
          <div
            key={step.num}
            className="pixel-card border-2 border-[#1e2a45] hover:border-[#00b06f]/30 transition-colors group p-5 flex flex-col gap-3"
          >
            {/* Header row: icon + step number */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 border-2 border-[#00b06f]/30 bg-[#00b06f]/10 flex items-center justify-center group-hover:border-[#00b06f]/60 group-hover:bg-[#00b06f]/15 transition-colors flex-shrink-0">
                <StepIcon className="w-4 h-4 text-[#00b06f]" />
              </div>
              <span className="font-pixel text-[9px] text-[#00b06f]/40">{step.num}</span>
            </div>

            <div className="space-y-2">
              <h2 className="text-lg font-black uppercase tracking-tight leading-tight">{step.title}</h2>
              <p className="text-sm text-white/90 font-semibold leading-relaxed">{step.desc}</p>
              <p className="text-sm text-zinc-400 font-medium leading-relaxed">{step.detail}</p>

              {step.tip && (
                <div className="flex gap-2 items-start bg-[#00b06f]/5 border border-[#00b06f]/15 px-3 py-2 mt-2">
                  <span className="font-pixel text-[9px] text-[#00b06f] mt-0.5 flex-shrink-0">TIP</span>
                  <p className="text-sm text-[#00b06f]/80 font-bold leading-relaxed">{step.tip}</p>
                </div>
              )}

              {dynamicWarn && !isStep04 && (
                <div className="flex gap-2 items-start border-l-2 border-amber-500/50 pl-3 py-1 mt-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-300/80 font-bold leading-relaxed">{dynamicWarn}</p>
                </div>
              )}

              {/* Step 04: calculator + price copy — fully inline */}
              {isStep04 && (
                <div className="mt-3 space-y-3">
                  {/* Inline formula calculator */}
                  <FormulaCalculator
                    denomination={denomination}
                    isWB={!!isWB}
                    onPassPriceChange={onPassPriceChange}
                  />

                  {/* Price + copy + regional pricing warning */}
                  {passPrice && (
                    <div className="border-2 border-[#00b06f]/25 bg-[#00b06f]/5 px-4 py-3 space-y-2">
                      <div className="font-pixel text-[8px] text-[#00b06f]/50 tracking-widest">УСТАНОВИ ЭТУ ЦЕНУ НА ПАСС</div>
                      {/* Price + inline copy button */}
                      <div className="flex items-center gap-3">
                        <span className="text-3xl font-black text-[#00b06f] tracking-tight">{passPrice} <span className="text-xl">R$</span></span>
                        <button
                          onClick={onCopyPassPrice}
                          className="flex items-center gap-1.5 px-3 py-1.5 border border-[#00b06f]/30 hover:border-[#00b06f]/70 hover:bg-[#00b06f]/10 transition-all group/copy"
                        >
                          {priceCopied
                            ? <Check className="w-3.5 h-3.5 text-[#00b06f]" />
                            : <Copy className="w-3.5 h-3.5 text-[#00b06f]/50 group-hover/copy:text-[#00b06f] transition-all" />
                          }
                          <span className="font-pixel text-[7px] text-[#00b06f]/50 group-hover/copy:text-[#00b06f] transition-all">
                            {priceCopied ? "СКОПИРОВАНО" : "СКОПИРОВАТЬ"}
                          </span>
                        </button>
                      </div>
                      {/* Regional pricing note */}
                      <div className="flex gap-2 items-start pt-1 border-t border-[#00b06f]/10">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-300/70 font-semibold leading-snug">
                          Убери галочку «Enable regional pricing» — иначе Roblox изменит цену для других стран.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step animations */}
              {ANIM_MAP[step.num]?.()}
              {isStep04 && <Anim04Price passPrice={passPrice} />}
              {isStep05WB && <Anim05WB />}
              {isStep06WB && <Anim06WB />}
              {isStep05Std && <Anim05Standard />}
              {isStep06Std && <Anim06Standard />}
            </div>
          </div>
        );
  };

  return (
    <div className="space-y-4">
      {/* Steps 01–03: compact three-column row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stepsTop.map(renderCard)}
      </div>

      {/* Step 04: full width — has embedded calculator */}
      {renderCard(step04)}

      {/* Steps 05–06: two-column row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {stepsBottom.map(renderCard)}
      </div>
    </div>
  );
}

// ─── WB Manager done block ─────────────────────────────────────────────────────

function WBManagerBlock({ denomination }: { denomination?: number }) {
  const passPrice = denomination && denomination > 0 ? Math.ceil(denomination / 0.7) : null;

  return (
    <div className="pixel-card border-2 border-amber-500/30 bg-amber-500/5 p-8 mt-4">
      <div className="text-center mb-8">
        <div className="w-16 h-16 border-2 border-amber-500/40 bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
          <Send className="w-8 h-8 text-amber-400" />
        </div>
        <div className="font-pixel text-[10px] text-amber-500/60 tracking-wider mb-3">ПОСЛЕДНИЙ ШАГ</div>

        {denomination && passPrice ? (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
            <div className="inline-flex items-center gap-3 border border-[#c9a84c]/40 bg-[#c9a84c]/10 px-5 py-3">
              <span className="font-pixel text-[9px] text-[#c9a84c]/60">ПОЛУЧИШЬ</span>
              <span className="text-3xl font-black" style={{ color: "#f0c040" }}>{denomination} R$</span>
            </div>
            <div className="text-amber-500/40 font-black text-xl hidden sm:block">→</div>
            <div className="inline-flex items-center gap-3 border border-amber-500/30 bg-amber-500/10 px-5 py-3">
              <span className="font-pixel text-[9px] text-amber-500/60">ЦЕНА ПАССА</span>
              <span className="text-3xl font-black text-amber-300">{passPrice} R$</span>
            </div>
          </div>
        ) : null}

        <h3 className="text-3xl font-black uppercase tracking-tight text-amber-200 mb-3">
          Отправь ссылку менеджеру
        </h3>
        <p className="text-amber-200/70 font-medium text-base max-w-md mx-auto leading-relaxed">
          Скопируй ссылку на геймпасс и отправь нам — менеджер выкупит пасс
          и пришлёт подтверждение. Robux поступят через 5–7 дней.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-center max-w-sm mx-auto">
        <a
          href="https://t.me/RobloxBank_PA"
          target="_blank" rel="noopener noreferrer"
          className="flex-1 h-14 flex items-center justify-center gap-3 bg-[#229ED9] hover:bg-[#1a8ec9] transition-colors font-black text-[11px] uppercase tracking-widest text-white"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8-1.7 8.02c-.12.55-.46.68-.94.42l-2.6-1.92-1.25 1.21c-.14.14-.26.26-.53.26l.19-2.67 4.85-4.38c.21-.19-.05-.29-.32-.1L7.12 14.4l-2.55-.8c-.55-.17-.56-.55.12-.82l9.97-3.84c.46-.17.86.11.98.86z"/>
          </svg>
          Telegram
        </a>
        <a
          href="https://vk.ru/bankroblox"
          target="_blank" rel="noopener noreferrer"
          className="flex-1 h-14 flex items-center justify-center gap-3 bg-[#0077FF] hover:bg-[#0066ee] transition-colors font-black text-[11px] uppercase tracking-widest text-white"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M15.684 0H8.316C1.592 0 0 1.592 0 8.316v7.368C0 22.408 1.592 24 8.316 24h7.368C22.408 24 24 22.408 24 15.684V8.316C24 1.592 22.408 0 15.684 0zm3.692 17.123h-1.744c-.66 0-.864-.525-2.05-1.727-1.033-1-1.49-1.135-1.744-1.135-.356 0-.458.102-.458.593v1.575c0 .424-.135.678-1.253.678-1.846 0-3.896-1.118-5.335-3.202C4.624 10.857 4.03 8.57 4.03 8.096c0-.254.102-.491.593-.491h1.744c.44 0 .61.203.78.677.863 2.49 2.303 4.675 2.896 4.675.22 0 .322-.102.322-.66V9.721c-.068-1.186-.695-1.287-.695-1.71 0-.203.169-.407.44-.407h2.744c.373 0 .508.203.508.643v3.473c0 .372.169.508.271.508.22 0 .407-.136.813-.542 1.253-1.406 2.151-3.574 2.151-3.574.119-.254.322-.491.762-.491h1.744c.525 0 .644.27.525.643-.22 1.017-2.354 4.031-2.354 4.031-.186.305-.254.44 0 .78.186.254.796.779 1.203 1.253.745.847 1.32 1.558 1.473 2.05.17.49-.085.745-.576.745z"/>
          </svg>
          ВКонтакте
        </a>
      </div>

      <div className="flex items-center justify-center gap-2 mt-6">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500/50" />
        <p className="text-amber-500/50 text-xs font-black uppercase tracking-widest">
          Не удаляй геймпасс до подтверждения · Среднее время ответа — 10 минут
        </p>
      </div>
    </div>
  );
}

function StandardDoneBlock() {
  return (
    <div className="pixel-card border-2 border-[#00b06f]/40 bg-[#00b06f]/5 p-6 mt-4 flex flex-col sm:flex-row items-center gap-5">
      <div className="w-14 h-14 bg-[#00b06f]/20 border-2 border-[#00b06f]/30 flex items-center justify-center flex-shrink-0">
        <CheckCircle2 className="w-7 h-7 text-[#00b06f]" />
      </div>
      <div className="text-center sm:text-left space-y-1">
        <p className="font-pixel text-[10px] text-[#00b06f]">ГОТОВО!</p>
        <p className="font-black uppercase tracking-tight text-lg">Геймпасс создан — оформляй заказ</p>
        <p className="text-sm text-zinc-400 font-medium">Найди пасс по нику, ссылке или ID — и оплати</p>
      </div>
      <Link
        href="/checkout"
        className="ml-auto h-12 px-8 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none flex items-center gap-2 flex-shrink-0"
      >
        Купить R$ <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

// ─── WB Gate Screen ────────────────────────────────────────────────────────────

interface WBGateProps {
  onSuccess: (denomination: number) => void;
}

function WBGate({ onSuccess }: WBGateProps) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 7);
    setCode(raw);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < 7) {
      setError("Введите полный 7-значный код с карточки");
      inputRef.current?.focus();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wb-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Ошибка отправки");
      const denomination = data.denomination ?? 0;
      saveWBSession(denomination);
      onSuccess(denomination);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Неизвестная ошибка";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 flex items-center justify-center px-4 py-16 bg-[#080c18]">
        <div className="fixed inset-0 opacity-[0.02] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(201,168,76,0.8) 1px, transparent 1px),
                              linear-gradient(90deg, rgba(201,168,76,0.8) 1px, transparent 1px)`,
            backgroundSize: "40px 40px",
          }}
        />
        <div className="w-full max-w-md animate-in fade-in zoom-in">
          <div className="pixel-card border-2 border-[#c9a84c]/40 bg-[#0a0c14] p-8 sm:p-10 space-y-8 relative">
            <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-[#c9a84c]/60" />
            <div className="absolute bottom-0 right-0 w-12 h-12 border-b-2 border-r-2 border-[#c9a84c]/60" />

            <div className="text-center space-y-4 animate-in fade-in zoom-in animate-delay-100">
              <div className="w-16 h-16 border-2 border-[#c9a84c]/50 bg-[#c9a84c]/10 flex items-center justify-center mx-auto">
                <Ticket className="w-8 h-8 text-[#c9a84c]" />
              </div>
              <div>
                <div className="font-pixel text-[9px] text-[#c9a84c]/50 tracking-widest mb-3">
                  WILDBERRIES × ROBLOXBANK
                </div>
                <h1 className="text-2xl font-black uppercase tracking-tight leading-tight text-white">
                  Благодарим за покупку<br />
                  <span style={{ color: "#f0c040" }}>в RobloxBank!</span>
                </h1>
              </div>
              <p className="text-zinc-400 font-medium text-base leading-relaxed">
                Для активации номинала введите уникальный&nbsp;код с&nbsp;карточки.
              </p>
            </div>

            <div className="h-px bg-gradient-to-r from-transparent via-[#c9a84c]/30 to-transparent" />

            <form onSubmit={handleSubmit} className="space-y-5 animate-in fade-in zoom-in animate-delay-200">
              <div className="space-y-2">
                <label className="font-pixel text-[9px] text-[#c9a84c]/60 tracking-widest flex items-center gap-2">
                  <Lock className="w-3 h-3" />КОД С КАРТОЧКИ
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  value={code}
                  onChange={handleInput}
                  placeholder="XXXXXXX"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  className="wb-input"
                  aria-label="Уникальный код с карточки"
                />
                <div className="flex justify-between items-center">
                  <p className="text-[11px] text-zinc-600 font-medium">
                    Код напечатан на карточке в заказе
                  </p>
                  <span className={`text-[11px] font-black tabular-nums ${code.length === 7 ? "text-[#c9a84c]" : "text-zinc-600"}`}>
                    {code.length}/7
                  </span>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 border border-red-500/30 bg-red-500/5 px-3 py-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-400 font-medium">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || code.length < 7}
                className="w-full h-14 flex items-center justify-center gap-3 font-black text-[12px] uppercase tracking-widest text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: loading || code.length < 7
                    ? "linear-gradient(135deg, #4a3a10, #2a2008)"
                    : "linear-gradient(135deg, #c9a84c 0%, #f0c040 50%, #c9a84c 100%)",
                  color: loading || code.length < 7 ? "#888" : "#0a0c14",
                }}
              >
                {loading ? (
                  <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />Проверяем...</>
                ) : (
                  <><Send className="w-4 h-4" />Получить инструкцию</>
                )}
              </button>
            </form>

            <p className="text-center text-[11px] text-zinc-600 font-medium animate-in fade-in zoom-in animate-delay-300">
              Код одноразовый · Хранить не нужно
            </p>
          </div>

          <div className="flex items-center justify-center gap-6 mt-6 animate-in fade-in zoom-in animate-delay-300">
            {[
              { label: "Защита данных",  icon: Lock },
              { label: "Ручная выдача",  icon: CheckCircle2 },
              { label: "Поддержка 24/7", icon: ShoppingBag },
            ].map(({ label, icon: Icon }) => (
              <div key={label} className="flex items-center gap-1.5 text-zinc-600">
                <Icon className="w-3.5 h-3.5" />
                <span className="text-[11px] font-black uppercase tracking-wide">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── WB-only static header ─────────────────────────────────────────────────────

function WBStaticHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#c9a84c]/10 bg-[#0a0e1a]/95 backdrop-blur-xl pointer-events-none select-none">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative w-9 h-9 flex-shrink-0">
            <div className="absolute inset-0 bg-[#c9a84c] rounded-[4px]" />
            <div className="absolute top-0 right-0 w-2 h-2 bg-[#0a0e1a] rounded-none" />
            <div className="absolute bottom-0 left-0 w-2 h-2 bg-[#0a0e1a] rounded-none" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[#0a0e1a] font-black text-[11px] tracking-wider relative z-10">WB</span>
            </div>
          </div>
          <div className="hidden sm:flex flex-col leading-none">
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white">Wildberries</span>
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[#c9a84c]">× RobloxBank</span>
          </div>
        </div>
        <div className="font-pixel text-[9px] text-[#c9a84c]/50 tracking-widest">ИНСТРУКЦИЯ ПО ПОЛУЧЕНИЮ</div>
      </div>
      <div className="h-[2px] bg-gradient-to-r from-transparent via-[#c9a84c]/30 to-transparent" />
    </header>
  );
}

// ─── Interactive Formula Calculator ──────────────────────────────────────────

function FormulaCalculator({
  denomination,
  isWB,
  onPassPriceChange,
}: {
  denomination?: number;
  isWB: boolean;
  onPassPriceChange: (p: number | null) => void;
}) {
  const [wantedRobux, setWantedRobux] = useState<string>(
    denomination && denomination > 0 ? String(denomination) : "1000"
  );

  const numVal  = Math.max(0, parseInt(wantedRobux) || 0);
  const calcPrice = numVal > 0 ? Math.ceil(numVal / 0.7) : null;

  useEffect(() => {
    onPassPriceChange(calcPrice);
  }, [calcPrice]);

  // If WB with known denomination — show static (no editing)
  if (isWB && denomination && denomination > 0) {
    const fixedPrice = Math.ceil(denomination / 0.7);
    return (
      <div className="pixel-card border-2 border-[#00b06f]/30 bg-[#00b06f]/5 p-5">
        <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-3">ГЛАВНАЯ ФОРМУЛА</div>
        <div className="flex items-center gap-4 mb-3">
          <div className="text-center">
            <div className="text-3xl font-black" style={{ color: "#f0c040" }}>{denomination}</div>
            <div className="text-xs text-zinc-500 uppercase tracking-widest font-black">Твой номинал</div>
          </div>
          <div className="text-zinc-600 font-black text-2xl">÷ 0.7 =</div>
          <div className="text-center">
            <div className="text-3xl font-black text-[#00b06f]">{fixedPrice}</div>
            <div className="text-xs text-zinc-500 uppercase tracking-widest font-black">Цена пасса</div>
          </div>
        </div>
        <div className="font-pixel text-[9px] text-[#c9a84c]/60 border border-[#c9a84c]/20 bg-[#c9a84c]/5 px-3 py-2 text-center">
          Установи именно эту цену на геймпасс
        </div>
      </div>
    );
  }

  // Standard — interactive calculator
  return (
    <div className="pixel-card border-2 border-[#00b06f]/30 bg-[#00b06f]/5 p-5">
      <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-4">КАЛЬКУЛЯТОР ЦЕНЫ ПАССА</div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        {/* Input */}
        <div className="flex-1 space-y-1">
          <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Хочу получить (R$)</div>
          <div className="relative">
            <input
              type="number"
              min="0"
              value={wantedRobux}
              onChange={(e) => setWantedRobux(e.target.value)}
              className="w-full h-12 bg-[#080c18] border-2 border-[#1e2a45] focus:border-[#00b06f]/60 px-3 text-xl font-black outline-none transition-all text-white"
              placeholder="1000"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 font-bold">R$</span>
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center justify-center sm:flex-col gap-1 sm:gap-0 py-1">
          <div className="text-zinc-600 font-black text-lg">÷ 0.7 =</div>
        </div>

        {/* Result */}
        <div className="flex-1 space-y-1">
          <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Цена пасса (R$)</div>
          <div className="h-12 bg-[#080c18] border-2 border-[#00b06f]/30 px-3 flex items-center justify-between">
            <span className="text-xl font-black text-[#00b06f]">
              {calcPrice ?? "—"}
            </span>
            <span className="text-xs text-zinc-500 font-bold">R$</span>
          </div>
        </div>
      </div>

      {calcPrice && (
        <div className="mt-3 flex items-center gap-3 border border-[#00b06f]/20 bg-[#00b06f]/5 px-4 py-3">
          <div className="w-6 h-6 rounded-none bg-[#00b06f]/15 border border-[#00b06f]/30 flex items-center justify-center flex-shrink-0">
            <span className="text-[#00b06f] text-xs font-black">↓</span>
          </div>
          <p className="text-sm font-black text-white/80 leading-snug">
            Установи цену <span className="text-[#00b06f]">{calcPrice} R$</span> на геймпасс —
            в шаге <span className="text-white">04</span> появится кнопка «Скопировать»
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Instruction page ──────────────────────────────────────────────────────────

function Instruction({ isWB, denomination }: { isWB: boolean; denomination?: number }) {
  const [passPrice, setPassPrice] = useState<number | null>(
    denomination && denomination > 0 ? Math.ceil(denomination / 0.7) : null
  );
  const [priceCopied, setPriceCopied] = useState(false);

  const handleCopyPassPrice = useCallback(() => {
    if (!passPrice) return;
    navigator.clipboard.writeText(String(passPrice)).then(() => {
      setPriceCopied(true);
      setTimeout(() => setPriceCopied(false), 2000);
    }).catch(() => {
      // Fallback for older browsers
      const el = document.createElement("textarea");
      el.value = String(passPrice);
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setPriceCopied(true);
      setTimeout(() => setPriceCopied(false), 2000);
    });
  }, [passPrice]);

  return (
    <main className="min-h-screen">
      {isWB ? <WBStaticHeader /> : <Navbar />}

      {/* ── HERO ── */}
      <section className="border-b border-[#1e2a45] bg-[#080c18]">
        <div className="container mx-auto px-6 py-16 max-w-6xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            {/* Left: headline */}
            <div className="space-y-6">
              {isWB && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-amber-500/30 bg-amber-500/5">
                  <ShoppingBag className="w-3.5 h-3.5 text-amber-400" />
                  <span className="font-pixel text-[9px] text-amber-400/80 tracking-widest">WILDBERRIES</span>
                </div>
              )}
              <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider">TUTORIAL</div>
              <h1 className="text-6xl md:text-7xl font-black uppercase tracking-[-0.04em] leading-[0.85]">
                Как создать<br />
                <span className="gold-text">геймпасс</span>
              </h1>
              <p className="text-zinc-300 font-medium leading-relaxed text-lg max-w-md">
                Геймпасс — способ получить Robux через наш сервис.
                Создаётся за <span className="text-white font-black">5 минут</span> прямо в браузере.
              </p>
              <div className="flex flex-wrap gap-3">
                {isWB ? (
                  <a
                    href="https://t.me/RobloxBank_PA"
                    target="_blank" rel="noopener noreferrer"
                    className="h-12 px-7 font-black text-[11px] uppercase tracking-widest text-[#0a0c14] hover:opacity-90 transition-all rounded-none flex items-center gap-2"
                    style={{ background: "linear-gradient(135deg, #c9a84c, #f0c040)" }}
                  >
                    Связаться с менеджером <ArrowRight className="w-4 h-4" />
                  </a>
                ) : (
                  <Link
                    href="/checkout"
                    className="h-12 px-7 gold-gradient font-black text-[11px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none flex items-center gap-2"
                  >
                    Оформить заказ <ArrowRight className="w-4 h-4" />
                  </Link>
                )}
                <a
                  href="https://create.roblox.com"
                  target="_blank" rel="noopener noreferrer"
                  className="h-12 px-7 border-2 border-[#1e2a45] hover:border-[#00b06f]/30 font-black text-[11px] uppercase tracking-widest transition-all rounded-none flex items-center gap-2 text-zinc-300"
                >
                  Creator Hub <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* Right: stats + warning + calculator */}
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Время",     value: "5 мин" },
                  { label: "Сложность", value: "Легко" },
                  { label: "Комиссия",  value: "0 ₽"   },
                  { label: "Шагов",     value: "6"     },
                ].map(({ label, value }) => (
                  <div key={label} className="pixel-card border-2 border-[#1e2a45] p-4 text-center space-y-2">
                    <div className="font-pixel text-[11px] text-[#00b06f]">{value}</div>
                    <div className="text-xs font-black text-zinc-400 uppercase tracking-wider">{label}</div>
                  </div>
                ))}
              </div>

              <div className="border-2 border-amber-500/30 bg-amber-500/5 p-5 flex gap-4">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-black text-amber-400 uppercase tracking-widest">Важно</p>
                  <p className="text-base text-amber-200/70 font-medium leading-relaxed">
                    После оплаты — <strong className="text-amber-300">не удаляй геймпасс и не меняй цену</strong>{" "}
                    до уведомления о завершении заказа.
                  </p>
                </div>
              </div>

              {/* Quick checklist */}
              <div className="border-2 border-[#1e2a45] bg-[#080c18] p-5 space-y-2">
                <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-3">ЧТО ПОНАДОБИТСЯ</div>
                {[
                  "Аккаунт Roblox (любой уровень)",
                  "Браузер — создаём прямо на сайте",
                  "5 минут свободного времени",
                  "Калькулятор цены — в шаге 04",
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-4 h-4 border border-[#00b06f]/40 bg-[#00b06f]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[#00b06f] text-[8px] font-black">{i + 1}</span>
                    </div>
                    <span className="text-sm font-medium text-zinc-300 leading-snug">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="accent-line" />

      {/* ── STEPS ── */}
      <section className="container mx-auto px-6 py-16 max-w-6xl">
        <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-8">ПОШАГОВАЯ ИНСТРУКЦИЯ</div>
        <StepsGrid
          denomination={denomination}
          isWB={isWB}
          passPrice={passPrice}
          onCopyPassPrice={handleCopyPassPrice}
          priceCopied={priceCopied}
          onPassPriceChange={setPassPrice}
        />
        {isWB ? <WBManagerBlock denomination={denomination} /> : <StandardDoneBlock />}
      </section>

      {/* WB: no extra sections */}
      {!isWB && (
        <>
          <div className="accent-line" />

          {/* ── MISTAKES + TABLE ── */}
          <section className="container mx-auto px-6 py-16 max-w-6xl">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
              <div>
                <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-2">ЧАСТЫЕ ОШИБКИ</div>
                <h2 className="text-4xl font-black uppercase tracking-tight mb-6">Чего не делать</h2>
                <div className="space-y-2">
                  {MISTAKES.map(({ wrong, right }) => (
                    <div key={wrong} className="pixel-card border-2 border-[#1e2a45] p-5">
                      <div className="flex gap-3 items-start mb-3">
                        <div className="w-6 h-6 border border-red-500/40 bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-red-400 text-sm font-black leading-none">✕</span>
                        </div>
                        <p className="text-base text-red-400/80 font-medium">{wrong}</p>
                      </div>
                      <div className="flex gap-3 items-start border-t border-[#1e2a45] pt-3">
                        <div className="w-6 h-6 border border-[#00b06f]/40 bg-[#00b06f]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-[#00b06f] text-sm font-black leading-none">✓</span>
                        </div>
                        <p className="text-base text-[#00b06f]/80 font-medium">{right}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-2">PRICE TABLE</div>
                <h2 className="text-4xl font-black uppercase tracking-tight mb-2">Таблица цен</h2>
                <p className="text-base text-zinc-500 font-medium mb-5">Цена пасса с учётом 30% комиссии Roblox.</p>
                <div className="pixel-card border-2 border-[#1e2a45] overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b-2 border-[#1e2a45] bg-[#080c18]">
                        <th className="text-left px-5 py-4 text-xs font-black text-zinc-400 uppercase tracking-wider">Получишь</th>
                        <th className="text-left px-5 py-4 text-xs font-black text-zinc-400 uppercase tracking-wider">Цена пасса</th>
                        <th className="text-left px-5 py-4 text-xs font-black text-zinc-400 uppercase tracking-wider">Стоимость</th>
                      </tr>
                    </thead>
                    <tbody>
                      {TABLE.map(([get, price, rub]) => (
                        <tr key={get} className="border-b border-[#1e2a45]/40 hover:bg-[#00b06f]/3 transition-colors">
                          <td className="px-5 py-3.5 font-black text-[#00b06f] text-base">{get} R$</td>
                          <td className="px-5 py-3.5 font-bold text-white text-base">{price} R$</td>
                          <td className="px-5 py-3.5 font-bold text-zinc-400 text-base">{rub}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-5 py-3.5 bg-[#080c18] border-t border-[#1e2a45] flex items-center gap-3">
                    <span className="font-pixel text-[9px] text-[#00b06f] border border-[#00b06f]/20 bg-[#00b06f]/10 px-2 py-1">ФОРМУЛА</span>
                    <span className="text-sm font-bold text-zinc-300">цена пасса = нужная сумма ÷ 0.7</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="accent-line" />

          {/* ── FAQ ── */}
          <section className="container mx-auto px-6 py-16 max-w-6xl">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
              <div className="space-y-6">
                <div>
                  <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-2">FAQ</div>
                  <h2 className="text-4xl font-black uppercase tracking-tight">Частые вопросы</h2>
                </div>
                <p className="text-zinc-400 text-base font-medium leading-relaxed">
                  Не нашёл ответа? Напиши нам в Telegram — ответим в течение 10 минут.
                </p>
                <div className="space-y-2">
                  <a
                    href="https://create.roblox.com"
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-between p-5 pixel-card border-2 border-[#1e2a45] hover:border-[#00b06f]/30 transition-colors group"
                  >
                    <div>
                      <p className="font-pixel text-[9px] text-zinc-500 tracking-wider">OFFICIAL</p>
                      <p className="font-black uppercase text-base">Creator Hub</p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-zinc-500 group-hover:text-[#00b06f] transition-colors" />
                  </a>
                  <Link
                    href="/checkout"
                    className="flex items-center justify-between p-5 pixel-card border-2 border-[#00b06f]/20 bg-[#00b06f]/5 hover:border-[#00b06f]/40 transition-colors group"
                  >
                    <div>
                      <p className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">READY?</p>
                      <p className="font-black uppercase text-base">Купить Robux</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-[#00b06f]" />
                  </Link>
                </div>
              </div>

              <div className="lg:col-span-2 space-y-2">
                {FAQ.map((item) => (
                  <details
                    key={item.q}
                    className="pixel-card border-2 border-[#1e2a45] hover:border-[#00b06f]/20 transition-colors group"
                  >
                    <summary className="px-6 py-5 cursor-pointer flex items-center justify-between gap-3 list-none">
                      <h3 className="font-black uppercase tracking-tight text-base">{item.q}</h3>
                      <ChevronRight className="w-4 h-4 text-zinc-500 flex-shrink-0 group-open:rotate-90 transition-transform duration-200" />
                    </summary>
                    <div className="px-6 pb-5 border-t border-[#1e2a45]">
                      <p className="text-base text-zinc-300 font-medium leading-relaxed pt-4">{item.a}</p>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {!isWB && (
        <section className="border-t border-[#1e2a45] py-8">
          <div className="container mx-auto px-6 max-w-6xl flex justify-center">
            <Link
              href="/"
              className="h-12 px-8 border-2 border-[#1e2a45] hover:border-[#00b06f]/30 font-black text-[11px] uppercase tracking-widest transition-all rounded-none flex items-center gap-2 text-zinc-400 hover:text-white"
            >
              <ArrowRight className="w-4 h-4 rotate-180" />
              На главную к калькулятору
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────

export default function GuideClient({ isWB }: { isWB: boolean }) {
  const [phase, setPhase] = useState<"gate" | "instruction">(
    isWB ? "gate" : "instruction"
  );
  const [denomination, setDenomination] = useState<number>(0);

  // Restore WB session from localStorage on mount
  useEffect(() => {
    if (!isWB) return;
    const saved = loadWBSession();
    if (saved !== null) {
      setDenomination(saved);
      setPhase("instruction");
    }
  }, [isWB]);

  if (phase === "gate") {
    return (
      <WBGate
        onSuccess={(d) => {
          saveWBSession(d);
          setDenomination(d);
          setPhase("instruction");
        }}
      />
    );
  }

  return <Instruction isWB={isWB} denomination={denomination} />;
}
