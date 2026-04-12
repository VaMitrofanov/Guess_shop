"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import Navbar from "@/components/navbar";
import {
  AlertTriangle, CheckCircle2, ExternalLink, ArrowRight, ChevronRight,
  Globe, Gamepad2, Ticket, Tag, Link2, ShoppingCart,
  Lock, Send, ShoppingBag, Copy, Check, Search, CreditCard,
} from "lucide-react";
import { ParticleTextEffect } from "@/components/ui/particle-text-effect";
import VKAuthButton from "@/components/auth/VKAuthButton";

// ─── localStorage WB session helpers ──────────────────────────────────────────
const WB_SESSION_KEY = "rb_wb_session";
const WB_SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

interface WBSession {
  denomination: number;
  code: string;
  ts: number;
}

function saveWBSession(denomination: number, code: string) {
  try {
    localStorage.setItem(WB_SESSION_KEY, JSON.stringify({ denomination, code, ts: Date.now() } satisfies WBSession));
  } catch {}
}

function loadWBSession(): { denomination: number; code: string } | null {
  try {
    const raw = localStorage.getItem(WB_SESSION_KEY);
    if (!raw) return null;
    const { denomination, code, ts } = JSON.parse(raw) as WBSession;
    if (Date.now() - ts > WB_SESSION_TTL) {
      localStorage.removeItem(WB_SESSION_KEY);
      return null;
    }
    return denomination > 0 ? { denomination, code: code ?? "" } : null;
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
    detail: "Roblox удерживает 30% с каждой продажи. Поэтому цена пасса должна быть выше суммы, которую ты хочешь получить. Используй калькулятор ниже — он поможет посчитать цену геймпасса.",
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
    const id = setInterval(() => setF(v => (v + 1) % 4), 1700);
    return () => clearInterval(id);
  }, []);
  // f=0: typing URL, f=1: loading, f=2: page shown cursor at btn, f=3: Creations active in nav

  const showPage = f >= 2;

  return (
    <>
    <div style={{
      marginTop: 12, overflow: "hidden", border: "1px solid #2a2a2a",
      background: "#111", fontSize: 10, userSelect: "none", position: "relative",
    }}>
      {/* Mac chrome */}
      <div style={{ background: "#1c1c1c", padding: "5px 10px", display: "flex", alignItems: "center", gap: 5, borderBottom: "1px solid #2a2a2a" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["#ff5f57","#febc2e","#28c840"] as string[]).map((c,i) => (
            <div key={i} style={{ width:8, height:8, borderRadius:"50%", background:c }} />
          ))}
        </div>
        <div style={{ flex:1, height:14, background:"#2d2d2d", borderRadius:3, marginLeft:6, display:"flex", alignItems:"center", paddingLeft:8, overflow:"hidden" }}>
          <span style={{ color: f<=1 ? "#eee" : "#888", fontSize:8, fontFamily:"monospace" }}>
            {f===0 ? "create.rob|" : "create.roblox.com"}
          </span>
        </div>
      </div>

      {/* Body */}
      {!showPage ? (
        <div style={{ background:"#111", minHeight:124, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8 }}>
          <div style={{ color:"#333", fontSize:9 }}>Загрузка create.roblox.com...</div>
          <div style={{ width:90, height:2, background:"#222", overflow:"hidden", borderRadius:1 }}>
            <div style={{ width: f===1 ? "70%" : "15%", height:"100%", background:"#0e6fff", transition:"width 1.4s ease" }} />
          </div>
        </div>
      ) : (
        <div style={{ display:"flex", minHeight:124 }}>
          {/* Icon sidebar */}
          <div style={{ width:40, background:"#181818", borderRight:"1px solid #252525", display:"flex", flexDirection:"column", alignItems:"center", paddingTop:8, gap:3, flexShrink:0 }}>
            <div style={{ width:22, height:22, background:"#e32f4a", borderRadius:3, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:3 }}>
              <span style={{ color:"white", fontWeight:900, fontSize:10 }}>R</span>
            </div>
            {(["⌂","✦","◈","⊞"] as string[]).map((ic,i) => (
              <div key={i} style={{ width:26, height:20, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <span style={{ fontSize:8, color:"#333" }}>{ic}</span>
              </div>
            ))}
          </div>
          {/* Text nav */}
          <div style={{ width:100, background:"#1a1a1a", borderRight:"1px solid #252525", paddingTop:8, flexShrink:0 }}>
            <div style={{ padding:"0 8px 6px", fontSize:7, color:"#444", fontWeight:700, letterSpacing:"0.08em" }}>НАВИГАЦИЯ</div>
            {([
              { label:"Dashboard", active: f===2 },
              { label:"Creations", active: f===3 },
              { label:"Marketplace", active: false },
              { label:"Community",  active: false },
            ] as {label:string; active:boolean}[]).map(it => (
              <div key={it.label} style={{
                padding:"5px 10px", fontSize:8,
                color: it.active ? "#fff" : "#555",
                background: it.active ? "#242424" : "transparent",
                borderLeft: it.active ? "2px solid #4a9eff" : "2px solid transparent",
                fontWeight: it.active ? 700 : 400,
              }}>{it.label}</div>
            ))}
          </div>
          {/* Content */}
          <div style={{ flex:1, background:"#111", padding:"10px 12px", position:"relative" }}>
            <div style={{ fontSize:12, fontWeight:800, color:"#eee", marginBottom:5 }}>Creator Hub</div>
            <div style={{ fontSize:8, color:"#555", marginBottom:10 }}>Build and monetize your Roblox experiences.</div>
            <div style={{
              display:"inline-flex", alignItems:"center", gap:4,
              background: f===3 ? "#0a55d4" : "#0e6fff",
              color:"white", fontWeight:700, fontSize:9,
              padding:"4px 10px", borderRadius:3,
              boxShadow: f===2 ? "0 0 0 3px #0e6fff55" : "none",
              transition:"all 0.3s",
            }}>
              {f===3 && "→ "}Creations
            </div>
          </div>

          {/* Cursor — absolute over entire body */}
          <div style={{
            position:"absolute",
            top:  f===2 ? 69 : 63,
            left: f===2 ? 152 : 47,
            pointerEvents:"none", zIndex:20,
            transition:"top 0.45s cubic-bezier(0.4,0,0.2,1), left 0.45s cubic-bezier(0.4,0,0.2,1)",
          }}>
            <RCursor />
          </div>
        </div>
      )}
    </div>
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
  // f=0: My Creations grid, f=1: hover game card, f=2: hover Create btn, f=3: modal open

  const games = [
    { name: "My Game",    color: "#4f46e5" },
    { name: "Test Place", color: "#0891b2" },
  ];

  return (
    <div style={{
      marginTop: 12, overflow: "hidden", border: "1px solid #2a2a2a",
      background: "#111", fontSize: 10, userSelect: "none", position: "relative",
    }}>
      {/* Mac chrome */}
      <div style={{ background: "#1c1c1c", padding: "5px 10px", display: "flex", alignItems: "center", gap: 5, borderBottom: "1px solid #2a2a2a" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["#ff5f57","#febc2e","#28c840"] as string[]).map((c,i) => (
            <div key={i} style={{ width:8, height:8, borderRadius:"50%", background:c }} />
          ))}
        </div>
        <div style={{ flex:1, height:14, background:"#2d2d2d", borderRadius:3, marginLeft:6, display:"flex", alignItems:"center", paddingLeft:8 }}>
          <span style={{ color:"#888", fontSize:8 }}>create.roblox.com/creations</span>
        </div>
      </div>

      <div style={{ display:"flex", minHeight:124 }}>
        {/* Icon sidebar */}
        <div style={{ width:40, background:"#181818", borderRight:"1px solid #252525", display:"flex", flexDirection:"column", alignItems:"center", paddingTop:8, gap:3, flexShrink:0 }}>
          <div style={{ width:22, height:22, background:"#e32f4a", borderRadius:3, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:3 }}>
            <span style={{ color:"white", fontWeight:900, fontSize:10 }}>R</span>
          </div>
          {(["⌂","✦","◈","⊞"] as string[]).map((ic,i) => (
            <div key={i} style={{ width:26, height:20, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <span style={{ fontSize:8, color: i===0 ? "#4a9eff" : "#333" }}>{ic}</span>
            </div>
          ))}
        </div>
        {/* Text nav */}
        <div style={{ width:100, background:"#1a1a1a", borderRight:"1px solid #252525", paddingTop:8, flexShrink:0 }}>
          <div style={{ padding:"0 8px 6px", fontSize:7, color:"#444", fontWeight:700, letterSpacing:"0.08em" }}>НАВИГАЦИЯ</div>
          {([
            { label:"Dashboard",   active:false },
            { label:"Creations",   active:true  },
            { label:"Marketplace", active:false },
          ] as {label:string;active:boolean}[]).map(it => (
            <div key={it.label} style={{
              padding:"5px 10px", fontSize:8,
              color: it.active ? "#fff" : "#555",
              background: it.active ? "#242424" : "transparent",
              borderLeft: it.active ? "2px solid #4a9eff" : "2px solid transparent",
              fontWeight: it.active ? 700 : 400,
            }}>{it.label}</div>
          ))}
        </div>
        {/* Content */}
        <div style={{ flex:1, background:"#111", padding:"8px 10px", position:"relative" }}>
          {/* Header */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#eee" }}>My Creations</div>
            <div style={{
              fontSize:8, fontWeight:700, color:"white",
              background: f===2 ? "#0a55d4" : "#0e6fff",
              padding:"3px 7px", borderRadius:3,
              boxShadow: f===2 ? "0 0 0 3px #0e6fff44" : "none",
              transition:"all 0.3s",
            }}>+ Create</div>
          </div>
          {/* Games grid */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
            {games.map((g,i) => (
              <div key={i} style={{
                background:"#1a1a1a",
                border: (f===1 && i===0) ? "1.5px solid #4a9eff" : "1px solid #252525",
                borderRadius:3, overflow:"hidden",
                boxShadow: (f===1 && i===0) ? "0 0 0 2px #4a9eff22" : "none",
                transition:"all 0.3s",
              }}>
                <div style={{ height:24, background:g.color, opacity:0.9 }} />
                <div style={{ padding:"3px 5px" }}>
                  <div style={{ fontSize:8, fontWeight:700, color:"#ddd" }}>{g.name}</div>
                  <div style={{ fontSize:7, color:"#555", marginTop:1 }}>Private · 0 visits</div>
                </div>
              </div>
            ))}
          </div>

          {/* Create modal */}
          {f===3 && (
            <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:10 }}>
              <div style={{ background:"#1c1c1c", border:"1px solid #333", borderRadius:6, padding:"10px 12px", width:"80%", boxShadow:"0 8px 32px rgba(0,0,0,0.5)" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#eee", marginBottom:6 }}>Create New Experience</div>
                <div style={{ fontSize:7, color:"#666", marginBottom:3 }}>Experience Name</div>
                <div style={{ border:"2px solid #4a9eff", borderRadius:3, padding:"4px 7px", fontSize:9, color:"#eee", background:"#111" }}>
                  My Game<span style={{ borderLeft:"1.5px solid #eee", marginLeft:1 }}>&nbsp;</span>
                </div>
                <div style={{ display:"flex", justifyContent:"flex-end", gap:5, marginTop:8 }}>
                  <div style={{ fontSize:8, fontWeight:600, color:"#666", background:"#252525", borderRadius:3, padding:"3px 8px" }}>Cancel</div>
                  <div style={{ fontSize:8, fontWeight:700, color:"white", background:"#0e6fff", borderRadius:3, padding:"3px 8px" }}>Create</div>
                </div>
              </div>
            </div>
          )}

          {/* Cursor */}
          <div style={{
            position:"absolute",
            top:  f===0 ? 52 : f===1 ? 52 : f===2 ? 8 : 52,
            left: f===0 ? 10 : f===1 ? 10 : f===2 ? 118 : 10,
            pointerEvents:"none", zIndex:20,
            transition:"top 0.4s cubic-bezier(0.4,0,0.2,1), left 0.4s cubic-bezier(0.4,0,0.2,1)",
          }}>
            {f <= 2 && <RCursor />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Anim 03: Create a Game Pass ────────────────────────────────────────────────
function Anim03() {
  const [f, setF] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setF(v => (v + 1) % 6), 1550);
    return () => clearInterval(id);
  }, []);
  // f=0: Overview, f=1: click Monetization, f=2: Game Passes sub shown,
  // f=3: click "+ Create", f=4: modal typing "VIP", f=5: Save highlighted

  const monoExpanded = f >= 2;
  const showModal    = f >= 4;
  const typedName    = f >= 4 ? (f === 4 ? "VIP|" : "VIP") : "";
  const saveHL       = f === 5;

  // Cursor positions (absolute within the animation container)
  // Chrome: 24px. Nav item height ~18px each, paddingTop:8, header:13px
  // Item tops: Overview=45, BasicSettings=63, Monetization=81, GamePasses(sub)=99+12=111
  // Content starts at x=140, y=24. Padding 8px → first content y=32
  // Create btn: y=32+15+4=51. Modal input: y~80. Save: y~110
  const cursorTop  = [45, 81, 111, 51, 80, 110][f];
  const cursorLeft = [47, 47,  55,152,152, 175][f];

  return (
    <div style={{
      marginTop: 12, overflow: "hidden", border: "1px solid #2a2a2a",
      background: "#111", fontSize: 10, userSelect: "none", position: "relative",
    }}>
      {/* Mac chrome */}
      <div style={{ background: "#1c1c1c", padding: "5px 10px", display: "flex", alignItems: "center", gap: 5, borderBottom: "1px solid #2a2a2a" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["#ff5f57","#febc2e","#28c840"] as string[]).map((c,i) => (
            <div key={i} style={{ width:8, height:8, borderRadius:"50%", background:c }} />
          ))}
        </div>
        <div style={{ flex:1, height:14, background:"#2d2d2d", borderRadius:3, marginLeft:6, display:"flex", alignItems:"center", paddingLeft:8, overflow:"hidden" }}>
          <span style={{ color:"#888", fontSize:8 }}>create.roblox.com · My Game</span>
        </div>
      </div>

      <div style={{ display:"flex", minHeight:124 }}>
        {/* Icon sidebar */}
        <div style={{ width:40, background:"#181818", borderRight:"1px solid #252525", display:"flex", flexDirection:"column", alignItems:"center", paddingTop:8, gap:3, flexShrink:0 }}>
          <div style={{ width:22, height:22, background:"#e32f4a", borderRadius:3, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:3 }}>
            <span style={{ color:"white", fontWeight:900, fontSize:10 }}>R</span>
          </div>
          {(["⌂","✦","◈","⊞"] as string[]).map((ic,i) => (
            <div key={i} style={{ width:26, height:20, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <span style={{ fontSize:8, color:"#333" }}>{ic}</span>
            </div>
          ))}
        </div>

        {/* Text nav */}
        <div style={{ width:100, background:"#1a1a1a", borderRight:"1px solid #252525", paddingTop:8, flexShrink:0 }}>
          <div style={{ padding:"0 8px 6px", fontSize:7, color:"#444", fontWeight:700, letterSpacing:"0.08em" }}>CONFIGURE</div>
          <div style={{ padding:"5px 10px", fontSize:8, color: f===0 ? "#fff" : "#555", background: f===0 ? "#242424" : "transparent", borderLeft: f===0 ? "2px solid #4a9eff" : "2px solid transparent", fontWeight: f===0 ? 700 : 400 }}>Overview</div>
          <div style={{ padding:"5px 10px", fontSize:8, color:"#555", borderLeft:"2px solid transparent" }}>Basic Settings</div>
          <div style={{ padding:"5px 10px", fontSize:8, color: f>=1 ? "#fff" : "#555", background: f>=1 ? "#1e1e1e" : "transparent", borderLeft: f>=1 ? "2px solid #4a9eff" : "2px solid transparent", fontWeight: f>=1 ? 700 : 400, display:"flex", justifyContent:"space-between" }}>
            <span>Monetization</span>
            {f>=1 && <span style={{ fontSize:7, color:"#555" }}>▾</span>}
          </div>
          {monoExpanded && (
            <>
              <div style={{ padding:"3px 6px 3px 18px", fontSize:7, color:"#555", borderLeft:"2px solid transparent" }}>Dev Products</div>
              <div style={{ padding:"3px 6px 3px 18px", fontSize:7, color: f>=2 ? "#4a9eff" : "#555", background: f>=2 ? "#1a2a3a" : "transparent", borderLeft: f>=2 ? "2px solid #4a9eff" : "2px solid transparent", fontWeight: f>=2 ? 700 : 400 }}>Game Passes</div>
              <div style={{ padding:"3px 6px 3px 18px", fontSize:7, color:"#555", borderLeft:"2px solid transparent" }}>Paid Access</div>
            </>
          )}
          <div style={{ padding:"5px 10px", fontSize:8, color:"#555", borderLeft:"2px solid transparent" }}>Analytics</div>
        </div>

        {/* Content */}
        <div style={{ flex:1, background:"#111", padding:"8px 10px", minHeight:124, position:"relative" }}>
          {!showModal ? (
            f < 2 ? (
              <div style={{ fontSize:9, color:"#444", marginTop:4 }}>Выбери раздел в боковом меню.</div>
            ) : (
              <>
                <div style={{ fontSize:11, fontWeight:700, color:"#eee", marginBottom:6 }}>Game Passes</div>
                <div style={{
                  display:"inline-flex", alignItems:"center", gap:4,
                  background: f===3 ? "#0a55d4" : "#0e6fff",
                  color:"white", fontWeight:700, fontSize:9,
                  padding:"4px 10px", borderRadius:3,
                  boxShadow: f===3 ? "0 0 0 3px #0e6fff44" : "none",
                  transition:"all 0.2s",
                }}>+ Create a Game Pass</div>
                <div style={{ marginTop:8, fontSize:8, color:"#333", textAlign:"center" }}>No game passes yet.</div>
              </>
            )
          ) : (
            <div style={{ background:"#1c1c1c", border:"1px solid #333", borderRadius:5, padding:"10px 12px", boxShadow:"0 4px 20px rgba(0,0,0,0.4)" }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#eee", marginBottom:7, borderBottom:"1px solid #2a2a2a", paddingBottom:5 }}>Create Game Pass</div>
              <div style={{ fontSize:7, color:"#888", fontWeight:600, marginBottom:3 }}>Pass Name <span style={{ color:"#e31e24" }}>*</span></div>
              <div style={{
                border: f===4 ? "2px solid #4a9eff" : "1px solid #333",
                borderRadius:3, padding:"4px 7px", fontSize:9, color:"#eee",
                background: f===4 ? "#0d1520" : "#161616",
                marginBottom:6, transition:"all 0.3s",
              }}>
                {typedName || <span style={{ color:"#444" }}>Enter pass name…</span>}
              </div>
              <div style={{ fontSize:7, color:"#888", fontWeight:600, marginBottom:3 }}>Description <span style={{ color:"#555" }}>(optional)</span></div>
              <div style={{ border:"1px solid #2a2a2a", borderRadius:3, padding:"3px 7px", fontSize:8, color:"#444", marginBottom:7, height:16 }}>Add a description…</div>
              <div style={{ display:"flex", justifyContent:"flex-end", gap:5 }}>
                <div style={{ fontSize:8, fontWeight:600, color:"#666", background:"#252525", borderRadius:3, padding:"4px 10px" }}>Cancel</div>
                <div style={{
                  fontSize:8, fontWeight:700, color:"white",
                  background: saveHL ? "#1d4ed8" : "#4a9eff",
                  borderRadius:3, padding:"4px 10px",
                  boxShadow: saveHL ? "0 0 0 3px #4a9eff33" : "none",
                  transition:"all 0.3s",
                }}>{saveHL ? "✓ Saved!" : "Save"}</div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Single cursor — absolute within whole animation */}
      <div style={{
        position:"absolute", top: cursorTop, left: cursorLeft,
        pointerEvents:"none", zIndex:20,
        transition:"top 0.45s cubic-bezier(0.4,0,0.2,1), left 0.45s cubic-bezier(0.4,0,0.2,1)",
      }}>
        <RCursor />
      </div>
    </div>
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
        <div style={{ flex: 1, background: "#111", padding: "10px 12px", minHeight: 272, position: "relative" }}>
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
    const id = setInterval(() => setF(v => (v + 1) % 5), 1800);
    return () => clearInterval(id);
  }, []);
  // f=0: chat open (manager first msg), f=1: user typing link,
  // f=2: user msg sent, f=3: manager "Спасибо за покупку!", f=4: manager "Выкупаем..."

  return (
    <div style={{ marginTop: 12, overflow: "hidden", border: "1px solid #1e2a45" }}>
      {/* TG-style header */}
      <div style={{ background: "#232e3c", padding: "6px 10px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #1e2a45" }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#229ED9,#0f7ab8)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg viewBox="0 0 24 24" fill="white" style={{ width:14, height:14 }}>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8-1.7 8.02c-.12.55-.46.68-.94.42l-2.6-1.92-1.25 1.21c-.14.14-.26.26-.53.26l.19-2.67 4.85-4.38c.21-.19-.05-.29-.32-.1L7.12 14.4l-2.55-.8c-.55-.17-.56-.55.12-.82l9.97-3.84c.46-.17.86.11.98.86z"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#eee" }}>@RobloxBank_PA</div>
          <div style={{ fontSize: 7, color: "#5a7a8a" }}>менеджер · онлайн</div>
        </div>
      </div>

      {/* Chat area */}
      <div style={{ background: "#17212b", padding: "8px 10px", paddingBottom: 40, minHeight: 130, position: "relative" }}>
        <div style={{ fontSize: 7, color: "#445566", textAlign: "center", marginBottom: 8 }}>Сегодня</div>

        {/* Manager first message */}
        <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 6 }}>
          <div style={{ background: "#182533", borderRadius: "2px 10px 10px 10px", padding: "5px 9px", maxWidth: "78%" }}>
            <div style={{ fontSize: 9, color: "#ddd", lineHeight: 1.4 }}>Привет! Пришлите ссылку на геймпасс 👋</div>
            <div style={{ fontSize: 7, color: "#445566", marginTop: 2, textAlign: "right" }}>10:30</div>
          </div>
        </div>

        {/* User sends link (f=1+) */}
        {f >= 1 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            <div style={{ background: "#2b5278", borderRadius: "10px 2px 10px 10px", padding: "5px 9px", maxWidth: "82%", opacity: f===1 ? 0.7 : 1, transition: "opacity 0.3s" }}>
              <div style={{ fontSize: 9, color: "#eee", wordBreak: "break-all", lineHeight: 1.4 }}>
                {f===1 ? "roblox.com/game-pass/123…|" : "roblox.com/game-pass/1234567/VIP"}
              </div>
              <div style={{ fontSize: 7, color: "#4a6a8a", marginTop: 2, textAlign: "right" }}>
                {f >= 2 ? "10:31 ✓✓" : "10:31"}
              </div>
            </div>
          </div>
        )}

        {/* Manager: "Спасибо за покупку!" (f=3+) */}
        {f >= 3 && (
          <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 5 }}>
            <div style={{ background: "#182533", border: "1px solid #22c55e22", borderRadius: "2px 10px 10px 10px", padding: "5px 9px", maxWidth: "84%" }}>
              <div style={{ fontSize: 9, color: "#22c55e", fontWeight: 700, marginBottom: 2 }}>✅ Спасибо за покупку!</div>
              <div style={{ fontSize: 8, color: "#aaa", lineHeight: 1.4 }}>Геймпасс получен, выкупаем прямо сейчас.</div>
              <div style={{ fontSize: 7, color: "#445566", marginTop: 2 }}>10:31</div>
            </div>
          </div>
        )}

        {/* Manager: время зачисления (f=4) */}
        {f >= 4 && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ background: "#182533", borderRadius: "2px 10px 10px 10px", padding: "5px 9px", maxWidth: "84%" }}>
              <div style={{ fontSize: 8, color: "#ddd", lineHeight: 1.4 }}>⏳ Robux поступят на баланс через <span style={{ color: "#4a9eff", fontWeight: 700 }}>5–7 дней</span> по правилам Roblox.</div>
              <div style={{ fontSize: 7, color: "#445566", marginTop: 2 }}>10:31</div>
            </div>
          </div>
        )}

        {/* Input bar */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "#232e3c", borderTop: "1px solid #1e2a45", padding: "5px 8px", display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ flex: 1, background: "#17212b", border: "1px solid #1e2a45", borderRadius: 14, padding: "4px 10px", fontSize: 8, color: f===1 ? "#ddd" : "#445" }}>
            {f===0 ? <span style={{ color:"#33475a" }}>Сообщение…</span>
             : f===1 ? "roblox.com/game-pass/123…|"
             : <span style={{ color:"#33475a" }}>Сообщение…</span>}
          </div>
          <div style={{ width: 24, height: 24, borderRadius: "50%", background: f===1 ? "#229ED9" : "#1e2a45", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.3s", flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: f===1 ? "white" : "#445" }}>↑</span>
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

              {/* Step 04: calculator (contains copy + warning inline) */}
              {isStep04 && (
                <div className="mt-3">
                  <FormulaCalculator
                    denomination={denomination}
                    isWB={!!isWB}
                    onPassPriceChange={onPassPriceChange}
                    onCopyPassPrice={onCopyPassPrice}
                    priceCopied={priceCopied}
                  />
                </div>
              )}

              {/* Step animations — wrapper with minHeight prevents layout shift */}
              {ANIM_MAP[step.num] && (
                <div style={{ minHeight: 200 }} className="flex flex-col justify-end">
                  {ANIM_MAP[step.num]!()}
                </div>
              )}
              {isStep04 && (
                <div style={{ minHeight: 460 }} className="flex flex-col justify-end">
                  <Anim04Price passPrice={passPrice} />
                </div>
              )}
              {isStep05Std && <div style={{ minHeight: 180 }}><Anim05Standard /></div>}
              {isStep06Std && <div style={{ minHeight: 180 }}><Anim06Standard /></div>}
              {isStep05WB  && <div style={{ minHeight: 180 }}><Anim05WB /></div>}
              {isStep06WB  && <div style={{ minHeight: 320 }}><Anim06WB /></div>}
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

function WBManagerBlock({ denomination, code }: { denomination?: number; code?: string }) {
  const passPrice = denomination && denomination > 0 ? Math.ceil(denomination / 0.7) : null;

  return (
    <div className="pixel-card border-2 border-[#c9a84c]/30 bg-[#c9a84c]/5 p-8 sm:p-12 mt-8 relative overflow-hidden group">
      {/* Background glow effects */}
      <div className="absolute -top-24 -right-24 w-64 h-64 bg-[#c9a84c]/10 rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-[#c9a84c]/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="relative z-10 text-center mb-10">
        <div className="w-20 h-20 border-2 border-[#c9a84c]/40 bg-[#c9a84c]/10 flex items-center justify-center mx-auto mb-6 relative">
          <Send className="w-10 h-10 text-[#c9a84c] animate-pulse" />
          <div className="absolute inset-0 border border-[#c9a84c]/20 scale-125 opacity-20" />
        </div>
        
        <div className="font-pixel text-[10px] text-[#c9a84c]/60 tracking-[0.3em] mb-4 uppercase">
          Оформление заказа
        </div>

        {denomination && passPrice ? (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-10">
            <div className="flex flex-col items-center gap-1 border-2 border-[#c9a84c]/20 bg-[#c9a84c]/5 px-8 py-4 min-w-[180px]">
              <span className="font-pixel text-[8px] text-[#c9a84c]/40">ВЫ ПОЛУЧИТЕ</span>
              <span className="text-4xl font-black text-white">{denomination} R$</span>
            </div>
            <div className="bg-[#c9a84c]/20 w-8 h-[2px] hidden sm:block" />
            <div className="flex flex-col items-center gap-1 border-2 border-[#c9a84c]/40 bg-[#c9a84c]/10 px-8 py-4 min-w-[180px]">
              <span className="font-pixel text-[8px] text-[#c9a84c]/60">ЦЕНА ПАССА</span>
              <span className="text-4xl font-black text-[#f0c040]">{passPrice} R$</span>
            </div>
          </div>
        ) : null}

        <h3 className="text-3xl md:text-4xl font-black uppercase tracking-tight text-white mb-4">
          Почти готово!
        </h3>
        <p className="text-zinc-400 font-medium text-base max-w-lg mx-auto leading-relaxed">
          Чтобы мы могли выкупить ваш геймпасс, отправьте ссылку на него боту в Telegram или нашему сообществу ВКонтакте.
        </p>
      </div>

      <div className="relative z-10 flex flex-col md:flex-row gap-4 justify-center max-w-2xl mx-auto w-full">
        {/* Telegram Button */}
        <a
          href={code ? `https://t.me/wb228_notifier_bot?start=${code}` : "https://t.me/wb228_notifier_bot"}
          target="_blank" rel="noopener noreferrer"
          className="flex-1 h-20 flex items-center justify-center gap-4 border-2 border-b-[6px] border-[#229ED9]/40 bg-[#229ED9]/10 hover:bg-[#229ED9]/20 hover:border-[#229ED9]/60 active:translate-y-[4px] active:border-b-[2px] shadow-[0_4px_20px_rgba(34,158,217,0.15)] transition-all duration-75 font-black text-[13px] uppercase tracking-widest text-white group/btn"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 flex-shrink-0 text-[#229ED9] group-hover/btn:scale-110 transition-transform">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8-1.7 8.02c-.12.55-.46.68-.94.42l-2.6-1.92-1.25 1.21c-.14.14-.26.26-.53.26l.19-2.67 4.85-4.38c.21-.19-.05-.29-.32-.1L7.12 14.4l-2.55-.8c-.55-.17-.56-.55.12-.82l9.97-3.84c.46-.17.86.11.98.86z"/>
          </svg>
          Получить с помощью ТГ
        </a>

        {/* VK Button */}
        <div className="flex-1 flex flex-col gap-2">
          <div className="h-20 flex flex-col items-center justify-center p-2 border-2 border-b-[6px] border-[#0077FF]/40 bg-[#0077FF]/10 shadow-[0_4px_20px_rgba(0,119,255,0.15)] transition-all duration-75">
            <VKAuthButton />
          </div>
          <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest text-center">
            Быстрая авторизация VK ID
          </p>
        </div>
      </div>

      <div className="relative z-10 flex items-center justify-center gap-2 mt-8 opacity-60">
        <AlertTriangle className="w-4 h-4 text-[#c9a84c]" />
        <p className="text-[#c9a84c] text-[10px] font-black uppercase tracking-widest text-center">
          Среднее время ответа — 10 минут • Работаем круглосуточно
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

// ─── WB-only static header ─────────────────────────────────────────────────────

function WBStaticHeader({ denomination, onReset }: { denomination?: number; onReset?: () => void }) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#c9a84c]/10 bg-[#0a0e1a]/95 backdrop-blur-xl select-none">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-3">
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

        {/* Denomination badge */}
        {denomination && denomination > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 border border-[#c9a84c]/30 bg-[#c9a84c]/10">
            <span className="font-pixel text-[8px] text-[#c9a84c]/60 tracking-widest hidden sm:block">НОМИНАЛ</span>
            <span className="font-black text-lg leading-none" style={{ color: "#f0c040" }}>{denomination} R$</span>
          </div>
        )}

        {/* Enter new code button */}
        {onReset && (
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 h-8 px-3 border border-[#c9a84c]/20 hover:border-[#c9a84c]/50 text-[#c9a84c]/50 hover:text-[#c9a84c] transition-all font-black text-[10px] uppercase tracking-widest"
          >
            <ArrowRight className="w-3 h-3 rotate-180" />
            <span className="hidden sm:inline">Новый код</span>
          </button>
        )}
      </div>
      <div className="h-[2px] bg-gradient-to-r from-transparent via-[#c9a84c]/30 to-transparent" />
    </header>
  );
}

// ─── WB Gate Screen ────────────────────────────────────────────────────────────

interface WBGateProps {
  onSuccess: (denomination: number, code: string) => void;
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
      saveWBSession(denomination, code);
      onSuccess(denomination, code);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Неизвестная ошибка";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col">
      <WBStaticHeader />


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
                <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight leading-tight text-white">
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

// ─── Interactive Formula Calculator ──────────────────────────────────────────

function FormulaCalculator({
  denomination,
  isWB,
  onPassPriceChange,
  onCopyPassPrice,
  priceCopied,
}: {
  denomination?: number;
  isWB: boolean;
  onPassPriceChange: (p: number | null) => void;
  onCopyPassPrice: () => void;
  priceCopied: boolean;
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
          <button
            onClick={onCopyPassPrice}
            title={priceCopied ? "Скопировано!" : "Нажми, чтобы скопировать"}
            className="text-center group cursor-pointer"
          >
            <div className="text-3xl font-black text-[#00b06f] flex items-center gap-1.5 justify-center">
              {fixedPrice}
              {priceCopied
                ? <Check className="w-4 h-4 text-[#00b06f]" />
                : <Copy className="w-3.5 h-3.5 text-[#00b06f]/20 group-hover:text-[#00b06f]/55 transition-colors" />
              }
            </div>
            <div className="text-xs uppercase tracking-widest font-black transition-colors" style={{ color: priceCopied ? "#00b06f99" : "#52525b" }}>
              {priceCopied ? "скопировано" : "Цена пасса · нажми"}
            </div>
          </button>
        </div>
        {/* Regional pricing warning */}
        <div className="mt-3 flex gap-2.5 items-start bg-amber-500/10 border border-amber-500/40 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-300 font-bold leading-snug">
            Убери галочку <span className="text-amber-200">«Enable regional pricing»</span> — иначе Roblox изменит цену для других стран.
          </p>
        </div>
      </div>
    );
  }

  // Standard — interactive calculator
  return (
    <div className="pixel-card border-2 border-[#00b06f]/30 bg-[#00b06f]/5 p-5 min-h-[220px]">
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

        {/* Result — click to copy */}
        <div className="flex-1 space-y-1">
          <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Цена пасса (R$)</div>
          <button
            onClick={calcPrice ? onCopyPassPrice : undefined}
            disabled={!calcPrice}
            className={`h-12 w-full bg-[#080c18] border-2 px-3 flex items-center justify-between transition-all group ${
              calcPrice
                ? "border-[#00b06f]/30 hover:border-[#00b06f]/60 hover:bg-[#00b06f]/5 cursor-pointer"
                : "border-[#1e2a45] cursor-default"
            }`}
          >
            <span className="text-xl font-black text-[#00b06f]">{calcPrice ?? "—"}</span>
            <div className="flex items-center gap-2">
              {calcPrice && !priceCopied && (
                <span className="text-[10px] font-medium text-zinc-600 group-hover:text-zinc-500 transition-colors">
                  нажми, чтобы скопировать
                </span>
              )}
              {priceCopied && (
                <span className="text-[10px] font-medium text-[#00b06f]/70">
                  ✓ скопировано
                </span>
              )}
              <span className="text-xs text-zinc-500 font-bold">R$</span>
              {calcPrice && (
                priceCopied
                  ? <Check className="w-3 h-3 text-[#00b06f]" />
                  : <Copy className="w-3 h-3 text-zinc-700 group-hover:text-[#00b06f]/50 transition-colors" />
              )}
            </div>
          </button>
        </div>
      </div>

      {calcPrice && (
        <div className="mt-3 flex gap-2.5 items-start bg-amber-500/10 border border-amber-500/40 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-300 font-bold leading-snug">
            Убери галочку <span className="text-amber-200">«Enable regional pricing»</span> — иначе Roblox изменит цену для других стран.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Instruction page ──────────────────────────────────────────────────────────

function Instruction({ isWB, denomination, code, onReset }: { isWB: boolean; denomination?: number; code?: string; onReset?: () => void }) {
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
      {isWB ? <WBStaticHeader denomination={denomination} onReset={onReset} /> : <Navbar />}

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
                {!isWB && (
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
        {isWB ? <WBManagerBlock denomination={denomination} code={code} /> : <StandardDoneBlock />}

        {/* Support at the bottom for WB users */}
        {isWB && (
          <div className="mt-20 flex flex-col items-center text-center space-y-4">
            <div className="w-px h-16 bg-gradient-to-b from-[#c9a84c]/40 to-transparent" />
            <p className="text-zinc-500 text-sm font-medium italic">Остались вопросы или что-то не получается?</p>
            <a
              href="https://t.me/RobloxBank_PA"
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-3 px-8 py-4 border-2 border-[#c9a84c]/20 hover:border-[#c9a84c]/50 text-[#c9a84c] transition-all font-black text-[11px] uppercase tracking-[0.2em] group"
            >
              Связаться с менеджером
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
          </div>
        )}
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

// ─── WB full-screen intro splash ───────────────────────────────────────────────

function WBIntro({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);

  const handleDone = useCallback(() => {
    if (fading) return;
    setFading(true);
    setTimeout(onDone, 750);
  }, [fading, onDone]);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black flex flex-col"
      style={{
        transition: "opacity 0.75s ease",
        opacity: fading ? 0 : 1,
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      {/* Particle canvas fills the whole screen */}
      <div className="flex-1 relative">
        <ParticleTextEffect
          words={["СПАСИБО\nЗА ПОКУПКУ!", "ROBLOXBANK"]}
          fullScreen
          showHint={false}
          onComplete={handleDone}
        />
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between px-8 py-5 border-t border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[#c9a84c] animate-pulse" />
          <span className="font-pixel text-[9px] text-[#c9a84c]/60 tracking-widest">
            WILDBERRIES × ROBLOXBANK
          </span>
        </div>
        <button
          onClick={handleDone}
          className="font-pixel text-[9px] text-zinc-600 hover:text-[#c9a84c] tracking-widest uppercase transition-colors"
        >
          Пропустить →
        </button>
      </div>
    </div>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────

export default function GuideClient({ isWB }: { isWB: boolean }) {
  const [phase, setPhase] = useState<"intro" | "gate" | "instruction">(
    isWB ? "intro" : "instruction"
  );
  const [denomination, setDenomination] = useState<number>(0);
  const [activeCode, setActiveCode] = useState<string>("");

  // Restore WB session from localStorage on mount —
  // skip intro if the user already activated a code this session
  useEffect(() => {
    if (!isWB) return;
    const saved = loadWBSession();
    if (saved !== null) {
      setDenomination(saved.denomination);
      setActiveCode(saved.code);
      setPhase("instruction");
    }
  }, [isWB]);

  const handleWBReset = () => {
    try { localStorage.removeItem(WB_SESSION_KEY); } catch {}
    setDenomination(0);
    setActiveCode("");
    setPhase("gate");
  };

  if (phase === "intro") {
    return <WBIntro onDone={() => setPhase("gate")} />;
  }

  if (phase === "gate") {
    return (
      <WBGate
        onSuccess={(d, c) => {
          saveWBSession(d, c);
          // Устанавливаем куку сразу, чтобы она была доступна при любой авторизации
          document.cookie = `wb_code=${c}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`;
          setDenomination(d);
          setActiveCode(c);
          setPhase("instruction");
        }}
      />
    );
  }

  return (
    <Instruction
      isWB={isWB}
      denomination={denomination}
      code={activeCode}
      onReset={isWB ? handleWBReset : undefined}
    />
  );
}
