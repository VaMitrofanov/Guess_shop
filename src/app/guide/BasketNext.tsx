"use client";

import { useEffect, useState } from "react";
import { basketItemHref, nextBasketItem, type BasketItem } from "@/lib/wb-basket";

/* ─────────────────────────────────────────────────────────────────────────────
   «Куда зачислить второй заказ?» (01.11.2026).

   Покупатель взял на WB две карточки одной покупкой: два заказа, два чата, два
   кода. Раньше он оформлял первый и думал, что всё — вторая ссылка лежала
   нетронутой (5 корзин из 28). Теперь после первого заказа страница сама
   показывает полосу «1 из 2 ✅ · 2 из 2 ⏳» и одну развилку: тот же аккаунт
   (подставлен ник) или другой (ник вводится заново). Дальше — обычный путь
   по коду второго заказа.
   ───────────────────────────────────────────────────────────────────────── */

const fmt = (n: number | null) => (n ? `${n.toLocaleString("ru-RU")} R$` : "");

export default function BasketNext({ code, nick }: { code: string; nick: string | null }) {
  const [items, setItems] = useState<BasketItem[]>([]);
  const [ownNick, setOwnNick] = useState<string | null>(nick);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/wb-code/basket?code=${encodeURIComponent(code)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        setItems(Array.isArray(body.items) ? body.items : []);
        if (body.nick) setOwnNick(body.nick);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [code]);

  const live = items.filter((item) => item.state !== "cancelled");
  if (live.length < 2) return null;
  const next = nextBasketItem(items);
  const waiting = live.find((item) => !item.self && item.state === "waiting");

  return (
    <section className="wbi-basket" aria-label="Ваша покупка — несколько заказов">
      <div className="wbi-basket-steps">
        {live.map((item) => (
          <div key={item.index} className={`wbi-basket-step is-${item.state}`}>
            <i aria-hidden="true">{item.state === "done" || item.self ? "✓" : item.index}</i>
            <span>
              Заказ {item.index} из {item.total}{item.amount ? ` · ${fmt(item.amount)}` : ""}
              <small>
                {item.self || item.state === "done"
                  ? <>на <b>{item.self ? ownNick ?? item.nick ?? "ваш аккаунт" : item.nick ?? "аккаунт указан"}</b></>
                  : item.state === "todo" ? "ждёт выбора аккаунта" : "ссылка придёт в чат этого заказа на WB"}
              </small>
            </span>
          </div>
        ))}
      </div>

      {next ? (
        <>
          <h3>Куда зачислить заказ {next.index} из {next.total}?</h3>
          <p>{fmt(next.amount)} — можно на этот же аккаунт Roblox или на другой. Дальше всё как в первый раз.</p>
          {ownNick && (
            <a className="wbi-basket-btn is-primary" href={basketItemHref(next, ownNick)}>
              На этот же аккаунт<small className="is-nick">{ownNick}</small>
            </a>
          )}
          <a className={`wbi-basket-btn${ownNick ? "" : " is-primary"}`} href={basketItemHref(next, null)}>
            На другой аккаунт<small>введу ник</small>
          </a>
        </>
      ) : waiting ? (
        <p className="wbi-basket-wait">
          Заказ {waiting.index} из {waiting.total} ещё оформляется на Wildberries — ссылка на него придёт
          в чат этого заказа. Получить его можно на этот же аккаунт или на другой.
        </p>
      ) : null}
    </section>
  );
}
