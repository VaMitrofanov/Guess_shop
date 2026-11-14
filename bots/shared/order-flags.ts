/**
 * 🏷 Пометки заказа (11.11.2026) — «обрати внимание», а не «не выкупать».
 *
 * Зачем
 * ─────
 * Заморозка выключает заказ из всех очередей. Для заявки на возврат WB и для
 * «висит 3 недели» это лишнее: админ договаривается с покупателем в чате, а
 * заказ тем временем пропадает из «К выкупу» и морозится снова (79PT6B3).
 * Владелец: «вместо заморозки — пометка, только чтоб её было видно». Заморозка
 * остаётся за плохим отзывом и за «деньги ушли» (отмена, одобренный возврат).
 *
 * Как устроено
 * ────────────
 * `WbOrder.flags` — JSON-список пометок, `WbOrder.flaggedAt` — время самой
 * ранней непогашенной (null, если все погашены): по нему строится срез
 * «С пометками» одним индексом. «✓ Договорились» гасит пометку, но не
 * удаляет её — в истории видно, кто и когда решил.
 *
 * Ядро здесь, потому что пометки ставят боты (синк DBS, гейт), а веб берёт
 * из `bots/shared` (так же, как `order-hold.ts`).
 */

export type OrderFlagKind = "CLAIM" | "STALE" | "PARTIAL_REFUND" | "CANCEL_ASK"
  /** 12.11.2026: был плохой отзыв, покупатель (или WB) его удалил — гейт
   *  снял заморозку, а память о ★1 осталась пометкой. */
  | "REVIEW_DELETED"
  /** 15.11.2026: «под наблюдением» — ставит админ (`/watch`), события заказа
   *  идут в тему «Под наблюдением» беседы уведомлений (`bots/tg/watch-list.ts`). */
  | "WATCH";

export interface OrderFlag {
  kind: OrderFlagKind;
  /** Текст заявки, просьбы и т.п. — показывается в досье. */
  detail?: string | null;
  /** Когда случилось (ISO). */
  at: string;
  /** «✓ Договорились» (ISO) — пометка погашена, но видна в истории. */
  ackAt?: string | null;
  ackBy?: string | null;
}

/** Иконка, подпись и тон — одни и те же в TWA и на сайте. */
export const FLAG_META: Record<OrderFlagKind, { icon: string; label: string; tone: "orange" | "yellow" | "red" }> = {
  CLAIM: { icon: "↩", label: "Возврат открыт", tone: "orange" },
  STALE: { icon: "⏳", label: "Висит", tone: "yellow" },
  PARTIAL_REFUND: { icon: "💸", label: "Частичный возврат", tone: "orange" },
  CANCEL_ASK: { icon: "✋", label: "Просит отмену", tone: "orange" },
  REVIEW_DELETED: { icon: "🗑", label: "Был плохой отзыв, удалён", tone: "yellow" },
  WATCH: { icon: "👁", label: "Под наблюдением", tone: "red" },
};

const KINDS = new Set<string>(Object.keys(FLAG_META));
const DETAIL_MAX = 500;

/** Пометки заказа. Терпит мусор в JSON — показ важнее строгости. */
export function flagsOf(order: { flags?: unknown } | null | undefined): OrderFlag[] {
  const raw = order?.flags;
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is OrderFlag =>
    !!f && typeof f === "object" && KINDS.has(String((f as OrderFlag).kind)) && typeof (f as OrderFlag).at === "string");
}

/** Непогашенные — те, что требуют решения. */
export function openFlags(order: { flags?: unknown } | null | undefined): OrderFlag[] {
  return flagsOf(order).filter((f) => !f.ackAt);
}

/** Подпись чипа: «⏳ Висит 24 дн.» считает дни от создания заказа. */
export function flagLabel(flag: OrderFlag, order?: { createdAt?: Date | string | null }, now = Date.now()): string {
  const meta = FLAG_META[flag.kind];
  if (flag.kind === "STALE" && order?.createdAt) {
    const days = Math.floor((now - new Date(order.createdAt).getTime()) / 86_400_000);
    return `${meta.icon} ${meta.label} ${days} дн.`;
  }
  return `${meta.icon} ${meta.label}`;
}

/** Текст подтверждения перед выкупом заказа с непогашенными пометками. */
export function flagsConfirmText(order: { flags?: unknown; createdAt?: Date | string | null }): string | null {
  const open = openFlags(order);
  if (open.length === 0) return null;
  const lines = open.map((f) => `• ${flagLabel(f, order)}${f.detail ? `: «${f.detail}»` : ""}`);
  return `У заказа есть пометки:\n${lines.join("\n")}\n\nВыкупаем? Пометки погасятся как «договорились».`;
}

