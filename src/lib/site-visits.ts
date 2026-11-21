import "server-only";
import { prisma } from "@/lib/prisma";

/* 📊 Посетители сайта (18.11.2026): своя аналитика из `PerformanceSample`
   (surface = "site-visit", metric = "<устройство>:<источник>", rating = встроенный
   браузер, fingerprint = анонимный id). Один заход в базу на срез. */

export type VisitSlice = { key: string; visits: number; visitors: number };
export type VisitReport = {
  days: number;
  visits: number;
  visitors: number;
  device: VisitSlice[];
  app: VisitSlice[];
  ref: VisitSlice[];
  routes: VisitSlice[];
  daily: VisitSlice[];
};

export async function loadVisitReport(days: number): Promise<VisitReport> {
  const since = new Date(Date.now() - days * 86_400_000);
  type Row = { dim: string; key: string; visits: number; visitors: number };
  const rows = await prisma.$queryRaw<Row[]>`
    WITH v AS (
      SELECT split_part(metric, ':', 1) AS device, split_part(metric, ':', 2) AS ref, rating AS app, route, fingerprint AS who,
             to_char("createdAt" AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS day
      FROM "PerformanceSample" WHERE surface = 'site-visit' AND "createdAt" >= ${since}
    )
    SELECT 'all' AS dim, 'all' AS key, count(*)::int AS visits, count(DISTINCT who)::int AS visitors FROM v
    UNION ALL SELECT 'device', device, count(*)::int, count(DISTINCT who)::int FROM v GROUP BY device
    UNION ALL SELECT 'app', app, count(*)::int, count(DISTINCT who)::int FROM v GROUP BY app
    UNION ALL SELECT 'ref', ref, count(*)::int, count(DISTINCT who)::int FROM v GROUP BY ref
    UNION ALL SELECT 'route', route, count(*)::int, count(DISTINCT who)::int FROM v GROUP BY route
    UNION ALL SELECT 'day', day, count(*)::int, count(DISTINCT who)::int FROM v GROUP BY day
  `;
  const pick = (dim: string) => rows.filter((r) => r.dim === dim).map(({ key, visits, visitors }) => ({ key, visits, visitors }))
    .sort((a, b) => (dim === "day" ? a.key.localeCompare(b.key) : b.visitors - a.visitors));
  const all = rows.find((r) => r.dim === "all");
  return {
    days, visits: all?.visits ?? 0, visitors: all?.visitors ?? 0,
    device: pick("device"), app: pick("app"), ref: pick("ref"), routes: pick("route").slice(0, 12), daily: pick("day"),
  };
}

/* 📈 Воронка и поведение (18.11.2026): события витрины (`site-event`, см.
   `src/lib/site-track.ts`) поверх посещений. «Потенциальный» посетитель — тот,
   кто открыл хоть что-то кроме инструкции WB (`/guide`, `/pending`, `/wb/…`):
   больше половины людей на сайте — покупатели карт, которые пришли только
   ввести код. Оплата узнаётся по id заказа кода из события `order`. Один
   заход в базу. */

export type FunnelRow = { key: string; a: number; b: number; c: number };
export type FunnelReport = {
  people: { all: number; guideOnly: number; potential: number; wbToStore: number };
  /** Шаги воронки кодов: key = шаг, a = людей. */
  funnel: FunnelRow[];
  /** Откуда пришли (первый внешний источник): a = потенциальных, b = нажали «Купить», c = оплатили. */
  sources: FunnelRow[];
  /** Блоки главной: a = долистали. Порядок — как на странице. */
  sections: FunnelRow[];
  /** Номиналы кодов: a = выбрали кликом, b = нажали «Купить», c = оплатили. */
  packs: FunnelRow[];
  /** Заказы кодов: a = создано, b = оплачено, c = брошено (старше часа, не оплачены). */
  orders: FunnelRow[];
  /** Брошенные заказы по устройству: a = создано, b = брошено. */
  abandonedByDevice: FunnelRow[];
  /** Калькулятор геймпасса: a = людей. */
  gamepass: FunnelRow[];
};

export const SECTION_ORDER = ["codes", "trust", "calculator", "compare", "reviews", "gift", "invite", "bottom"] as const;

