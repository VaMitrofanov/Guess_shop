/* ─────────────────────────────────────────────────────────────────────────────
   Журнал ИИ-поддержки (26.11.2026).

   Владелец: «хочется, чтобы он отвечал сам, но следить, где и о чём он
   общается». В режиме on ИИ отвечал молча — админы видели только то, что он
   передал человеку. Теперь каждый самостоятельный ответ (бот TG, ВК, чат WB,
   @RobloxBank_PA) уходит карточкой без звука в тему «🤖 ИИ — журнал»
   (бывшая «🧪 Тест ИИ», ключ темы `test`). Передачи человеку идут прежним
   путём, со звуком.

   Модуль без тяжёлых зависимостей: его тянет и ВК-бот.
   ───────────────────────────────────────────────────────────────────────── */

import { ADMIN_IDS } from "./admin";
import { tgSend } from "./notify";
import { supportCardTarget } from "./support-ai";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Карточка в тему журнала ИИ. `silent` — без звука (ответил сам). Сбой — не беда. */
export async function aiLogCard(db: Db, html: string, opts: { silent?: boolean } = {}): Promise<void> {
  const target = await supportCardTarget(db).catch(() => ({ chatId: null, topics: {} as Record<string, number> }));
  const thread = target.chatId ? target.topics.test : undefined;
  const ids = target.chatId ? [target.chatId] : ADMIN_IDS;
  await Promise.allSettled(ids.map((id) => tgSend(id, html.slice(0, 4000), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(thread ? { message_thread_id: thread } : {}),
    ...(opts.silent ? { disable_notification: true } : {}),
  })));
}

export interface AiLogEntry {
  channel: "tg_pa" | "tg_bot" | "vk_bot" | "wb_chat";
  action: "reply" | "escalate" | "ignore";
  mode: "on" | "dry";
  category: string;
  /** tg:<id> / vk:<id> / wb:<код> */
  peerKey: string;
  orderCode?: string | null;
  question: string;
  answer?: string | null;
  summary?: string | null;
}

/** Запись решения ИИ в базу — для еженедельного разбора. Сбой — не беда. */
export async function aiLogRecord(db: Db, e: AiLogEntry): Promise<void> {
  try {
    await db.aiSupportLog.create({
      data: {
        channel: e.channel, action: e.action, mode: e.mode, category: e.category.slice(0, 60),
        peerKey: e.peerKey.slice(0, 80), orderCode: e.orderCode?.slice(0, 40) ?? null,
        question: e.question.slice(0, 2000), answer: e.answer?.slice(0, 2000) ?? null,
        summary: e.summary?.slice(0, 1000) ?? null,
      },
    });
  } catch (err) {
    console.warn("[ai-log] запись не прошла:", err instanceof Error ? err.message : err);
  }
}

const CHANNEL_RU: Record<string, string> = {
  tg_pa: "@RobloxBank_PA", tg_bot: "бот TG", vk_bot: "ВК", wb_chat: "чаты WB",
};

/**
 * Итог недели ИИ — в «📊 Сводки» после еженедельной выгрузки диалогов PA:
 * сколько ответил сам / передал / промолчал по каналам и напоминание, что
 * выгрузка готова к разбору (разбирает Claude по просьбе владельца).
 */
export async function aiWeeklyReport(db: Db, exp: { since: Date; chats: number; messages: number }): Promise<void> {
  const rows: Array<{ channel: string; action: string; _count: { _all: number } }> = await db.aiSupportLog.groupBy({
    by: ["channel", "action"],
    where: { createdAt: { gte: exp.since }, mode: "on" },
    _count: { _all: true },
  }).catch(() => []);
  const by = new Map<string, { reply: number; escalate: number; ignore: number }>();
  for (const r of rows) {
    const c = by.get(r.channel) ?? { reply: 0, escalate: 0, ignore: 0 };
    if (r.action === "reply" || r.action === "escalate" || r.action === "ignore") c[r.action] += r._count._all;
    by.set(r.channel, c);
  }
  const lines = [...by.entries()].map(([ch, c]) =>
    `• ${CHANNEL_RU[ch] ?? ch}: ответил сам ${c.reply}, передал вам ${c.escalate}${c.ignore ? `, промолчал ${c.ignore}` : ""}`);
  const html = [
    `🧠 <b>ИИ-поддержка: итог с ${exp.since.toISOString().slice(0, 10)}</b>`,
    "",
    ...(lines.length ? lines : ["• ИИ в режиме on не отвечал"]),
    "",
    `📥 Выгрузка диалогов @RobloxBank_PA готова: чатов ${exp.chats}, новых сообщений ${exp.messages}.`,
    "Чтобы ИИ отвечал лучше — попросите Claude «разбор ИИ за неделю»: он прочитает журнал и диалоги и допишет базу знаний.",
  ].join("\n");
  const target = await supportCardTarget(db).catch(() => ({ chatId: null, topics: {} as Record<string, number> }));
  const thread = target.chatId ? target.topics.digest : undefined;
  const ids = target.chatId ? [target.chatId] : ADMIN_IDS;
  await Promise.allSettled(ids.map((id) => tgSend(id, html, {
    parse_mode: "HTML",
    ...(thread ? { message_thread_id: thread } : {}),
  })));
}
