/* ─────────────────────────────────────────────────────────────────────────────
   📰 Часовая сводка «Ленты заказов» (15.11.2026, решение владельца по уведам).

   Одиночные «делать ничего не нужно» больше не идут отдельными сообщениями:
   строка ложится в `AdminDigestItem`, а TG-бот раз в час отправляет одно
   сообщение «📰 Лента за час · N» в тему «Лента заказов». Пишут и сайт, и боты
   (общая таблица — без гонок за один курсор). Корни веток заказов (карточка
   активации, живая карточка DBS) сюда не идут: на них отвечают другие уведы.
   ───────────────────────────────────────────────────────────────────────── */

import { formatAdminNotice } from "./notify-format";

type DigestDb = {
  adminDigestItem: {
    create(args: { data: { line: string; topic?: string } }): Promise<unknown>;
    findMany(args: unknown): Promise<{ id: string; line: string; createdAt: Date }[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

const MAX_ITEMS = 40;

/** Положить строку в сводку. Никогда не бросает: уведомление не ломает дело. */
export async function queueAdminDigest(db: DigestDb, line: string): Promise<void> {
  try {
    await db.adminDigestItem.create({ data: { line: line.slice(0, 500), topic: "feed" } });
  } catch (error) {
    console.warn("[admin-digest] не записано:", error instanceof Error ? error.message : error);
  }
}

export function renderDigest(lines: string[], extra = 0): string {
  return formatAdminNotice({
    marker: "done",
    zone: "СИСТЕМА",
    title: `лента за час · ${lines.length + extra}`,
    lines: [...lines.map((line) => `• ${line}`), extra > 0 ? `<i>…и ещё ${extra}</i>` : null],
  });
}

/**
 * Отправить накопленное одним сообщением. Сначала помечаем строки отправленными
 * (по id), потом шлём: второй процесс не отправит их повторно.
 */
export async function flushAdminDigest(db: DigestDb, send: (text: string) => Promise<boolean>): Promise<number> {
  const items = await db.adminDigestItem.findMany({
    where: { sentAt: null, topic: "feed" },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: { id: true, line: true, createdAt: true },
  });
  if (items.length === 0) return 0;
  const claimed = await db.adminDigestItem.updateMany({
    where: { id: { in: items.map((item) => item.id) }, sentAt: null },
    data: { sentAt: new Date() },
  });
  if (claimed.count === 0) return 0;
  const shown = items.slice(-MAX_ITEMS).map((item) => item.line);
  const ok = await send(renderDigest(shown, items.length - shown.length));
  if (!ok) {
    // Не ушло — вернём строки в очередь до следующего часа.
    await db.adminDigestItem.updateMany({ where: { id: { in: items.map((item) => item.id) } }, data: { sentAt: null } });
    return 0;
  }
  return items.length;
}