function flaggedAtOf(flags: OrderFlag[]): Date | null {
  const open = flags.filter((f) => !f.ackAt).map((f) => new Date(f.at).getTime()).filter(Number.isFinite);
  return open.length ? new Date(Math.min(...open)) : null;
}

/**
 * Повесить пометку на заказ по коду. Идемпотентна: та же пометка не
 * дублируется, погашенная остаётся погашенной (договорённость важнее
 * повторного сигнала), меняется только текст.
 */
export async function setFlag(
  db: any,
  input: { wbCode: string; kind: OrderFlagKind; detail?: string | null; at?: Date | null },
): Promise<{ ok: boolean; added: boolean; awaitingOrder?: boolean }> {
  const wbCode = String(input.wbCode ?? "").trim().toUpperCase();
  if (!wbCode) return { ok: false, added: false };
  const order = await db.wbOrder.findUnique({ where: { wbCode }, select: { id: true, flags: true } });
  if (!order) return { ok: true, added: false, awaitingOrder: true };

  const flags = flagsOf(order);
  const detail = input.detail ? String(input.detail).replace(/\s+/g, " ").trim().slice(0, DETAIL_MAX) : null;
  const existing = flags.find((f) => f.kind === input.kind);
  if (existing) {
    if (!detail || existing.detail === detail) return { ok: true, added: false };
    existing.detail = detail;
  } else {
    flags.push({ kind: input.kind, detail, at: (input.at ?? new Date()).toISOString() });
  }
  await db.wbOrder.update({
    where: { id: order.id },
    data: { flags, flaggedAt: flaggedAtOf(flags) },
  });
  return { ok: true, added: !existing };
}

/** «✓ Договорились» — погасить одну пометку или все (`kind` не указан). */
export async function ackFlags(
  db: any,
  input: { orderId: string; actor: string; kind?: OrderFlagKind | null },
): Promise<{ ok: boolean; acked: number; error?: string }> {
  const order = await db.wbOrder.findUnique({ where: { id: input.orderId }, select: { id: true, flags: true } });
  if (!order) return { ok: false, acked: 0, error: "Заказ не найден" };
  const flags = flagsOf(order);
  const now = new Date().toISOString();
  let acked = 0;
  for (const f of flags) {
    if (f.ackAt || (input.kind && f.kind !== input.kind)) continue;
    f.ackAt = now;
    f.ackBy = (input.actor || "админ").trim();
    acked++;
  }
  if (acked === 0) return { ok: true, acked: 0 };
  await db.wbOrder.update({ where: { id: order.id }, data: { flags, flaggedAt: flaggedAtOf(flags) } });
  return { ok: true, acked };
}

/**
 * Свип: заявки WB → пометка «Возврат открыт» на заказе.
 *
 * Заявка часто приходит раньше, чем бот создаёт заказ по коду, поэтому
 * мало поставить пометку в момент заявки — свип догоняет заказы, родившиеся
 * позже. Два захода в базу на прогон, писать — только недостающее.
 */
export async function syncClaimFlags(db: any, now = new Date()): Promise<number> {
  const claims = await db.wbMarketplaceOrder.findMany({
    where: {
      claimOpenedAt: { not: null, gte: new Date(now.getTime() - 90 * 86_400_000) },
      cancelledAt: null,
      wbCodeId: { not: null },
    },
    select: { claimOpenedAt: true, claimReason: true, wbCode: { select: { code: true } } },
    take: 500,
  });
  const byCode = new Map<string, { at: Date; reason: string | null }>();
  for (const c of claims) if (c.wbCode?.code) byCode.set(c.wbCode.code, { at: c.claimOpenedAt, reason: c.claimReason });
  if (byCode.size === 0) return 0;

  const orders = await db.wbOrder.findMany({
    where: { wbCode: { in: [...byCode.keys()] }, status: { notIn: ["COMPLETED", "REJECTED"] } },
    select: { wbCode: true, flags: true },
  });
  let added = 0;
  for (const o of orders) {
    if (flagsOf(o).some((f) => f.kind === "CLAIM")) continue;
    const c = byCode.get(o.wbCode)!;
    const res = await setFlag(db, { wbCode: o.wbCode, kind: "CLAIM", detail: c.reason, at: c.at }).catch(() => null);
    if (res?.added) added++;
  }
  return added;
}
