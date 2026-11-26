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
