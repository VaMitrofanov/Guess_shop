import styles from "@/components/admin/admin-shell.module.css";
import css from "./visitors.module.css";
import { loadFunnelReport, loadVisitReport, type FunnelRow, type VisitSlice } from "@/lib/site-visits";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  phone: "Телефон", tablet: "Планшет", desktop: "Компьютер",
  browser: "Обычный браузер", telegram: "Внутри Telegram", vk: "Внутри ВК", instagram: "Внутри Instagram", other: "Другое приложение",
  unknown: "Не определено",
  direct: "Прямой заход / из приложения", wb: "Wildberries (карта, чат)", yandex: "Яндекс", google: "Google", internal: "Переход по сайту",
};

function Share({ title, rows, total }: { title: string; rows: VisitSlice[]; total: number }) {
  return (
    <section className={css.card}>
      <h2 className={css.h}>{title}</h2>
      {rows.length === 0 && <p className={css.muted}>Пока нет данных.</p>}
      {rows.map((r) => {
        const pct = total ? Math.round((r.visitors / total) * 100) : 0;
        return (
          <div key={r.key} className={css.row}>
            <div className={css.rowHead}><span>{LABEL[r.key] ?? r.key}</span><b>{pct}%</b></div>
            <div className={css.bar}><i style={{ width: `${pct}%` }} /></div>
            <span className={css.muted}>{r.visitors} посетителей · {r.visits} просмотров</span>
          </div>
        );
      })}
    </section>
  );
}

const STEP: Record<string, string> = {
  "1_potential": "Пришли не только за инструкцией",
  "2_home": "Открыли главную",
  "3_codes": "Долистали до кодов",
  "4_pack": "Выбрали номинал (кликом)",
  "5_buy": "Нажали «Купить» / «Подарить»",
  "6_order": "Заказ создан, ушли на оплату",
  "7_paid": "Оплатили",
};
const SECTION: Record<string, string> = {
  codes: "Коды", trust: "Полоса «почему безопасно»", calculator: "Геймпасс (калькулятор)", compare: "Сравнение «код или геймпасс»",
  reviews: "Отзывы", gift: "Подарок открыткой", invite: "Приглашения", bottom: "Финальный блок «Готов?»",
};
const GP: Record<string, string> = {
  calculator: "Долистали до калькулятора", amount: "Выбрали сумму", checkout: "Нажали «Проверить и оформить»",
  checkout_page: "Открыли страницу оформления", gift_on: "Включили «В подарок» в кодах",
};
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

function Steps({ title, note, rows, label, base }: { title: string; note?: string; rows: FunnelRow[]; label: Record<string, string>; base: number }) {
  return (
    <section className={css.card}>
      <h2 className={css.h}>{title}</h2>
      {note && <p className={css.muted}>{note}</p>}
      {rows.length === 0 && <p className={css.muted}>Пока нет данных.</p>}
      {rows.map((r) => {
        const w = base ? Math.min(100, Math.round((r.a / base) * 100)) : 0;
        return (
          <div key={r.key} className={css.row}>
            <div className={css.rowHead}><span>{label[r.key] ?? r.key}</span><b>{r.a} · {pct(r.a, base)}</b></div>
            <div className={css.bar}><i style={{ width: `${w}%` }} /></div>
          </div>
        );
      })}
    </section>
  );
}

function Table({ title, note, head, rows }: { title: string; note?: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <section className={css.card}>
      <h2 className={css.h}>{title}</h2>
      {note && <p className={css.muted}>{note}</p>}
      {rows.length === 0 ? <p className={css.muted}>Пока нет данных.</p> : (
        <table className={css.table}>
          <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      )}
    </section>
  );
}

