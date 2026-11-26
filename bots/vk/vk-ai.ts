/* ─────────────────────────────────────────────────────────────────────────────
   ИИ-поддержка в диалоге сообщества ВК (13.11.2026).

   Берёт только «разговорный» текст (вопрос, фраза из нескольких слов), и только
   когда автомат бота не ждёт конкретного ввода (прямой заказ, ключ Roblox).
   Модели здесь нет: решение даёт мост (`POST /support-ai`) на хосте TG-бота.

   • off — ничего не делаем, работает старая логика;
   • dry — покупатель видит старую логику, админам карточка «бот ответил бы»;
   • on  — reply: отвечает сам; escalate: обычный вызов поддержки (с сутью и
           черновиком), бот замолкает; ignore: молчит.
   Любой сбой модели или моста — `false`, и сообщение идёт старым путём.
   ───────────────────────────────────────────────────────────────────────── */

import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { escapeHtml, tgSend } from "../shared/notify";
import { aiLogCard, aiLogRecord } from "../shared/support-ai-log";
import { vkDialogLink } from "../shared/vk-links";
import { CATEGORY_RU, guardDecision, plain } from "../shared/pa-ai-support";
import { decideSupport, isConversationalText, supportCardTarget, supportChannelMode, TurnMemory } from "../shared/support-ai";
import { loadSupportCustomer } from "../shared/support-ai-context";
import { SUPPORT_METRIC_EVENT, recordSupportMetric } from "../shared/support-metric";

const memory = new TurnMemory();
const key = (vkUserId: number) => String(vkUserId);

/** Состояния, в которых бот ждёт конкретный ввод — их ИИ не перехватывает. */
export function vkStateAllowsAi(stateType: string | undefined): boolean {
  if (!stateType) return true;
  return !stateType.startsWith("AWAITING_DIRECT") && stateType !== "AWAITING_API_KEY";
}

/** Реплика сообщества (менеджер или бот) — в историю для модели. */
export function rememberVkOutbox(peer: number, text: string): void {
  memory.push(key(peer), "assistant", text);
}

async function card(html: string): Promise<void> {
  const target = await supportCardTarget(db);
  const thread = target.chatId ? target.topics.test : undefined;
  const ids = target.chatId ? [target.chatId] : ADMIN_IDS;
  await Promise.allSettled(ids.map((id) => tgSend(id, html.slice(0, 4000), {
    parse_mode: "HTML",
    ...(thread ? { message_thread_id: thread } : {}),
  })));
}

export interface VkAiDeps {
  reply: (text: string) => Promise<unknown>;
  /** Обычный вызов поддержки с готовым описанием (алерт + пауза бота). */
  escalate: (problemText: string) => Promise<void>;
  firstName: () => Promise<string>;
}

/** `true` — сообщение обработано ИИ; `false` — пусть работает старая логика. */
export async function tryVkAi(vkUserId: number, text: string, deps: VkAiDeps): Promise<boolean> {
  if (!isConversationalText(text)) return false;
  const mode = await supportChannelMode(db, "vk_bot");
  if (mode === "off") return false;

  memory.push(key(vkUserId), "user", text);
  const user = await db.user.findUnique({ where: { vkId: String(vkUserId) }, select: { id: true, name: true } }).catch(() => null);
  const name = user?.name ?? await deps.firstName().catch(() => null);
  const { context, orders } = await loadSupportCustomer(db, { userId: user?.id, name });
  const raw = await decideSupport({ channel: "vk_bot", context, turns: memory.get(key(vkUserId)) });
  if (!raw || raw === "out_of_money") return false;
  const d = guardDecision(raw, text, "vk_bot");
  void aiLogRecord(db, {
    channel: "vk_bot", action: d.action, mode: mode as "on" | "dry", category: d.category,
    peerKey: `vk:${vkUserId}`, orderCode: orders[0]?.wbCode ?? null,
    question: text, answer: d.action === "reply" ? plain(d.reply) : d.draft || null, summary: d.summary || null,
  });

  const order = orders[0];
  const head = [
    `👤 ${vkDialogLink(vkUserId, escapeHtml(name ?? `VK ${vkUserId}`))} · ВК`,
    order ? `📦 ${order.wbCode} · ${order.amount} R$ · ${order.status}${order.heldAt ? " · ❄️" : ""}` : "📦 заказов в базе нет",
    "",
    `💬 «${escapeHtml(text.slice(0, 600))}»`,
  ].join("\n");

  if (mode === "dry") {
    if (d.action === "ignore") return false;
    const body = d.action === "reply"
      ? `🧪 <b>ВК: бот ответил бы сам</b> · ${CATEGORY_RU[d.category]}\n${head}\n\n🤖 ${escapeHtml(plain(d.reply))}`
      : `🧪 <b>ВК: бот передал бы вам</b> · ${CATEGORY_RU[d.category]}\n${head}\n\n🧾 ${escapeHtml(d.summary || "—")}` +
        (d.draft.trim() ? `\n\n✍️ <b>Черновик:</b>\n${escapeHtml(d.draft.trim())}` : "");
    await card(body);
    return false;
  }

  if (d.action === "ignore") return true;
  if (d.action === "reply") {
    const answer = plain(d.reply);
    await deps.reply(answer);
    memory.push(key(vkUserId), "assistant", answer);
    // Журнал: каждый ответ ИИ виден админам, без звука (26.11.2026).
    void aiLogCard(db, `🤖 <b>ВК: ответил сам</b> · ${CATEGORY_RU[d.category]}\n${head}\n\n🤖 ${escapeHtml(answer)}`, { silent: true });
    void recordSupportMetric(db as never, {
      type: SUPPORT_METRIC_EVENT.SELF_SERVED, wbCode: order?.wbCode, via: "vk-bot",
      payload: { kind: "ai", category: d.category },
    });
    return true;
  }
  const problem = [
    text,
    "",
    `🤖 ${d.summary || CATEGORY_RU[d.category]}`,
    d.draft.trim() ? `✍️ Черновик ответа: ${d.draft.trim()}` : "",
  ].filter(Boolean).join("\n");
  await deps.escalate(problem);
  return true;
}
