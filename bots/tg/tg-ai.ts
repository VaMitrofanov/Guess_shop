/* ─────────────────────────────────────────────────────────────────────────────
   ИИ-поддержка в самом боте @RobloxBankBot (13.11.2026).

   Тот же подход, что во ВК (`bots/vk/vk-ai.ts`): модель получает только
   «разговорный» текст и только там, где автомат бота сам ответить не смог —
   вместо напоминания «открой инструкцию», «не удалось распознать» и «нет
   активных заявок». Ввод ника, ссылки, Pass ID, кода, ключа, суммы, почты
   сюда не доходит: его разбирают ветки бота раньше.

   Вызывающий передаёт шаг (`step`) — где человек в боте; модель видит его
   строкой «ГДЕ ЧЕЛОВЕК В БОТЕ».

   • off — старая логика;
   • dry — покупатель видит старую логику, админам карточка «бот ответил бы»;
   • on  — reply: отвечает сам; escalate: обычное обращение в поддержку с сутью
           и черновиком; ignore: молчит.
   Любой сбой — `false`, и сообщение идёт старым путём.
   ───────────────────────────────────────────────────────────────────────── */

import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { escapeHtml, tgSend } from "../shared/notify";
import { CATEGORY_RU, guardDecision, plain, refundGoesToWb } from "../shared/pa-ai-support";
import { AI_DEBOUNCE_MS, Debouncer, type SupportImage, decideSupport, isConversationalText, supportCardTarget, supportChannelMode, trailingUserText, TurnMemory } from "../shared/support-ai";
import { loadSupportCustomer } from "../shared/support-ai-context";
import { SUPPORT_METRIC_EVENT, recordSupportMetric } from "../shared/support-metric";
import { aiLogCard, aiLogRecord, recallTurns } from "../shared/support-ai-log";
import { screenshotFact } from "../shared/support-ai-facts";

const memory = new TurnMemory();
const debouncer = new Debouncer();

async function card(html: string): Promise<void> {
  const target = await supportCardTarget(db);
  const thread = target.chatId ? target.topics.test : undefined;
  const ids = target.chatId ? [target.chatId] : ADMIN_IDS;
  await Promise.allSettled(ids.map((id) => tgSend(id, html.slice(0, 4000), {
    parse_mode: "HTML",
    ...(thread ? { message_thread_id: thread } : {}),
  })));
}

export interface TgAiDeps {
  tgId: number;
  name: string;
  username?: string | null;
  /** Где человек в боте — одной фразой, для модели. */
  step: string;
  reply: (text: string) => Promise<unknown>;
  /** Обычное обращение в поддержку с готовым описанием. */
  escalate: (problemText: string) => Promise<void>;
}

/** `true` — сообщение обработано ИИ; `false` — пусть работает старая логика. */
export async function tryTgAi(text: string, deps: TgAiDeps, image?: SupportImage): Promise<boolean> {
  if (!isConversationalText(text)) return false;
  const mode = await supportChannelMode(db, "tg_bot");
  if (mode === "off") return false;

  const key = String(deps.tgId);
  if (!memory.has(key)) memory.seed(key, await recallTurns(db, "tg_bot", `tg:${key}`));
  memory.push(key, "user", text);
  if (mode === "on") {
    // ⏳ Склейка сообщений (27.11.2026): ответ — через AI_DEBOUNCE_MS после последнего.
    debouncer.schedule(key, AI_DEBOUNCE_MS, async () => {
      const joined = trailingUserText(memory.get(key)) || text;
      const r = await answerTgAi(joined, deps, mode, image);
      if (r === "failed") await deps.escalate(joined);
    });
    return true;
  }
  return (await answerTgAi(text, deps, mode, image)) === "handled";
}

async function answerTgAi(text: string, deps: TgAiDeps, mode: "on" | "dry", image?: SupportImage): Promise<"handled" | "ignored" | "failed"> {
  const key = String(deps.tgId);
  const user = await db.user.findUnique({ where: { tgId: key }, select: { id: true, name: true } }).catch(() => null);
  const name = user?.name ?? deps.name;
  const customer = await loadSupportCustomer(db, { userId: user?.id, name });
  // 📷 Скриншот с вопросом (27.11.2026): картинку видит модель, Pending — распознаём.
  const ocrLine = image ? await screenshotFact(image.data, customer.orders[0]?.amount, customer.orders[0]?.robloxUsername) : null;
  const context = `${customer.context}${ocrLine ? `\n${ocrLine}` : ""}\n\nГДЕ ЧЕЛОВЕК В БОТЕ: ${deps.step}`;
  const turns = memory.get(key);
  const raw = await decideSupport({ channel: "tg_bot", context, turns, ...(image ? { image } : {}) });
  if (!raw || raw === "out_of_money") return "failed";
  const d = guardDecision(raw, text, "tg_bot", {
    greeted: turns.some((t) => t.role === "assistant"),
    refundViaWb: refundGoesToWb(customer.orders, customer.codeOrders),
    known: `${context}\n${turns.map((t) => t.text).join("\n")}`,
  });
  void aiLogRecord(db, {
    channel: "tg_bot", action: d.action, mode: mode as "on" | "dry", category: d.category,
    peerKey: `tg:${key}`, orderCode: customer.orders[0]?.wbCode ?? null,
    question: text, answer: d.action === "reply" ? plain(d.reply) : d.draft || null, summary: d.summary || null, tone: raw.tone ?? null,
  });

  const order = customer.orders[0];
  const who = deps.username ? `@${escapeHtml(deps.username)}` : `<a href="tg://user?id=${key}">${escapeHtml(name)}</a>`;
  const head = [
    `👤 ${who} · бот TG`,
    order ? `📦 ${order.wbCode} · ${order.amount} R$ · ${order.status}${order.heldAt ? " · ❄️" : ""}` : "📦 заказов в базе нет",
    `🧭 ${escapeHtml(deps.step)}`,
    "",
    `💬 «${escapeHtml(text.slice(0, 600))}»`,
  ].join("\n");

  if (mode === "dry") {
    if (d.action === "ignore") return "ignored";
    const body = d.action === "reply"
      ? `🧪 <b>Бот TG: ответил бы сам</b> · ${CATEGORY_RU[d.category]}\n${head}\n\n🤖 ${escapeHtml(plain(d.reply))}`
      : `🧪 <b>Бот TG: передал бы вам</b> · ${CATEGORY_RU[d.category]}\n${head}\n\n🧾 ${escapeHtml(d.summary || "—")}` +
        (d.draft.trim() ? `\n\n🤖 <b>Ответ:</b>\n${escapeHtml(d.draft.trim())}` : "");
    await card(body);
    return "ignored";
  }

  if (d.action === "ignore") return "ignored";
  if (d.action === "reply") {
    const answer = plain(d.reply);
    await deps.reply(answer);
    memory.push(key, "assistant", answer);
    // Журнал: каждый ответ ИИ виден админам, без звука (26.11.2026).
    void aiLogCard(db, `🤖 <b>Бот TG: ответил сам</b> · ${CATEGORY_RU[d.category]}\n${head}\n\n🤖 ${escapeHtml(answer)}`, { silent: true });
    void recordSupportMetric(db as never, {
      type: SUPPORT_METRIC_EVENT.SELF_SERVED, wbCode: order?.wbCode, via: "tg-bot",
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
