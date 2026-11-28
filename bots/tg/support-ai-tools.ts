/* ─────────────────────────────────────────────────────────────────────────────
   Инструменты воркера (28.11.2026). Владелец: «воркер должен сопровождать,
   готовить заказ к выкупу, проверять».

   До этого модель видела только то, что ей заранее собрали по профилю
   собеседника. Покупатель пишет код WN4CK2V в чат WB — а в данных пусто, и
   воркер звал человека «найдите заказ». Теперь модель сама:
   • find_order — заказ по коду WB / коду покупки CODE-… (код = владение, как на сайте);
   • find_by_gamepass — живой заказ, где уже стоит этот пасс (код не называем);
   • check_gamepass — пасс у Roblox прямо сейчас: цена, продажа, Managed/Regional;
   • search_passes_by_nick — пассы аккаунта Roblox с ценами (подсказать, какой прислать);
   • attach_gamepass — поставить пасс в заказ и отправить в выкуп. Те же
     защёлки, что у автопривязки PA/чата WB (`attachGamepassFromSupport`):
     Roblox подтверждает пасс, цена ±2, ник = владелец пасса, заморозку не
     трогаем, пасс не занят другим заказом; карточка выкупа уходит админам;
   • propose_nick_change — смена ника только через админа: карточка с кнопкой.
   Денег и статусов, кроме «пасс принят → в выкуп», инструменты не меняют.
   ───────────────────────────────────────────────────────────────────────── */

import type Anthropic from "@anthropic-ai/sdk";
import { db } from "../shared/db";
import { loadSupportCustomer } from "../shared/support-ai-context";
import { gamepassDiagnosis, gamepassIdOf } from "../shared/support-ai-facts";
import { passPriceFor } from "../shared/wb-question-templates";
import type { SupportChannel } from "../shared/pa-ai-support";

export const SUPPORT_TOOLS: Anthropic.Tool[] = [
  {
    name: "find_order",
    description: "Найти заказ по коду, который прислал покупатель: 7 символов кода WB (например WN4CK2V) или CODE-XXXXXXXX покупки кода на сайте. Вызывай, когда покупатель называет код, а в данных покупателя этого заказа нет. Возвращает статус, пасс, ник, проблемы — как в данных покупателя.",
    input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
  },
  {
    name: "find_by_gamepass",
    description: "Найти живой заказ, в котором уже стоит этот геймпасс (ссылка или Pass ID). Код заказа покупателю не называй.",
    input_schema: { type: "object", properties: { gamepass: { type: "string" } }, required: ["gamepass"] },
  },
  {
    name: "check_gamepass",
    description: "Проверить геймпасс у Roblox прямо сейчас: существует ли, цена, в продаже ли, Managed/Regional pricing. amount — номинал заказа в R$ (500, 1000…), чтобы сверить цену; если неизвестен — не передавай.",
    input_schema: { type: "object", properties: { gamepass: { type: "string" }, amount: { type: "integer" } }, required: ["gamepass"] },
  },
  {
    name: "search_passes_by_nick",
    description: "Найти геймпассы аккаунта Roblox по нику с ценами — чтобы подсказать покупателю, какой пасс прислать или что поправить. amount — номинал заказа.",
    input_schema: { type: "object", properties: { nick: { type: "string" }, amount: { type: "integer" } }, required: ["nick", "amount"] },
  },
  {
    name: "attach_gamepass",
    description: "Поставить геймпасс в заказ, который ждёт пасс, и отправить заказ в выкуп. Вызывай, когда покупатель прислал пасс (ссылку/ID) и заказ известен (из данных или find_order). Система сама проверит пасс у Roblox, цену и ник; результат скажет, принят ли пасс и что сказать покупателю.",
    input_schema: { type: "object", properties: { code: { type: "string" }, gamepass: { type: "string" } }, required: ["code", "gamepass"] },
  },
  {
    name: "order_progress",
    description: "Где сейчас заказ и что его держит: этап, сколько ждёт, поднят ли вручную, прямой ли, проверка менеджера. Для ответа «когда придут робуксы»: место в очереди и сроки покупателю НЕ называй — говори этап и что делаем.",
    input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
  },
  {
    name: "guide_link",
    description: "Личная ссылка на инструкцию по заказу (с уже подставленным кодом). stage: passid — сразу шаг «прислать Pass ID», key — «Сделайте за меня» (ключ), sale — включить продажу. В чате WB саму ссылку не пиши — сошлись на сообщение со ссылкой выше; в TG/ВК — дай ссылку.",
    input_schema: { type: "object", properties: { code: { type: "string" }, stage: { type: "string", enum: ["passid", "key", "sale"] } }, required: ["code"] },
  },
  {
    name: "mark_nag",
    description: "Отметить, что покупатель ебёт мозги: пишет одно и то же, давит, грозит, пишет в нескольких каналах. Заказ поднимется в «Ебут мозги» у админов (если ему больше суток). reason — коротко, почему.",
    input_schema: { type: "object", properties: { code: { type: "string" }, reason: { type: "string" } }, required: ["code", "reason"] },
  },
  {
    name: "propose_nick_change",
    description: "Покупатель просит поменять ник Roblox в заказе. Сам ник не меняешь — создаёшь админу карточку с кнопкой. Покупателю скажи, что передал на смену.",
    input_schema: { type: "object", properties: { code: { type: "string" }, nick: { type: "string" }, why: { type: "string" } }, required: ["code", "nick"] },
  },
];

