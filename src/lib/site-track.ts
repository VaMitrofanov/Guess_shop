/* 📊 События витрины (18.11.2026): воронка кодов, интерес к номиналам, подарок,
   прокрутка главной, калькулятор геймпасса. Те же правила, что у посещений
   (`site-observability.tsx`): без IP и cookies, посетитель — анонимный id в
   localStorage. Пишутся в `PerformanceSample` (surface = "site-event"),
   отчёт — `src/lib/site-visits.ts`, раздел админки «Посетители». */

export type SiteEventName =
  | "pack"        // выбрал номинал кода (value = номинал)
  | "gift_on"     // включил «В подарок»
  | "buy_click"   // нажал «Купить»/«Подарить»/«Ссылка родителю» (value = номинал)
  | "order"       // заказ кода создан (value = id заказа — по нему сервер узнаёт оплату)
  | "section"     // долистал до блока главной (value = блок)
  | "gp_amount"   // выбрал сумму в калькуляторе геймпасса (value = сумма)
  | "gp_checkout"; // нажал «К оформлению» в калькуляторе (value = сумма)

const ENDPOINT = "/api/observability/client";
const sent = new Set<string>();

function hash8(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Анонимный id посетителя: случайные 8 hex в localStorage. */
export function visitorId(): string {
  try {
    let id = localStorage.getItem("rb-visitor");
    if (!id) { id = Math.random().toString(16).slice(2, 10).padEnd(8, "0"); localStorage.setItem("rb-visitor", id); }
    return /^[a-f0-9]{8}$/.test(id) ? id : hash8(id);
  } catch { return hash8(navigator.userAgent + Date.now()); }
}

/** Одно и то же событие с тем же значением — один раз за сессию вкладки. */
export function trackSiteEvent(name: SiteEventName, value?: string | number): void {
  if (typeof window === "undefined") return;
  const v = value === undefined ? "" : String(value).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  const key = `rb-ev:${name}:${v}`;
  if (sent.has(key)) return;
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* приватный режим */ }
  sent.add(key);
  const route = window.location.pathname.replace(/^\/pay\/[^/]+/, "/pay/[token]").replace(/[^A-Za-z0-9_\-./[\]]/g, "").slice(0, 160) || "/";
  const body = JSON.stringify({ type: "event", route, name, value: v || undefined, visitor: visitorId() });
  try {
    if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
  } catch { /* fall through */ }
  void fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
}
