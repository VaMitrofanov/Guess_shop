/* ─────────────────────────────────────────────────────────────────────────────
   Проход по свежим обращениям покупателей (01.11.2026), раз в 3 минуты.

   • «просят отмену» → только отметка BUYER_CANCEL (action "none"). До 03.11
     такое сообщение само морозило заказ и слало 🔴 пуш; владелец решил, что
     одних слов в чате для заморозки мало (покупатель часто пишет «верните
     деньги», просто не дождавшись). Отмену решают заявка на возврат WB и админ.
   • 💬 «нужен человек» → событие BUYER_HELP в «Рисках», без пуша: обращения
     из ботов менеджеры и так получают, а чат WB читают в консоли.

   «Торопят» здесь не обрабатываются: их считает сам блок «Первым делом» при
   загрузке, им не нужно ничего менять в базе.

   Идемпотентность — по `RiskEvent.dedupeKey` (id исходного сообщения): если
   сообщение уже записано, повторный проход его пропускает.
   ───────────────────────────────────────────────────────────────────────── */

import { contactQuote, loadBuyerContacts } from "./buyer-contact";
import { buyerKeyOf, RISK_AUTO_ACTOR } from "./risk-events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const STREAM = "buyer-contacts";
/** Первый запуск смотрит на трое суток назад — чтобы поймать уже висящие просьбы. */
const FIRST_RUN_LOOKBACK_MS = 72 * 3_600_000;
/** Нахлёст окна: сообщения пишутся с задержкой синка чата WB. */
const OVERLAP_MS = 15 * 60_000;

/** Заказы, которые ещё можно не выкупить. */
const BUYER_SWEEP_ORDER_SQL = `"status" IN ('AWAITING_GAMEPASS','PENDING','IN_PROGRESS','ERROR')`;

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
  now = new Date(),
): Promise<{ cancel: number; help: number }> {
  const cursor = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } }).catch(() => null);
  const since = cursor?.lastSuccessAt
    ? new Date(new Date(cursor.lastSuccessAt).getTime() - OVERLAP_MS)
    : new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);

  const contacts = await loadBuyerContacts(db, { since, orderWhereSql: BUYER_SWEEP_ORDER_SQL });
  let cancel = 0;
  let help = 0;

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
      // С 03.11 просьба об отмене в чате ничего не морозит и пуш не шлёт —
      // только отметка «сообщение обработано» (в «Рисках» её не видно).
      if (await createOnce(db, { ...base, kind: "BUYER_CANCEL", dedupeKey: `buyer-cancel:${c.sourceId}`, action: "none" })) {
        cancel += 1;
      }
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