const CODE_RE = /^[A-Z0-9]{7}$/;
const normCode = (s: string) => String(s ?? "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");

async function orderByCode(code: string) {
  const c = normCode(code);
  if (!CODE_RE.test(c)) return null;
  return db.wbOrder.findFirst({
    where: { wbCode: { equals: c, mode: "insensitive" } },
    select: { id: true, wbCode: true, status: true, amount: true, robloxUsername: true },
  }).catch(() => null);
}

export interface ToolCtx { channel: SupportChannel; exam?: boolean }

/** Выполнить вызов инструмента; ответ — текст для модели. Ошибки — тоже текстом. */
export async function runSupportTool(name: string, input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  try {
    switch (name) {
      case "find_order": {
        const raw = normCode(String(input.code ?? ""));
        if (/^CODE-[A-Z0-9]{6,}$/.test(raw)) {
          const o = await db.codeOrder.findUnique({
            where: { publicId: raw },
            select: { denomination: true, status: true, createdAt: true, issuedAt: true, revealedAt: true, deliveryMode: true },
          }).catch(() => null);
          if (!o) return `Покупка ${raw} не найдена.`;
          return `Покупка кода Robux ${raw}: ${o.denomination} R$, статус ${o.status}${o.issuedAt ? ", код выдан" : o.status === "PAID" ? ", оплачено — код выдаёт менеджер вручную" : ""}${o.revealedAt ? ", покупатель код открыл" : ""}, доставка ${o.deliveryMode === "EMAIL" ? "на почту" : "в личный кабинет"}.`;
        }
        if (!CODE_RE.test(raw)) return "Это не похоже на код WB (7 латинских букв/цифр). Попроси код с карточки или из раздела «Покупки» WB.";
        const found = await orderByCode(raw);
        if (!found) {
          const card = await db.wbCode.findFirst({ where: { code: { equals: raw, mode: "insensitive" } }, select: { isUsed: true, status: true } }).catch(() => null);
          return card
            ? `Код ${raw} есть в базе, но ещё не активирован — заказа нет. Покупателю нужно активировать код по личной ссылке инструкции (robloxbank.ru/wb/, ввести код), затем прислать геймпасс.`
            : `Код ${raw} не найден ни среди заказов, ни среди карт. Возможно, опечатка (0/O, 1/I) — попроси перепроверить или прислать фото кода.`;
        }
        const c = await loadSupportCustomer(db, { wbCodes: [found.wbCode], name: null });
        return c.context;
      }
      case "find_by_gamepass": {
        const id = gamepassIdOf(String(input.gamepass ?? ""));
        if (!id) return "В тексте нет номера пасса.";
        const rows = await db.wbOrder.findMany({
          where: { gamepassId: id }, orderBy: { createdAt: "desc" }, take: 3,
          select: { status: true, amount: true, createdAt: true, completedAt: true },
        }).catch(() => []);
        if (!rows.length) return `Пасс ${id} ни в одном заказе не стоит.`;
        return rows.map((r: { status: string; amount: number; createdAt: Date; completedAt: Date | null }) =>
          `заказ на ${r.amount} R$ от ${r.createdAt.toISOString().slice(0, 10)}, статус ${r.status}${r.completedAt ? `, выкуплен ${r.completedAt.toISOString().slice(0, 10)}` : ""}`).join("\n") + "\n(код заказа покупателю не называть)";
      }
      case "check_gamepass": {
        const amount = Number(input.amount) || null;
        const line = await gamepassDiagnosis(String(input.gamepass ?? ""), amount && amount <= 1500 ? passPriceFor(amount) : null);
        return line ?? "Roblox сейчас не ответил — проверить пасс не удалось, попробуй позже или позови человека.";
      }
      case "search_passes_by_nick": {
        const { searchGamepassesByNick } = await import("../shared/gamepass-search");
        const amount = Number(input.amount) || 500;
        const r = await searchGamepassesByNick(String(input.nick ?? "").trim(), passPriceFor(amount));
        if (r.status === "user_not_found") return `Аккаунт Roblox «${r.nick}» не найден — проверь ник (точно как в профиле).`;
        if (r.status === "no_gamepasses") return `У «${r.nick}» нет геймпассов в продаже${r.games?.visibility === "hidden" ? " (игры скрыты)" : ""}. Нужно создать пасс за ${r.expectedPrice} R$.`;
        const list = r.all.slice(0, 8).map((g) => `${g.name ?? "пасс"} — ${g.robux} R$ (ID ${g.gamepassId})${g.isPriceMatch ? " ✓ подходит" : ""}`).join("\n");
        return `Пассы «${r.nick}» (нужен за ${r.expectedPrice} R$):\n${list}`;
      }
      case "attach_gamepass": {
        if (ctx.exam) return "(экзамен: привязка не выполняется) Пасс был бы проверен и поставлен.";
        if (ctx.channel === "wb_review") return "В ответе на отзыв привязка недоступна.";
        const id = gamepassIdOf(String(input.gamepass ?? ""));
        if (!id) return "В тексте нет номера пасса.";
        const order = await orderByCode(String(input.code ?? ""));
        if (!order) return "Заказ по этому коду не найден — сначала find_order.";
        if (order.status !== "AWAITING_GAMEPASS") return `Заказ уже не ждёт пасс (статус ${order.status}) — ничего не меняю.`;
        const { attachGamepassFromSupport } = await import("../shared/wb-chat-gamepass");
        const r = await attachGamepassFromSupport(db as never, { orderIds: [order.id], gamepassId: id });
        console.log(`[support-ai:${ctx.channel}] attach_gamepass ${order.wbCode} ← ${id}: ${r.kind}`);
        switch (r.kind) {
          case "attached": return `✅ Пасс ${id} принят (${r.price} R$, владелец ${r.nick}). Заказ ушёл в очередь на выкуп, админам отправлена карточка. Скажи покупателю, что пасс принят и заказ в очереди (сроки не называй).`;
          case "partial": return `Пасс принят частью набора (${r.price} R$). Осталось прислать пассы на: ${r.need.join(", ")} R$ (ещё ${r.remaining} R$).`;
          case "rejected": return r.toBuyer
            ? `❌ Пасс не подходит: ${r.reason}. ${r.buyerText ?? `Нужен пасс за ${r.expectedPrice} R$, в продаже, без Managed/Regional pricing.`}`
            : `❌ Пасс не поставлен: ${r.reason}. Это решает человек — эскалируй.`;
          default: return r.why === "roblox_down" ? "Roblox не ответил — попробуй позже." : r.why === "not_a_pass" ? "Roblox не знает такого пасса — проверь ссылку/ID." : r.why === "no_orders" ? "Заказ заморожен или уже не ждёт пасс — ничего не меняю, эскалируй." : "Не удалось однозначно — эскалируй.";
        }
      }
      case "order_progress": {
        const c = normCode(String(input.code ?? ""));
        if (!CODE_RE.test(c)) return "Нужен код заказа из 7 символов.";
        const o = await db.wbOrder.findFirst({
          where: { wbCode: { equals: c, mode: "insensitive" } },
          select: { status: true, amount: true, createdAt: true, pendingAt: true, priorityAt: true, isDirectOrder: true, heldAt: true, completedAt: true, gamepassId: true, robloxUsername: true },
        }).catch(() => null);
        if (!o) return "Заказ не найден — find_order.";
        const h = (d: Date | null) => (d ? `${Math.round((Date.now() - d.getTime()) / 3_600_000)} ч` : "—");
        const stage = o.status === "AWAITING_GAMEPASS" ? "ждём геймпасс от покупателя — без него выкупа не будет"
          : o.status === "PENDING" ? `пасс принят, в очереди на выкуп ${h(o.pendingAt)}`
          : o.status === "COMPLETED" ? `выкуплен ${o.completedAt?.toISOString().slice(0, 16).replace("T", " ")} — робуксы в Pending у Roblox`
          : o.status === "ERROR" ? "выкуп не прошёл — нужна правка пасса (смотри данные покупателя)" : o.status;
        return [
          `Заказ ${c}: ${o.amount} R$, ${stage}.`,
          o.heldAt ? "Стоит на проверке у менеджера (причину покупателю не называть — «проверка, менеджер посмотрит»)." : "",
          o.priorityAt ? "Поднят вручную — первым в очереди." : o.isDirectOrder ? "Прямой заказ — в приоритете." : "",
          o.status === "PENDING" ? "Покупателю: заказ в очереди, выкупаем по порядку, напишем сразу после выкупа. Сроки и место в очереди не называй." : "",
        ].filter(Boolean).join("\n");
      }
      case "guide_link": {
        const c = normCode(String(input.code ?? ""));
        const o = await db.wbOrder.findFirst({
          where: { wbCode: { equals: c, mode: "insensitive" } },
          select: { wbCode: true, amount: true, isDirectOrder: true, robloxUsername: true, probableNick: true },
        }).catch(() => null);
        if (!o) return "Заказ не найден.";
        const { buyerGuideUrl } = await import("../shared/buyer-step");
        const stage = ["passid", "key", "sale"].includes(String(input.stage)) ? (input.stage as "passid" | "key" | "sale") : undefined;
        const url = buyerGuideUrl(o, stage);
        return ctx.channel === "wb_chat"
          ? "В чате WB ссылку не пиши — попроси открыть ссылку из сообщения «Спасибо, код доставки получен» выше в этом чате."
          : `Личная инструкция: ${url}`;
      }
      case "mark_nag": {
        if (ctx.exam) return "(экзамен) Отметка была бы поставлена.";
        const c = normCode(String(input.code ?? ""));
        const o = await db.wbOrder.findFirst({ where: { wbCode: { equals: c, mode: "insensitive" } }, select: { id: true, adminNote: true } }).catch(() => null);
        if (!o) return "Заказ не найден.";
        const reason = String(input.reason ?? "").replace(/\s+/g, " ").slice(0, 200);
        const line = `🤬 воркер ${new Date().toISOString().slice(0, 16).replace("T", " ")}: ${reason}`;
        const note = o.adminNote?.trim() ? `${o.adminNote.trim()}\n${line}` : line;
        await db.wbOrder.update({ where: { id: o.id }, data: { adminNote: note.slice(-2000) } }).catch(() => undefined);
        // Тон в журнал — по нему «Первым делом» собирает «Ебут мозги».
        await db.aiSupportLog.create({
          data: { channel: ctx.channel, action: "ignore", mode: "on", category: "complaint", peerKey: `nag:${c}`, orderCode: c, question: `[mark_nag] ${reason}`, tone: "nags" },
        }).catch(() => undefined);
        return "Отметил. Покупателю об этом не пиши.";
      }
      case "propose_nick_change": {
        if (ctx.exam) return "(экзамен) Карточка смены ника была бы создана.";
        const order = await orderByCode(String(input.code ?? ""));
        if (!order) return "Заказ по коду не найден.";
        if (!["AWAITING_GAMEPASS", "PENDING", "ERROR"].includes(order.status)) return `Заказ в статусе ${order.status} — ник уже не меняют, эскалируй.`;
        const nick = String(input.nick ?? "").trim().replace(/^@/, "");
        if (!/^[A-Za-z0-9_]{3,20}$/.test(nick)) return "Ник Roblox — 3–20 латинских букв, цифр или _. Уточни у покупателя.";
        const { proposeNickChange } = await import("./support-ai-nick");
        await proposeNickChange({ orderId: order.id, wbCode: order.wbCode, from: order.robloxUsername, to: nick, why: String(input.why ?? ""), channel: ctx.channel });
        return "Карточка смены ника отправлена админу. Скажи покупателю, что передал на смену и напишем, когда поменяем.";
      }
      default:
        return `Нет такого инструмента: ${name}`;
    }
  } catch (e) {
    return `Инструмент ${name} упал: ${e instanceof Error ? e.message.slice(0, 160) : "ошибка"}. Не выдумывай результат — эскалируй.`;
  }
}