export async function loadFunnelReport(days: number): Promise<FunnelReport> {
  const since = new Date(Date.now() - days * 86_400_000);
  const hourAgo = new Date(Date.now() - 3_600_000);
  type Row = { dim: string; key: string; a: number; b: number; c: number };
  const rows = await prisma.$queryRaw<Row[]>`
    WITH v AS (
      SELECT fingerprint AS who, route, split_part(metric, ':', 1) AS device, split_part(metric, ':', 2) AS ref, "createdAt" AS at
      FROM "PerformanceSample" WHERE surface = 'site-visit' AND "createdAt" >= ${since} AND fingerprint IS NOT NULL
    ),
    e AS (
      SELECT fingerprint AS who, metric AS name, rating AS val FROM "PerformanceSample"
      WHERE surface = 'site-event' AND "createdAt" >= ${since} AND fingerprint IS NOT NULL
    ),
    p AS (
      SELECT who,
             bool_and(route ~ '^/(guide|pending|wb)(/|$)') AS guide_only,
             bool_or(ref = 'wb') AS wb,
             bool_or(route = '/') AS home,
             coalesce((array_agg(ref ORDER BY at) FILTER (WHERE ref NOT IN ('internal', '')))[1], 'direct') AS src,
             (array_agg(device ORDER BY at))[1] AS device
      FROM v GROUP BY who
    ),
    pot AS (SELECT * FROM p WHERE NOT guide_only),
    co AS (
      SELECT "publicId" AS id, denomination, "createdAt" AS at,
             ("paidAt" IS NOT NULL OR status IN ('PAID', 'ISSUED')) AS paid
      FROM "CodeOrder" WHERE "createdAt" >= ${since}
    ),
    eo AS (SELECT DISTINCT e.who, co.paid, co.at, co.id FROM e JOIN co ON co.id = e.val WHERE e.name = 'order'),
    payers AS (SELECT DISTINCT who FROM eo WHERE paid)
    SELECT 'people' AS dim, 'all' AS key, count(*)::int AS a,
           count(*) FILTER (WHERE guide_only)::int AS b, count(*) FILTER (WHERE wb AND NOT guide_only)::int AS c FROM p
    UNION ALL SELECT 'funnel', '1_potential', count(*)::int, 0, 0 FROM pot
    UNION ALL SELECT 'funnel', '2_home', count(*)::int, 0, 0 FROM pot WHERE home
    UNION ALL SELECT 'funnel', '3_codes', count(DISTINCT who)::int, 0, 0 FROM e WHERE name = 'section' AND val = 'codes'
    UNION ALL SELECT 'funnel', '4_pack', count(DISTINCT who)::int, 0, 0 FROM e WHERE name = 'pack'
    UNION ALL SELECT 'funnel', '5_buy', count(DISTINCT who)::int, 0, 0 FROM e WHERE name = 'buy_click'
    UNION ALL SELECT 'funnel', '6_order', count(DISTINCT who)::int, 0, 0 FROM eo
    UNION ALL SELECT 'funnel', '7_paid', count(*)::int, 0, 0 FROM payers
    UNION ALL SELECT 'source', pot.src, count(*)::int,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM e WHERE e.who = pot.who AND e.name = 'buy_click'))::int,
           count(*) FILTER (WHERE pot.who IN (SELECT who FROM payers))::int
      FROM pot GROUP BY pot.src
    UNION ALL SELECT 'section', val, count(DISTINCT who)::int, 0, 0 FROM e WHERE name = 'section' AND val IS NOT NULL GROUP BY val
    UNION ALL SELECT 'pack', d::text,
           (SELECT count(DISTINCT who) FROM e WHERE name = 'pack' AND val = d::text)::int,
           (SELECT count(DISTINCT who) FROM e WHERE name = 'buy_click' AND val = d::text)::int,
           (SELECT count(*) FROM co WHERE denomination = d AND paid)::int
      FROM (SELECT DISTINCT val::int AS d FROM e WHERE name IN ('pack', 'buy_click') AND val ~ '^[0-9]{1,6}$'
            UNION SELECT denomination FROM co) ds
    UNION ALL SELECT 'orders', denomination::text, count(*)::int, count(*) FILTER (WHERE paid)::int,
           count(*) FILTER (WHERE NOT paid AND at < ${hourAgo})::int FROM co GROUP BY denomination
    UNION ALL SELECT 'abandon', coalesce(p.device, 'unknown'), count(*)::int,
           count(*) FILTER (WHERE NOT eo.paid AND eo.at < ${hourAgo})::int, 0
      FROM eo LEFT JOIN p ON p.who = eo.who GROUP BY coalesce(p.device, 'unknown')
    UNION ALL SELECT 'gp', 'gift_on', count(DISTINCT who)::int, 0, 0 FROM e WHERE name = 'gift_on'
    UNION ALL SELECT 'gp', 'calculator', count(DISTINCT who)::int, 0, 0 FROM e WHERE name = 'section' AND val = 'calculator'
    UNION ALL SELECT 'gp', 'amount', count(DISTINCT who)::int, 0, 0 FROM e WHERE name = 'gp_amount'
    UNION ALL SELECT 'gp', 'checkout', count(DISTINCT who)::int, 0, 0 FROM e WHERE name = 'gp_checkout'
    UNION ALL SELECT 'gp', 'checkout_page', count(DISTINCT who)::int, 0, 0 FROM v WHERE route = '/checkout'
  `;
  const pick = (dim: string) => rows.filter((r) => r.dim === dim).map(({ key, a, b, c }) => ({ key, a, b, c }));
  const people = rows.find((r) => r.dim === "people");
  const sectionRank = (k: string) => { const i = (SECTION_ORDER as readonly string[]).indexOf(k); return i < 0 ? 99 : i; };
  return {
    people: {
      all: people?.a ?? 0,
      guideOnly: people?.b ?? 0,
      potential: (people?.a ?? 0) - (people?.b ?? 0),
      wbToStore: people?.c ?? 0,
    },
    funnel: pick("funnel").sort((x, y) => x.key.localeCompare(y.key)),
    sources: pick("source").sort((x, y) => y.a - x.a),
    sections: pick("section").sort((x, y) => sectionRank(x.key) - sectionRank(y.key)),
    packs: pick("pack").sort((x, y) => Number(x.key) - Number(y.key)),
    orders: pick("orders").sort((x, y) => Number(x.key) - Number(y.key)),
    abandonedByDevice: pick("abandon").sort((x, y) => y.a - x.a),
    gamepass: pick("gp"),
  };
}
