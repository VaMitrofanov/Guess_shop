"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ORDER_STATUS_RU, type BuyerDossier } from "@/lib/risk-feed-types";
import { fmtRiskDate, RiskItem } from "./risk-item";
import css from "./risks.module.css";

/** Досье покупателя на сайте: заказы, отзывы и возвраты по имени, отметка. */
export default function BuyerDossierClient({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [data, setData] = useState<BuyerDossier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (target: string) => {
    setError(null);
    setData(null);
    if (!target.trim()) return;
    try {
      const res = await fetch(`/api/admin/buyers?name=${encodeURIComponent(target)}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Не загрузилось");
      setData(d);
      setNote(d.flag?.note ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не загрузилось");
    }
  }, []);

  useEffect(() => { void load(initialName); }, [initialName, load]);

  async function toggleFlag(on: boolean) {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/buyers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: on ? "flag" : "unflag", name: data.key, displayName: data.displayName, note }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Не сохранилось");
      setData({ ...data, flag: d.flag });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не сохранилось");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={css.root}>
      <form className={css.searchForm} onSubmit={(e) => { e.preventDefault(); router.push(`/admin/buyers?name=${encodeURIComponent(name)}`); }}>
        <label htmlFor="buyer-name" className="sr-only">Имя покупателя на WB</label>
        <input id="buyer-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя покупателя на WB" />
        <button type="submit" className={css.btn}>Найти</button>
      </form>

      {error && <p className={css.error}>{error}</p>}
      {!data && !error && initialName && <p className={css.hint}>Загружаем…</p>}
      {!initialName && <p className={css.hint}>Введите имя покупателя, как оно записано на WB, или откройте досье из карточки заказа.</p>}

      {data && (
        <>
          <div className={css.dossierHead}>
            {data.flag && (
              <span className={`${css.pill} ${css.pillAmber}`}>⚠️ проблемный · {data.flag.by}, {fmtRiskDate(data.flag.at)}{data.flag.note ? ` · ${data.flag.note}` : ""}</span>
            )}
          </div>

          <div className={css.summary}>
            <div className={css.tile}><b>{data.stats.orders}</b><span>заказов на это имя</span></div>
            <div className={`${css.tile} ${css.tileGreen}`}><b>{data.stats.completed}</b><span>выкуплено</span></div>
            <div className={`${css.tile} ${css.tileRed}`}><b>{data.stats.badReviews}</b><span>плохих отзывов</span></div>
            <div className={`${css.tile} ${css.tileAmber}`}><b>{data.stats.claims}</b><span>заявок на возврат</span></div>
          </div>

          <div className={`${css.namesake} ${data.likelyNamesakes ? css.namesakeWarn : ""}`}>
            {data.likelyNamesakes
              ? `Связь по имени: на «${data.displayName}» ${data.stats.orders} заказов — скорее всего это разные люди. Сверяйте даты и товар, прежде чем делать выводы.`
              : "Связь по имени: WB не даёт ID покупателя. Заказов на это имя мало — похоже на одного человека."}
          </div>

          <div className={css.columns}>
            <section className={css.section}>
              <h2>Заказы</h2>
              {data.orders.length === 0 && <p className={css.hint}>Заказов на это имя нет.</p>}
              {data.orders.map((o) => {
                const href = o.orderId ? `/admin/orders/${o.orderId}` : o.code ? `/admin/orders?slice=ALL&q=${encodeURIComponent(o.code)}` : null;
                const inner = (
                  <>
                    <span>
                      <span className={css.code}>{o.code ?? `WB #${o.wbOrderId}`}</span>
                      <span className={css.sub}> · {fmtRiskDate(o.createdAt)} · {ORDER_STATUS_RU[o.status] ?? o.status}{o.held ? " · ❄️" : ""}{o.claim ? " · возврат" : ""}</span>
                    </span>
                    <b>{o.amount ? `${o.amount.toLocaleString("ru-RU")} R$` : ""}</b>
                  </>
                );
                return href
                  ? <Link key={o.wbOrderId} className={css.orderRow} href={href}>{inner}</Link>
                  : <div key={o.wbOrderId} className={css.orderRow}>{inner}</div>;
              })}

              <h2>Отметка</h2>
              <div className={css.flagBox}>
                <label htmlFor="buyer-flag-note" className={css.hint}>Почему проблемный (необязательно)</label>
                <textarea id="buyer-flag-note" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className={css.flagRow}>
                  <button type="button" className={`${css.btn} ${css.btnAmber}`} disabled={saving} onClick={() => void toggleFlag(true)}>
                    {data.flag ? "Сохранить заметку" : "⚠️ Отметить проблемным"}
                  </button>
                  {data.flag && (
                    <button type="button" className={css.btn} disabled={saving} onClick={() => void toggleFlag(false)}>Снять отметку</button>
                  )}
                </div>
                <span className={css.hint}>Отметка всплывёт на карточках заказов с этим именем. Выкуп она не блокирует.</span>
              </div>
            </section>

            <section className={css.section}>
              <h2>Отзывы и возвраты</h2>
              {data.events.length === 0 && <p className={css.hint}>Ничего не было.</p>}
              <div className={css.list}>
                {data.events.map((e) => <RiskItem key={e.id} item={e} showActions={false} />)}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
