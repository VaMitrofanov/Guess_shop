import { prisma } from "@/lib/prisma";
import type { AdminActor } from "@/lib/admin-access";

/* ─────────────────────────────────────────────────────────────────────────────
   «Пока вас не было» — окно у каждого админа своё.

   Общее окно «за 24 часа» на вопрос «что случилось, пока меня не было» не
   отвечает: админов трое, один заходил час назад, другой — позавчера. Поэтому
   отметка присутствия хранится на Telegram ID — том же, под которым пишутся
   действия админа и который проверяет `ADMIN_IDS`.

   Двух полей времени хватает, но нужны именно два:

   • `lastSeenAt`    — последний удар пульса, двигается на каждой загрузке;
   • `windowStartAt` — начало окна дифа, НЕ двигается, пока админ на месте.

   Второе поле и есть весь фокус. Если двигать одно `lastSeenAt`, то три
   обновления страницы подряд схлопнут окно в минуту и съедят диф ровно тогда,
   когда его читают. Окно сдвигается только после перерыва: вернулся через час
   — окно начинается там, где ты ушёл.
   ───────────────────────────────────────────────────────────────────────── */

/** Перерыв, после которого заход считается новым. Меньше — окно рвётся на
 *  чтении длинной ленты; больше — «пока вас не было» показывает позавчера. */
export const ADMIN_AWAY_GAP_MINUTES = 30;

/** Потолок окна: вернувшийся из отпуска не должен получить диф за месяц. */
export const ADMIN_WINDOW_MAX_DAYS = 7;

/** Первый в жизни заход: окна ещё нет, показываем прошедшие сутки. */
const FIRST_VISIT_HOURS = 24;

export interface AdminPresenceWindow {
  /** С какого момента считать диф. */
  windowStartAt: Date;
  /** Когда этот админ был здесь до текущей загрузки. `null` — впервые. */
  previousSeenAt: Date | null;
  /** Сколько его не было, минуты. `null` — впервые. */
  awayMinutes: number | null;
  /** Окно упёрлось в потолок `ADMIN_WINDOW_MAX_DAYS`. */
  capped: boolean;
  /** Диф собирается впервые — окно синтетическое, а не реальный уход. */
  firstVisit: boolean;
}

/**
 * Отметить заход админа и вернуть окно дифа.
 *
 * Вызывается РОВНО ОДИН РАЗ на загрузку страницы — из серверного компонента.
 * Клиентское обновление «Обзора» присутствие не трогает и получает `since`
 * параметром: иначе автообновление раз в минуту двигало бы окно само и
 * «Пока вас не было» всегда показывало бы пустоту.
 */
export async function touchAdminPresence(actor: AdminActor, now = new Date()): Promise<AdminPresenceWindow> {
  // Запасной вход (break-glass) идёт без Telegram ID: присутствие ему не
  // пишем — списка админов у него нет, а заводить второй ключ ради одного
  // аварийного сценария значит завести вторую правду о том, кто админ.
  if (actor.via !== "telegram") {
    return {
      windowStartAt: new Date(now.getTime() - FIRST_VISIT_HOURS * 3600_000),
      previousSeenAt: null,
      awayMinutes: null,
      capped: false,
      firstVisit: true,
    };
  }

  const telegramId = actor.telegramId;
  const floor = new Date(now.getTime() - ADMIN_WINDOW_MAX_DAYS * 86_400_000);
  const previous = await prisma.adminPresence.findUnique({
    where: { telegramId },
    select: { lastSeenAt: true, windowStartAt: true },
  });

  let windowStartAt: Date;
  let awayMinutes: number | null = null;
  let firstVisit = false;

  if (!previous) {
    windowStartAt = new Date(now.getTime() - FIRST_VISIT_HOURS * 3600_000);
    firstVisit = true;
  } else {
    const away = (now.getTime() - previous.lastSeenAt.getTime()) / 60_000;
    awayMinutes = Math.max(0, Math.round(away));
    // Ушёл и вернулся — окно начинается там, где он ушёл. Сидит на месте —
    // окно остаётся прежним, сколько бы раз он ни обновил страницу.
    windowStartAt = away >= ADMIN_AWAY_GAP_MINUTES ? previous.lastSeenAt : previous.windowStartAt;
  }

  const capped = windowStartAt < floor;
  if (capped) windowStartAt = floor;

  await prisma.adminPresence.upsert({
    where: { telegramId },
    create: { telegramId, displayName: actor.displayName, lastSeenAt: now, windowStartAt },
    update: { displayName: actor.displayName, lastSeenAt: now, windowStartAt },
  });

  return {
    windowStartAt,
    previousSeenAt: previous?.lastSeenAt ?? null,
    awayMinutes,
    capped,
    firstVisit,
  };
}

/** Кто ещё из админов был здесь недавно — для будущей отметки «в работе». */
export async function listRecentAdmins(withinMinutes = 15, now = new Date()) {
  const since = new Date(now.getTime() - withinMinutes * 60_000);
  return prisma.adminPresence.findMany({
    where: { lastSeenAt: { gte: since } },
    orderBy: { lastSeenAt: "desc" },
    select: { telegramId: true, displayName: true, lastSeenAt: true, currentOrderId: true },
  });
}
