"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   «Включи продажу и поставь цену» (28.10.2026).

   Сюда ведёт кнопка «📸 Где это в Roblox» из сообщения «💰 Продажа и цена»,
   которое админка шлёт покупателю (`?stage=sale`). Пасс у него уже есть, но
   снят с продажи или стоит не столько. Раздел статичный: проверка ника ему
   не нужна, поэтому стоит сверху сразу. Кадры — те же, что в шаге 4 гайда.
   ───────────────────────────────────────────────────────────────────────── */

import { SaleScreens } from "./guide-steps";

/** До этого номинала заказ закрывается одним пассом (как в `buyer-step`). */
const SINGLE_PASS_MAX = 1500;

export default function SaleSteps({ amount }: { amount: number }) {
  const price = amount > 0 && amount <= SINGLE_PASS_MAX ? Math.ceil(amount / 0.7) : null;
  return (
    <section className="wbi-rescue" id="sale">
      <span className="k">💰 Продажа и цена</span>
      <h3>Включи продажу и поставь цену</h3>
      <p>
        Пасс есть, но мы не можем его выкупить, пока он <b>не продаётся</b> или стоит <b>другую сумму</b>.
        {price
          ? <> Нужная цена — <b>{price} R$</b>: Roblox забирает 30 %, и тебе придёт ровно {amount} R$.</>
          : <> Цену каждого пасса назвал бот — поставь ровно её.</>}
      </p>

      <ol className="wbi-ol">
        <li>Открой свой геймпасс в Creator Hub.</li>
        <li>В меню пасса выбери <span className="wbi-pill">Sales</span> (на телефоне — через <span className="wbi-pill">☰</span> слева вверху).</li>
        <li>Включи <b>Item for sale</b> — ползунок станет синим.</li>
        <li>В поле <b>Price</b> впиши {price ? <b>{price}</b> : "цену из бота"}.</li>
        <li>Проверь, что <b>Managed pricing</b> <b>ОТКЛЮЧЁН</b> — иначе Roblox сам поменяет цену.</li>
        <li>Нажми синюю <b>Save Changes</b>.</li>
      </ol>

      <SaleScreens />

      <div className="wbi-ok" style={{ marginTop: 12 }}>
        <b>Сохранил?</b> Вернись в бота и пришли ссылку на геймпасс — проверим и выкупим.
      </div>
    </section>
  );
}
