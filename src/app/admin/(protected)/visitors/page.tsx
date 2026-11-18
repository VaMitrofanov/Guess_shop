import styles from "@/components/admin/admin-shell.module.css";
import css from "./visitors.module.css";
import { loadVisitReport, type VisitSlice } from "@/lib/site-visits";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  phone: "Телефон", tablet: "Планшет", desktop: "Компьютер",
  browser: "Обычный браузер", telegram: "Внутри Telegram", vk: "Внутри ВК", instagram: "Внутри Instagram", other: "Другое приложение",
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

/** 📊 Посетители сайта (18.11.2026): своя аналитика — без сторонних счётчиков. */
export default async function VisitorsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: raw } = await searchParams;
  const days = raw === "7" ? 7 : raw === "1" ? 1 : 30;
  const r = await loadVisitReport(days);
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Сайт · своя аналитика с 18.11.2026</span>
          <h1>Посетители</h1>
          <p>С каких устройств заходят, внутри каких приложений открывают сайт и откуда приходят. Без IP и cookies: посетитель — анонимный номер в браузере. Данные копятся с 18.11.2026; объём за прошлые месяцы — в docs/site-analytics.md.</p>
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
