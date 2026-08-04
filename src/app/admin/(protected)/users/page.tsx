import Link from "next/link";
import { Suspense } from "react";
import {
  CalendarDays,
  Database,
  ExternalLink,
  Link2,
  Mail,
  MessagesSquare,
  Repeat2,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  UserRoundCheck,
  Users,
} from "lucide-react";
import {
  AdminAudienceChannel,
  AdminAudienceFilter,
  getAdminAudienceData,
  getCommunityAudienceSnapshot,
} from "@/lib/admin-audience";
import styles from "@/components/admin/admin-shell.module.css";
import { cn } from "@/lib/utils";
import { ADMIN_TIME_ZONE } from "@/lib/admin-time";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FILTERS: Array<{ key: AdminAudienceFilter; label: string }> = [
  { key: "all", label: "Все" },
  { key: "tg", label: "Telegram" },
  { key: "vk", label: "VK" },
  { key: "email", label: "Email" },
  { key: "multi", label: "Несколько каналов" },
  { key: "unlinked", label: "Без канала" },
];

function date(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: ADMIN_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: ADMIN_TIME_ZONE,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ChannelBadge({ channel, legacyOnly = false }: { channel: AdminAudienceChannel; legacyOnly?: boolean }) {
  return (
    <span className={cn(
      styles.channelBadge,
      channel === "TG" && styles.channelTg,
      channel === "VK" && styles.channelVk,
      channel === "EMAIL" && styles.channelEmail,
      legacyOnly && styles.channelLegacy,
    )}>
      {channel === "TG" ? <Send /> : channel === "VK" ? <MessagesSquare /> : <Mail />}
      {channel}{legacyOnly ? " · старый формат" : ""}
    </span>
  );
}

function filterCount(filter: AdminAudienceFilter, summary: Awaited<ReturnType<typeof getAdminAudienceData>>["summary"]) {
  if (filter === "tg") return summary.tgProfiles;
  if (filter === "vk") return summary.vkProfiles;
  if (filter === "email") return summary.emailProfiles;
  if (filter === "multi") return summary.multiChannel;
  if (filter === "unlinked") return summary.unlinked;
  return summary.totalProfiles;
}

async function CommunityAudiencePanel() {
  const data = await getCommunityAudienceSnapshot();
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <strong>Публичные сообщества</strong>
        <span>Сверено {dateTime(data.checkedAt)} · кэш до 5 минут</span>
      </div>
      <div className={styles.communityGrid}>
        {data.communities.map((community) => (
          <a className={styles.communityCard} href={community.href} target="_blank" rel="noreferrer" key={community.platform}>
            <div className={cn(styles.communityIcon, community.platform === "TG" ? styles.metricIconTg : styles.metricIconVk)}>
              {community.platform === "TG" ? <Send /> : <MessagesSquare />}
            </div>
            <div>
              <span>{community.label}</span>
              <strong>{community.members === null ? "—" : community.members.toLocaleString("ru-RU")}</strong>
              <small>{community.members === null ? "API временно недоступен" : "участников / подписчиков"} · {community.handle}</small>
            </div>
            <ExternalLink />
          </a>
        ))}
      </div>
      <p className={styles.panelNote}>
        Это размер публичных сообществ, а не число профилей в базе. Недоступность TG/VK API не блокирует список клиентов.
      </p>
    </section>
  );
}