/** 📊 Посетители сайта (18.11.2026): своя аналитика — без сторонних счётчиков. */
export default async function VisitorsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: raw } = await searchParams;
  const days = raw === "7" ? 7 : raw === "1" ? 1 : 30;
  const [r, f] = await Promise.all([loadVisitReport(days), loadFunnelReport(days)]);
  const home = f.funnel.find((x) => x.key === "2_home")?.a ?? 0;
  const ordersTotal = f.orders.reduce((acc, x) => ({ a: acc.a + x.a, b: acc.b + x.b, c: acc.c + x.c }), { a: 0, b: 0, c: 0 });
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Сайт · своя аналитика с 18.11.2026</span>
          <h1>Посетители</h1>
          <p>С каких устройств заходят, откуда приходят, кто дошёл до оплаты и где бросил. Без IP и cookies: посетитель — анонимный номер в браузере. Данные копятся с 18.11.2026; объём за прошлые месяцы — в docs/site-analytics.md.</p>
        </div>
      </header>
      <nav className={css.tabs} aria-label="Период">
        {[["1", "Сутки"], ["7", "7 дней"], ["30", "30 дней"]].map(([v, l]) => (
          <a key={v} href={`?days=${v}`} aria-current={String(days) === v ? "page" : undefined} className={String(days) === v ? css.tabOn : css.tab}>{l}</a>
        ))}
      </nav>
      <div className={css.kpis}>
        <div className={css.kpi}><b>{r.visitors}</b><span>посетителей</span></div>
        <div className={css.kpi}><b>{r.visits}</b><span>просмотров</span></div>
        <div className={css.kpi}><b>{r.visitors ? (r.visits / r.visitors).toFixed(1) : "—"}</b><span>страниц на человека</span></div>
      </div>
      {/* 📈 Без гейта инструкции (18.11.2026): «потенциальный» — открыл хоть что-то
          кроме /guide, /pending, /wb/… Покупатели карт WB, пришедшие только ввести
          код, — отдельно. */}
      <div className={css.kpis}>
        <div className={css.kpi}><b>{f.people.potential}</b><span>потенциальных покупателей — пришли не только за инструкцией</span></div>
        <div className={css.kpi}><b>{f.people.guideOnly}</b><span>только инструкция WB (ввели код и ушли)</span></div>
        <div className={css.kpi}><b>{f.people.wbToStore}</b><span>покупатели WB, заглянувшие на витрину — аудитория для кодов</span></div>
      </div>
      <div className={css.grid}>
        <Steps title="Воронка кодов" note="Люди, а не клики. Номинал 800 выбран заранее, поэтому «выбрали кликом» может быть меньше, чем «нажали купить»." rows={f.funnel} label={STEP} base={f.funnel[0]?.a ?? 0} />
        <Steps title="До каких блоков главной долистали" note="Доля — от открывших главную." rows={f.sections} label={SECTION} base={home} />
      </div>
      <div className={css.grid}>
        <Table title="Откуда пришли → покупка" note="Первый внешний источник посетителя за период; только потенциальные покупатели."
          head={["Источник", "Людей", "Нажали «Купить»", "Оплатили"]}
          rows={f.sources.map((x) => [LABEL[x.key] ?? x.key, x.a, `${x.b} · ${pct(x.b, x.a)}`, `${x.c} · ${pct(x.c, x.a)}`])} />
        <Table title="Номиналы кодов" note="Какие суммы смотрят и какие покупают."
          head={["Номинал", "Выбрали", "Нажали «Купить»", "Оплачено"]}
          rows={f.packs.map((x) => [`${Number(x.key).toLocaleString("ru-RU")} R$`, x.a, x.b, x.c])} />
      </div>
      <div className={css.grid}>
        <Table title="Брошенная оплата кодов" note={`Создано ${ordersTotal.a}, оплачено ${ordersTotal.b}, брошено ${ordersTotal.c} (не оплачены дольше часа). Считается по всем заказам, а не только с сайта.`}
          head={["Номинал", "Создано", "Оплачено", "Брошено"]}
          rows={f.orders.map((x) => [`${Number(x.key).toLocaleString("ru-RU")} R$`, x.a, x.b, `${x.c} · ${pct(x.c, x.a)}`])} />
        <Table title="Брошенная оплата по устройствам" note="Заказы, созданные на витрине после 18.11.2026."
          head={["Устройство", "Создано", "Брошено"]}
          rows={f.abandonedByDevice.map((x) => [LABEL[x.key] ?? x.key, x.a, `${x.b} · ${pct(x.b, x.a)}`])} />
      </div>
      <div className={css.grid}>
        <Steps title="Геймпасс и подарок" rows={f.gamepass} label={GP} base={home} />
      </div>
      <div className={css.grid}>
        <Share title="Устройства" rows={r.device} total={r.visitors} />
        <Share title="Где открывают" rows={r.app} total={r.visitors} />
        <Share title="Откуда пришли" rows={r.ref.filter((x) => x.key !== "internal")} total={r.visitors} />
        <Share title="Страницы" rows={r.routes} total={r.visitors} />
      </div>
      <section className={css.card}>
        <h2 className={css.h}>По дням (МСК)</h2>
        <div className={css.days}>
          {r.daily.map((d) => {
            const max = Math.max(...r.daily.map((x) => x.visitors), 1);
            return (
              <div key={d.key} className={css.day} title={`${d.key}: ${d.visitors} посетителей, ${d.visits} просмотров`}>
                <i style={{ height: `${Math.max(4, Math.round((d.visitors / max) * 100))}%` }} />
                <span>{d.key.slice(8)}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
