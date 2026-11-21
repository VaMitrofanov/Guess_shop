/* ─────────────────────────────────────────────────────────────────────────────
   Живой закреп заказа у покупателя (11.11.2026).

   С 01.11 после активации кода бот закреплял «📌 Код вашего заказа» — и всё:
   дальше человек узнавал, что с заказом, только из новых сообщений или
   спрашивая поддержку («когда робуксы?» — самая частая тема обращений). Теперь
   закреп показывает стадию и обновляется сам:

     ⏳ ждём геймпасс → 🛒 в очереди выкупа → ✅ выкуплен, робуксы в Pending у Roblox

   • TG — правим закреплённое сообщение на месте, без новых сообщений.
   • VK — тоже правим на месте; если ВК не даёт (старое сообщение), присылаем
     новую карточку и закрепляем её (закреп в диалоге один — старый уходит сам).

   На «выкуплен» нет даты окончания Pending: срок задаёт Roblox, и обещать
   число нельзя (решение владельца 26.10). Акцент — с нашей стороны всё готово.

   Где какой закреп — событие заказа `ORDER_PIN` (без миграции): платформа,
   чат, сообщение и стадия, на которой карточку обновили последний раз.
   ───────────────────────────────────────────────────────────────────────── */

import type { PrismaClient } from "@prisma/client";
import { copyButton } from "./tg-flair";

export type OrderPinStage = "wait" | "queue" | "done";
export type PinPlatform = "TG" | "VK";

export const ORDER_PIN_EVENT = "ORDER_PIN";

/** Стадия по статусу. `null` — закреп не трогаем (отмена, оплата и т. п.). */
export function orderPinStage(status: string): OrderPinStage | null {
  if (status === "AWAITING_GAMEPASS") return "wait";
  if (status === "PENDING" || status === "IN_PROGRESS" || status === "ERROR") return "queue";
  if (status === "COMPLETED") return "done";
  return null;
}

const DAY_FMT = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" });

/** Текст закрепа. `html` — для TG (код моноширинный), `plain` — для VK. */
/* 15.11.2026 (владелец: «закреп-шкала»): шаги со статусом ✅/⏳/○ и цена пасса —
   человек видит, сколько осталось, а в TG под закрепом — кнопка текущего шага. */
/* З4 (18.11.2026): полоса и этап одним словом — в ПЕРВОЙ строке: её видно в
   плашке закрепа сверху чата, не открывая сообщение. Места в очереди нет
   (владелец: «доебутся, у нас иногда задержки по выдачам»). */
const PIN_BAR: Record<OrderPinStage, string> = { wait: "▰▱▱▱", queue: "▰▰▱▱", done: "▰▰▰▱" };
const PIN_WORD: Record<OrderPinStage, string> = { wait: "ждём геймпасс", queue: "выкупаем", done: "выкуплен" };

export function orderPinText(opts: {
  code: string;
  amount: number;
  stage: OrderPinStage;
  completedAt?: Date | null;
  /** Ник Roblox — рядом с «Геймпасс принят». */
  nick?: string | null;
  format: "html" | "plain";
}): string {
  const html = opts.format === "html";
  const code = html ? `<code>${opts.code}</code>` : opts.code;
  const b = (s: string) => (html ? `<b>${s}</b>` : s);
  const head = `📌 Заказ ${code} · ${opts.amount.toLocaleString("ru-RU")} R$ · ${PIN_BAR[opts.stage]} ${b(PIN_WORD[opts.stage])}`;
  const nick = opts.nick ? ` · ${html ? `<code>${opts.nick.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>` : opts.nick}` : "";
  const price = opts.amount <= 1500 ? ` — цена ${Math.ceil(opts.amount / 0.7)} R$` : " — по инструкции";
  const day = opts.completedAt ? ` ${DAY_FMT.format(opts.completedAt).replace(".", "")}` : "";
  const steps = opts.stage === "wait"
    ? ["✅ Код активирован", `⏳ ${b(`Геймпасс${price}`)}`, "○ Выкуп", "○ Robux на балансе"]
    : opts.stage === "queue"
      ? ["✅ Код активирован", `✅ Геймпасс принят${nick}`, `⏳ ${b("Выкуп — заказ в очереди")}`, "○ Robux в Pending у Roblox"]
      : ["✅ Код активирован", `✅ Геймпасс принят${nick}`, `✅ Выкуплен${day}`, `⏳ ${b("Robux в Pending у Roblox")} — зачислит сам`];
  const foot = opts.stage === "wait"
    ? "Напишете в поддержку — назовите этот код, так мы сразу найдём заказ."
    : opts.stage === "queue"
      ? "Как выкупим — карточка обновится сама и придёт уведомление."
      : "С нашей стороны всё готово, дальше их зачисляет Roblox.";
  return [head, "", ...steps, "", foot].join("\n");
}

/** Кнопки под закрепом в TG — по текущему шагу (callback_data — как у бота). */
export function orderPinMarkupTg(stage: OrderPinStage, code: string): { inline_keyboard: Array<Array<Record<string, string>>> } {
  if (stage === "wait") {
    return { inline_keyboard: [
      [{ text: "🔗 Прислать ссылку на геймпасс", callback_data: "send_gp_link" }],
      [{ text: "📖 Моя инструкция", url: `https://robloxbank.ru/guide?source=wb&skip=1&code=${encodeURIComponent(code)}` }],
    ] };
  }
  if (stage === "queue") return { inline_keyboard: [[copyButton("📋 Код заказа", code) as never, { text: "📊 Мой заказ", callback_data: "refresh_status" }]] };
  return { inline_keyboard: [
    [{ text: "🔍 Проверить Robux — Transactions", url: "https://www.roblox.com/transactions" }],
    [{ text: "💬 Робуксов нет", callback_data: "rbx_chk" }],
  ] };
}

export interface PinRecord {
  platform: PinPlatform;
  /** TG chat id / VK peer id. */
  chatId: string;
  /** TG message_id. */
  messageId?: number;
  /** VK conversation_message_id. */
  cmid?: number;
  stage: OrderPinStage;
}

type PinDb = Pick<PrismaClient, "wbOrder" | "orderEvent" | "$queryRawUnsafe">;

/** Запомнить закреп заказа по коду. Нет заказа — молча пропускаем. */
export async function recordOrderPin(db: PinDb, code: string, pin: PinRecord): Promise<void> {
  try {
    const order = await db.wbOrder.findFirst({ where: { wbCode: code }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (!order) return;
    await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: ORDER_PIN_EVENT,
        idempotencyKey: `${ORDER_PIN_EVENT}:${order.id}:${pin.platform}:${pin.stage}:${Date.now()}`,
        payload: { ...pin },
      },
    });
  } catch (err) {
    console.warn("[order-pin] запись закрепа:", (err as Error)?.message ?? err);
  }
}