function usersHref(filter: AdminAudienceFilter, query: string, cursor?: string | null) {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("channel", filter);
  if (query) params.set("q", query);
  if (cursor) params.set("cursor", cursor);
  const suffix = params.toString();
  return suffix ? `/admin/users?${suffix}` : "/admin/users";
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; q?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const { channel } = params;
  const activeFilter = FILTERS.some((filter) => filter.key === channel)
    ? channel as AdminAudienceFilter
    : "all";
  const query = params.q?.trim().slice(0, 120) ?? "";
  const data = await getAdminAudienceData({
    filter: activeFilter,
    query,
    cursor: params.cursor,
    limit: 50,
  });
  const users = data.users;
  const canonicalCoverage = data.summary.socialProfiles > 0
    ? Math.round((data.summary.canonicalSocialProfiles / data.summary.socialProfiles) * 100)
    : 100;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>CRM · профили, каналы и аудитория сообществ</span>
          <h1>Пользователи</h1>
          <p>
            Профили в базе отделены от подписчиков Telegram/VK. Список не ждёт внешние API и ищет по всей базе.
          </p>
        </div>
      </header>

      <section className={styles.audienceMetricGrid} aria-label="Профили по каналам">
        <article className={styles.metricCard}>
          <div className={styles.metricIcon}><Users /></div>
          <strong>{data.summary.totalProfiles.toLocaleString("ru-RU")}</strong>
          <span>Всего профилей</span>
          <small>{data.summary.customerProfiles} клиентов · {data.summary.admins} админов</small>
        </article>
        <article className={styles.metricCard}>
          <div className={cn(styles.metricIcon, styles.metricIconTg)}><Send /></div>
          <strong>{data.summary.tgProfiles.toLocaleString("ru-RU")}</strong>
          <span>Telegram-профили</span>
          <small>{data.summary.tgOnly} без VK · legacy + identity</small>
        </article>
        <article className={styles.metricCard}>
          <div className={cn(styles.metricIcon, styles.metricIconVk)}><MessagesSquare /></div>
          <strong>{data.summary.vkProfiles.toLocaleString("ru-RU")}</strong>
          <span>VK-профили</span>
          <small>{data.summary.vkOnly} без Telegram · legacy + identity</small>
        </article>
        <article className={styles.metricCard}>
          <div className={cn(styles.metricIcon, styles.metricIconEmail)}><Mail /></div>
          <strong>{data.summary.emailProfiles.toLocaleString("ru-RU")}</strong>
          <span>Email-профили</span>
          <small>{data.summary.verifiedEmails} подтверждено</small>
        </article>
      </section>

      <div className={styles.audienceOverviewGrid}>
        <Suspense fallback={<section className={styles.panel}><div className={styles.empty}>Обновляем TG/VK-метрики отдельно…</div></section>}>
          <CommunityAudiencePanel />
        </Suspense>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><strong>Качество клиентской базы</strong><span>Только production, тестовые заказы исключены</span></div>
          <div className={styles.audienceStatList}>
            <div><ShoppingBag /><span><strong>{data.summary.withOrders}</strong><small>профилей с заказами</small></span></div>
            <div><Repeat2 /><span><strong>{data.summary.repeatBuyers}</strong><small>повторных покупателей</small></span></div>
            <div><UserRoundCheck /><span><strong>{data.summary.new30d}</strong><small>новых за 30 дней</small></span></div>
            <div><Link2 /><span><strong>{data.summary.multiChannel}</strong><small>профилей с несколькими каналами</small></span></div>
          </div>
        </section>
      </div>

      {data.summary.legacyOnlyProfiles > 0 && (
        <div className={styles.noteWarn} style={{ marginTop: 15 }}>
          <Database />
          <div>
            <b>Каноническая UserIdentity покрывает {canonicalCoverage}% социальных профилей.</b>{" "}
            У {data.summary.legacyOnlyProfiles} профилей канал пока хранится только в legacy-поле:
            Telegram — {data.summary.legacyOnlyTg}, VK — {data.summary.legacyOnlyVk}. В общие числа выше они включены, поэтому аудитория не занижена.
          </div>
        </div>
      )}

      <section className={styles.panel} style={{ marginTop: 15 }}>
        <div className={styles.panelHeader}>
          <strong>Профили по каналам</strong>
          <span>{data.total.toLocaleString("ru-RU")} в сегменте · по 50</span>
        </div>
        <div className={styles.filters}>
          <form className={styles.search} action="/admin/users" method="get">
            <Search />
            <input name="q" defaultValue={query} aria-label="Поиск пользователей" placeholder="Имя, email, TG/VK ID" />
            {activeFilter !== "all" && <input type="hidden" name="channel" value={activeFilter} />}
          </form>
        </div>
        <nav className={styles.segmentTabs} aria-label="Фильтр пользователей">
          {FILTERS.map((filter) => (
            <Link
              className={cn(styles.segmentTab, activeFilter === filter.key && styles.segmentTabActive)}
              href={usersHref(filter.key, query)}
              key={filter.key}
            >
              {filter.label}<b>{filterCount(filter.key, data.summary)}</b>
            </Link>
          ))}
        </nav>
        <div className={cn(styles.tableWrap, styles.responsiveTableWrap)}>
          <table className={cn(styles.table, styles.responsiveTable)}>
            <thead>
              <tr><th>Пользователь</th><th>Каналы</th><th>Контакт</th><th>Заказы</th><th>Создан</th></tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td data-label="Пользователь">
                    <span className={styles.tablePrimary}>{user.name || user.username || "Без имени"}</span>
                    <span className={styles.tableSecondary}>
                      {user.isAdmin ? <><ShieldCheck size={12} /> Администратор</> : "Клиент"}
                    </span>
                  </td>
                  <td data-label="Каналы">
                    <div className={styles.channelBadges}>
                      {user.channels.map((channel) => (
                        <ChannelBadge channel={channel} legacyOnly={user.legacyOnlyChannels.includes(channel as "TG" | "VK")} key={channel} />
                      ))}
                      {user.channels.length === 0 && <span className={styles.dim}>Без канала</span>}
                    </div>
                  </td>
                  <td data-label="Контакт">
                    <div className={styles.contactStack}>
                      {user.channelDetails.map((detail) => {
                        if (detail.channel === "EMAIL") {
                          return <span key={detail.channel}><Mail />{detail.subject}<small>{user.emailVerified ? "подтверждён" : "не подтверждён"}</small></span>;
                        }
                        const href = detail.channel === "TG"
                          ? detail.username ? `https://t.me/${detail.username}` : `tg://user?id=${detail.subject}`
                          : detail.username ? `https://vk.com/${detail.username}` : `https://vk.com/id${detail.subject}`;
                        return (
                          <a href={href} target="_blank" rel="noreferrer" key={detail.channel}>
                            {detail.channel === "TG" ? <Send /> : <MessagesSquare />}
                            {detail.username ? `@${detail.username}` : `${detail.channel} ID ${detail.subject}`}
                            {detail.username && <small>ID {detail.subject}</small>}
                          </a>
                        );
                      })}
                      {user.channelDetails.length === 0 && <span className={styles.dim}>—</span>}
                    </div>
                  </td>
                  <td data-label="Заказы"><span className={styles.tablePrimary}>{user.orders.toLocaleString("ru-RU")}</span></td>
                  <td data-label="Создан"><span className={styles.tableSecondary}><CalendarDays size={12} /> {date(user.createdAt)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {users.length === 0 && <div className={styles.empty}>В этом сегменте пока нет профилей.</div>}
        {data.nextCursor && (
          <div className={styles.panelHeader}>
            <span>Показано {users.length} · есть ещё</span>
            <Link href={usersHref(activeFilter, query, data.nextCursor)}>Следующие 50 →</Link>
          </div>
        )}
      </section>
    </div>
  );
}
