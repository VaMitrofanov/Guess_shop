/* ─────────────────────────────────────────────────────────────────────────────
   Проход по свежим обращениям покупателей (01.11.2026), раз в 3 минуты.

   • 🛑 «просят отмену» → заморозка заказа (`holdForProblem`, автозащита) +
     событие BUYER_CANCEL в «Рисках» + пуш админам. 31.10 покупатель E5G3VPR
     написал в чат WB «отказ… возвращайте деньги», а заказ стоял в очереди
     на выкуп — выкупи его кто-нибудь, робуксы ушли бы безвозвратно.
   • 💬 «нужен человек» → событие BUYER_HELP в «Рисках», без пуша: обращения
     из ботов менеджеры и так получают, а чат WB читают в консоли.

   «Торопят» здесь не обрабатываются: их считает сам блок «Первым делом» при
   загрузке, им не нужно ничего менять в базе.

   Идемпотентность — по `RiskEvent.dedupeKey` (id исходного сообщения): если
   админ разморозил заказ, повторный проход по тому же сообщению его не
   заморозит снова. Морозит только НОВОЕ сообщение с просьбой.
   ───────────────────────────────────────────────────────────────────────── */

import { contactQuote, loadBuyerContacts, type BuyerContactRow } from "./buyer-contact";
import { formatAdminNotice, orderRef } from "./notify-format";
import { holdForProblem } from "./order-hold";
import { buyerKeyOf, RISK_AUTO_ACTOR } from "./risk-events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const STREAM = "buyer-contacts";
/** Первый запуск смотрит на трое суток назад — чтобы поймать уже висящие просьбы. */
const FIRST_RUN_LOOKBACK_MS = 72 * 3_600_000;
/** Нахлёст окна: сообщения пишутся с задержкой синка чата WB. */
const OVERLAP_MS = 15 * 60_000;

/** Заказы, которые ещё можно не выкупить. */
export const BUYER_SWEEP_ORDER_SQL = `"status" IN ('AWAITING_GAMEPASS','PENDING','IN_PROGRESS','ERROR')`;

const CHANNEL_RU: Record<string, string> = { TG: "Telegram", VK: "VK", WB: "чат WB" };

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buyerCancelNotice(c: BuyerContactRow): string {
  return formatAdminNotice({
    marker: "urgent",
    zone: "ВЫКУП",
    title: "покупатель просит отмену — заказ заморожен",
    lines: [
      orderRef({ wbOrderId: c.wbOrderId, code: c.wbCode, denomination: c.amount, buyerName: c.buyerName }),
      `${CHANNEL_RU[c.channel] ?? c.channel}: «${escapeHtml(contactQuote(c.text, 300) ?? "")}»`,
    ],
    next: "решить в TWA → «Заморожены» → «Возврат»: отменить заказ или разморозить, если просьба не про отмену.",
  });
}

async function createOnce(db: Db, data: Record<string, unknown>): Promise<boolean> {
  try {
    await db.riskEvent.create({ data });
    return true;
  } catch {
    return false; // P2002 — уже записано раньше
  }
}

export async function runBuyerContactSweep(
  db: Db,
  send: (html: string) => Promise<void>,
  now = new Date(),
): Promise<{ cancel: number; help: number }> {
  const cursor = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } }).catch(() => null);
  const since = cursor?.lastSuccessAt
    ? new Date(new Date(cursor.lastSuccessAt).getTime() - OVERLAP_MS)
    : new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);

  const contacts = await loadBuyerContacts(db, { since, orderWhereSql: BUYER_SWEEP_ORDER_SQL });
  let cancel = 0;
  let help = 0;
  // Три сообщения «верните деньги» подряд — один пуш, а не три.
  const notified = new Set<string>();

  for (const c of contacts.sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (c.kind !== "cancel" && c.kind !== "human") continue;
    const base = {
      wbCode: c.wbCode,
      wbOrderId: c.wbOrderId,
      buyerName: c.buyerName,
      buyerKey: buyerKeyOf(c.buyerName),
      amount: c.amount,
      text: contactQuote(c.text, 1000),
      occurredAt: c.at,
    };
    if (c.kind === "cancel") {
      const fresh = await createOnce(db, {
        ...base, kind: "BUYER_CANCEL", dedupeKey: `buyer-cancel:${c.sourceId}`, action: "frozen",
      });
      if (!fresh) continue;
      const res = await holdForProblem(db, {
        wbCode: c.wbCode, kind: "BUYER_REFUND_REQUEST", detail: contactQuote(c.text, 160),
      }).catch(() => null);
      if (res?.alreadyCompleted) {
        await db.riskEvent.updateMany({
          where: { dedupeKey: `buyer-cancel:${c.sourceId}` },
          data: { action: "none", resolvedAt: now, resolvedBy: `${RISK_AUTO_ACTOR}: уже выкуплен` },
        }).catch(() => {});
        continue;
      }
      if (notified.has(c.wbCode)) continue;
      notified.add(c.wbCode);
      cancel += 1;
      await send(buyerCancelNotice(c)).catch(() => {});
    } else {
      if (await createOnce(db, { ...base, kind: "BUYER_HELP", dedupeKey: `buyer-help:${c.sourceId}`, action: "none" })) {
        help += 1;
      }
    }
  }

  // Вопросы по заказам, которые уже выкуплены или отменены, — разобраны сами.
  await db.$executeRawUnsafe(`
    UPDATE "RiskEvent" r SET "resolvedAt" = NOW(), "resolvedBy" = '${RISK_AUTO_ACTOR}: заказ закрыт'
      FROM "WbOrder" o
     WHERE r."resolvedAt" IS NULL AND r."kind" = 'BUYER_HELP'
       AND o."wbCode" = r."wbCode" AND o."status" IN ('COMPLETED','REJECTED')
  `).catch(() => {});

  await db.wbSyncCursor.upsert({
    where: { stream: STREAM },
    create: { stream: STREAM, lastAttemptAt: now, lastSuccessAt: now, metadata: { cancel, help } },
    update: { lastAttemptAt: now, lastSuccessAt: now, metadata: { cancel, help } },
  });
  return { cancel, help };
}
