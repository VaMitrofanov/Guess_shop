"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Undo2, Wallet } from "lucide-react";
import styles from "./overview.module.css";

/* ─────────────────────────────────────────────────────────────────────────────
   💰 Баланс кабинета WB и ↩ возвраты, ждущие решения (27.11.2026, мокап
   https://claude.ai/artifact/MUiwNghNKnnW6wCo6NE3zC). Стоит НАД героем «сколько
   робуксов тратим»: рубли — фиолетовой карточкой с кошельком, робуксы ниже —
   своей зелёной, чтобы две валюты не путались (владелец).
   ───────────────────────────────────────────────────────────────────────── */

interface Summary {
  wbBalance: { current: number; forWithdraw: number; at: string } | null;
  openClaims: { total: number; rows: { code: string; amount: number; status: string; reason: string | null; at: string }[] };
}

const rub = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;
const STATUS: Record<string, string> = { PENDING: "в очереди", AWAITING_GAMEPASS: "ждёт пасс", IN_PROGRESS: "выкупается", ERROR: "ошибка", PAYMENT_PENDING: "ждёт оплату" };
const day = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

export default function WbMoney() {
  const [data, setData] = useState<Summary | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/twa/wb-summary", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d) setData(d); }).catch(() => undefined);
    void load();
    const t = window.setInterval(load, 5 * 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  if (!data || (!data.wbBalance && data.openClaims.total === 0)) return null;
  const b = data.wbBalance;
  return (
    <div className={styles.wbMoney}>
      {b && (
        <section className={styles.wbBalance} aria-label="Баланс кабинета WB">
          <div className={styles.wbBalanceHead}>
            <span><Wallet size={16} aria-hidden="true" /> Кабинет WB · баланс</span>
            <span className={styles.wbMuted}>обновлено {day(b.at)}</span>
          </div>
          <strong className={styles.wbBalanceNum}>{Math.round(b.current).toLocaleString("ru-RU")}<small> ₽</small></strong>
          <span className={styles.wbMuted}>к выводу <b>{rub(b.forWithdraw)}</b></span>
        </section>
      )}
      {data.openClaims.total > 0 && (
        <section className={styles.wbClaims} aria-label="Возвраты WB ждут решения">
          <div className={styles.wbBalanceHead}>
            <span><Undo2 size={16} aria-hidden="true" /> Возвраты WB · ждут решения <b>{data.openClaims.total}</b></span>
          </div>
          {data.openClaims.rows.map((r) => (
            <Link key={r.code} className={styles.wbClaimRow} href={`/admin/orders?q=${encodeURIComponent(r.code)}`}>
              <code>{r.code}</code>
              <span>{r.amount.toLocaleString("ru-RU")} R$ · {STATUS[r.status] ?? r.status}</span>
              <span className={styles.wbMuted}>{r.reason ? `«${r.reason.slice(0, 60)}»` : "без причины"}</span>
              <span className={styles.wbMuted}>{day(r.at)}</span>
              <span className={styles.wbClaimGo}>Решить ›</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
