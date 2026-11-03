"use client";

import type { OrderRisk } from "@/lib/order-risk-types";
import { basketLabel } from "@/lib/wb-basket";

/**
 * 🧺 Корзина WB на сайте (01.11.2026): «1/2» — заказ из покупки нескольких
 * карточек; «2 аккаунта» — у соседей разные ники, при выкупе не перепутать.
 * `full` — строка для досье: кто соседи и в каком они состоянии.
 */
const STATUS_RU: Record<string, string> = {
  AWAITING_GAMEPASS: "ждём пасс", PENDING: "к выкупу", IN_PROGRESS: "выкупается",
  COMPLETED: "выкуплен", REJECTED: "отклонён", ERROR: "ошибка",
};

export default function BasketChip({ risk, full = false }: { risk: OrderRisk | null | undefined; full?: boolean }) {
  const b = risk?.basket;
  const label = b ? basketLabel(b, b.siblings.filter((s) => !s.cancelled).map((s) => s.nick)) : null;
  if (!b || !label) return null;
  const others = b.siblings
    .map((s, i) => ({ ...s, index: i + 1 }))
    .filter((s) => s.index !== b.index);
  const chip = (
    <>
      <span style={{ color: "#40c8b0", fontWeight: 800, whiteSpace: "nowrap" }} title={`Покупка из ${b.total} заказов WB`}>{label.text}</span>
      {label.twoAccounts && <span style={{ color: "#ffd60a", fontWeight: 800, whiteSpace: "nowrap", marginLeft: 6 }}>2 аккаунта</span>}
    </>
  );
  if (!full) return chip;
  return (
    <div style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(64,200,176,.3)", background: "rgba(64,200,176,.07)", display: "grid", gap: 4 }}>
      <div>{chip} <span style={{ color: "var(--o-muted, #8e8e97)" }}>· заказ {b.index} из {b.total} одной покупки WB</span></div>
      {others.map((s) => (
        <div key={s.index} style={{ fontSize: 13.5 }}>
          {s.index} из {b.total}: <b style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{s.code ?? "без кода"}</b>
          {" · "}{s.nick ?? "ник не указан"}
          {" · "}{s.cancelled ? "отменён на WB" : s.status ? STATUS_RU[s.status] ?? s.status : s.code ? "ссылка не открыта" : "доставка не закрыта"}
        </div>
      ))}
    </div>
  );
}