export interface PinToUpdate extends PinRecord {
  orderId: string;
  code: string;
  amount: number;
  completedAt: Date | null;
  nick?: string | null;
  next: OrderPinStage;
}

/** Закрепы платформы, у которых стадия заказа ушла вперёд. Один заход в базу. */
export async function loadPinsToUpdate(db: PinDb, platform: PinPlatform): Promise<PinToUpdate[]> {
  const rows = (await db.$queryRawUnsafe(`
    select distinct on (e."orderId") e."orderId" as "orderId", e.payload as payload,
           w.status::text as status, w."wbCode" as code, w.amount as amount, w."completedAt" as "completedAt", w."robloxUsername" as nick
      from "OrderEvent" e
      join "WbOrder" w on w.id = e."orderId"
     where e.type = '${ORDER_PIN_EVENT}' and e.payload->>'platform' = $1
       and w."isTest" = false and w."updatedAt" > now() - interval '30 days'
     order by e."orderId", e."createdAt" desc`, platform)) as Array<{
      orderId: string; payload: PinRecord; status: string; code: string; amount: number; completedAt: Date | null; nick: string | null;
    }>;
  const out: PinToUpdate[] = [];
  for (const r of rows) {
    const next = orderPinStage(r.status);
    if (!next || next === r.payload.stage) continue;
    // Назад стадия не откатывается: «выкуплен» не превращается обратно в «очередь».
    const rank = { wait: 0, queue: 1, done: 2 } as const;
    if (rank[next] < rank[r.payload.stage]) continue;
    out.push({ ...r.payload, orderId: r.orderId, code: r.code, amount: Number(r.amount), completedAt: r.completedAt ? new Date(r.completedAt) : null, nick: r.nick ?? null, next });
  }
  return out;
}

/**
 * Обновить закрепы платформы. `apply` правит или пересоздаёт карточку и
 * возвращает новое расположение (или `null`, если не вышло — попробуем позже).
 */
export async function syncOrderPins(
  db: PinDb,
  platform: PinPlatform,
  apply: (pin: PinToUpdate, text: string) => Promise<{ messageId?: number; cmid?: number } | null>,
): Promise<number> {
  const pins = await loadPinsToUpdate(db, platform);
  let updated = 0;
  for (const pin of pins) {
    const text = orderPinText({
      code: pin.code, amount: pin.amount, stage: pin.next, completedAt: pin.completedAt, nick: pin.nick,
      format: platform === "TG" ? "html" : "plain",
    });
    const placed = await apply(pin, text).catch((err) => {
      console.warn(`[order-pin] ${platform} ${pin.code}:`, (err as Error)?.message ?? err);
      return null;
    });
    if (!placed) continue;
    await db.orderEvent.create({
      data: {
        orderId: pin.orderId,
        type: ORDER_PIN_EVENT,
        idempotencyKey: `${ORDER_PIN_EVENT}:${pin.orderId}:${platform}:${pin.next}:${Date.now()}`,
        payload: {
          platform, chatId: pin.chatId, stage: pin.next,
          messageId: placed.messageId ?? pin.messageId, cmid: placed.cmid ?? pin.cmid,
        },
      },
    }).catch(() => undefined);
    updated++;
  }
  return updated;
}
