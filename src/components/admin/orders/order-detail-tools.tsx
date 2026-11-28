"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   «Настройка геймпассов» на полной карточке заказа (`/admin/orders/<id>`).

   До 19.10.2026 полная карточка была read-only: она показывала «Геймпасс: не
   привязан» и не давала ничего с этим сделать — работа переносилась в другой
   раздел, а ключ покупателя сюда не доехал вовсе (замечание владельца).

   Ключ вставляется прямо здесь: это самая частая операция, и уводить за ней в
   рабочее место незачем. Остальные три инструмента — ссылки в рабочее место с
   уже выбранным заказом и открытым инструментом: их интерфейсу нужна лента
   (пассы ника — список, разбивка — две колонки), а дублировать его на второй
   странице значит заводить вторую правду.
   ───────────────────────────────────────────────────────────────────────── */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AskBuyerBox, GamepassToolRows, KeyCreateBox } from "./gamepass-tools";
import type { GamepassToolId } from "@/lib/gamepass-tools";
import styles from "./orders.module.css";

export interface DetailToolsOrder {
  id: string;
  wbCode: string;
  amount: number;
  status: string;
  heldAt: Date | string | null;
  isDirectOrder: boolean;
  paidAt: Date | string | null;
  robloxUsername: string | null;
  probableNick: string | null;
}

export default function OrderDetailTools({ order }: { order: DetailToolsOrder }) {
  const router = useRouter();
  const [tool, setTool] = useState<GamepassToolId | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const workspace = (id: GamepassToolId) =>
    id === "link"
      ? `/admin/orders?order=${order.id}&edit=1`
      : `/admin/orders?order=${order.id}&tool=${id}`;

  return (
    <div className={styles.detailTools}>
      <GamepassToolRows
        order={order}
        active={tool}
        handlers={{ key: true, link: true, nick: true, ask: true, split: true }}
        onPick={id => {
          if (id === "key") { setTool(prev => (prev === "key" ? null : "key")); return; }
          if (id === "ask") { setTool(prev => (prev === "ask" ? null : "ask")); return; }
          setTool(null);
          router.push(workspace(id));
        }}
      />

      {tool === "key" && (
        <KeyCreateBox
          order={order}
          post={async payload => {
            const response = await fetch("/api/admin/orders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...payload, orderId: order.id }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body?.error ?? `Сервер ответил ${response.status}`);
            return body;
          }}
          onToast={(text, error) => setNote(`${error ? "⛔ " : "✅ "}${text}`)}
          onChanged={() => router.refresh()}
        />
      )}

      {tool === "ask" && (
        <AskBuyerBox
          key={order.id}
          orderId={order.id}
          post={async payload => {
            const response = await fetch("/api/admin/orders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...payload, orderId: order.id }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body?.error ?? `Сервер ответил ${response.status}`);
            return body;
          }}
          onToast={(text, error) => setNote(`${error ? "⛔ " : "✅ "}${text}`)}
        />
      )}

      {note && <p className={styles.hint} style={{ marginTop: 8 }}>{note}</p>}
    </div>
  );
}
