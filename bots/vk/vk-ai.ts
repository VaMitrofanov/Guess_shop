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
import { aiLogCard, aiLogRecord, recallTurns } from "../shared/support-ai-log";
import { screenshotFact } from "../shared/support-ai-facts";
import { vkDialogLink } from "../shared/vk-links";
import { CATEGORY_RU, guardDecision, plain, refundGoesToWb } from "../shared/pa-ai-support";
import { AI_DEBOUNCE_MS, Debouncer, type SupportImage, decideSupport, isConversationalText, supportCardTarget, supportChannelMode, trailingUserText, TurnMemory } from "../shared/support-ai";
import { loadSupportCustomer } from "../shared/support-ai-context";
import { SUPPORT_METRIC_EVENT, recordSupportMetric } from "../shared/support-metric";

const memory = new TurnMemory();
const debouncer = new Debouncer();
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
export async function tryVkAi(vkUserId: number, text: string, deps: VkAiDeps, image?: SupportImage): Promise<boolean> {
  if (!isConversationalText(text)) return false;
  const mode = await supportChannelMode(db, "vk_bot");
  if (mode === "off") return false;

  if (!memory.has(key(vkUserId))) memory.seed(key(vkUserId), await recallTurns(db, "vk_bot", `vk:${vkUserId}`));
  memory.push(key(vkUserId), "user", text);
  if (mode === "on") {
    // ⏳ Склейка сообщений (27.11.2026): ответ — через AI_DEBOUNCE_MS после последнего.
    debouncer.schedule(key(vkUserId), AI_DEBOUNCE_MS, async () => {
      const joined = trailingUserText(memory.get(key(vkUserId))) || text;
      const r = await answerVkAi(vkUserId, joined, deps, mode, image);
      if (r === "failed") await deps.escalate(joined);
    });
    return true;
  }
  return (await answerVkAi(vkUserId, text, deps, mode, image)) === "handled";
}

/**
 * Обращение через кнопку поддержки (28.11.2026, 4E7XZ7H): раньше описание сразу
 * уходило менеджеру и бот вставал на паузу 24 ч — клиент молчал в ответ на
 * «Ничего не получается». Теперь сначала отвечает ИИ (тема кнопки — в тексте);
 * передать человеку он решает сам (`deps.escalate`). `false` — пусть идёт старый путь.
 */
export async function answerVkIntake(vkUserId: number, text: string, deps: VkAiDeps, image?: SupportImage): Promise<boolean> {
  if ((await supportChannelMode(db, "vk_bot")) !== "on") return false;
  if (!memory.has(key(vkUserId))) memory.seed(key(vkUserId), await recallTurns(db, "vk_bot", `vk:${vkUserId}`));
  memory.push(key(vkUserId), "user", text);
  return (await answerVkAi(vkUserId, text, deps, "on", image)) === "handled";
}

async function answerVkAi(vkUserId: number, text: string, deps: VkAiDeps, mode: "on" | "dry", image?: SupportImage): Promise<"handled" | "ignored" | "failed"> {
  const user = await db.user.findUnique({ where: { vkId: String(vkUserId) }, select: { id: true, name: true } }).catch(() => null);
  const name = user?.name ?? await deps.firstName().catch(() => null);
  const { context: baseContext, orders, codeOrders } = await loadSupportCustomer(db, { userId: user?.id, name });
  // 📷 Скриншот с вопросом (27.11.2026): ВК качает картинку сам (CDN ВК за рубеж не отдаёт), Pending — распознаём здесь же.
  const ocrLine = image ? await screenshotFact(image.data, orders[0]?.amount, orders[0]?.robloxUsername) : null;
  const context = ocrLine ? `${baseContext}\n${ocrLine}` : baseContext;
  const turns = memory.get(key(vkUserId));
  const raw = await decideSupport({ channel: "vk_bot", context, turns, ...(image ? { image } : {}) });
  if (!raw || raw === "out_of_money") return "failed";
  const d = guardDecision(raw, text, "vk_bot", {
    greeted: turns.some((t) => t.role === "assistant"),
    refundViaWb: refundGoesToWb(orders, codeOrders),
    known: `${context}\n${turns.map((t) => t.text).join("\n")}`,
  });
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
    if (d.action === "ignore") return "ignored";
    const body = d.action === "reply"
      ? `🧪 <b>ВК: бот ответил бы сам</b> · ${CATEGORY_RU[d.category]}\n${head}\n\n🤖 ${escapeHtml(plain(d.reply))}`
      : `🧪 <b>ВК: бот передал бы вам</b> · ${CATEGORY_RU[d.category]}\n${head}\n\n🧾 ${escapeHtml(d.summary || "—")}` +
        (d.draft.trim() ? `\n\n🤖 <b>Ответ:</b>\n${escapeHtml(d.draft.trim())}` : "");
    await card(body);
    return "ignored";
  }

  if (d.action === "ignore") return "ignored";
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
    return "handled";
  }
  const problem = [
    text,
    "",
    `🤖 ${d.summary || CATEGORY_RU[d.category]}`,
    d.draft.trim() ? `🤖 Ответ воркера: ${d.draft.trim()}` : "",
  ].filter(Boolean).join("\n");
  await deps.escalate(problem);
  return "handled";
}
