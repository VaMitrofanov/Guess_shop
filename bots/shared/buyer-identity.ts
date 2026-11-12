/* ─────────────────────────────────────────────────────────────────────────────
   Кто этот покупатель WB у нас (12.11.2026) — единая экосистема WB ↔ боты.

   Владелец: «как только нам написали в чат WB — я уже знаю, кто это (если он
   покупал до), и узнаю его сразу, как он попадёт в ВК или ТГ; по максимуму
   объединять инфу (отзыв на WB — и кто это у нас в TG/VK)».

   WB не даёт id покупателя, поэтому связываем по признакам, от точного к
   догадке:
   • exact  — этот заказ активирован по коду (человек вошёл через TG/VK);
              соседний заказ той же покупки WB (`orderUid`) активирован;
              в чате WB он назвал ник Roblox или Pass ID, которые уже есть в
              наших заказах;
   • likely — то же имя на WB, и в базе ровно один человек с таким именем;
   • namesake — с таким именем несколько разных людей: показываем, что тёзки,
              и не выдаём догадку за факт.
   ───────────────────────────────────────────────────────────────────────── */

// Клиент Prisma у ботов и у сайта разный по типам — модуль принимает утиный.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type IdentityLevel = "exact" | "likely" | "namesake";

export interface BuyerMatch {
  userId: string;
  name: string | null;
  tgUsername: string | null;
  tgId: string | null;
  vkId: string | null;
  orders: number;
  bought: number;
  lastCode: string | null;
  level: IdentityLevel;
  why: string;
}

export interface BuyerIdentity {
  matches: BuyerMatch[];
  /** Сколько разных наших покупателей носят это имя на WB (для тёзок). */
  namesakes: number;
  buyerName: string | null;
}

/** Слова, похожие на ник, которые ником не являются. */
const NOT_NICK = new Set([
  "roblox", "robux", "game", "pass", "gamepass", "https", "http", "www", "com", "users", "profile",
  "create", "creator", "hub", "sales", "price", "item", "for", "sale", "managed", "pricing", "pending",
  "transactions", "id", "ok", "okay", "hello", "hi", "vip", "wildberries", "telegram", "vk",
]);

/** Ники Roblox (3–20 латиницей/цифрами/_) и Pass ID (9–11 цифр) из текстов чата. */
export function extractRobloxRefs(texts: string[]): { nicks: string[]; passIds: string[] } {
  const nicks = new Set<string>();
  const passIds = new Set<string>();
  for (const raw of texts) {
    const text = raw ?? "";
    for (const m of text.matchAll(/(?:^|[^A-Za-z0-9_])@?([A-Za-z][A-Za-z0-9_]{2,19})(?![A-Za-z0-9_])/g)) {
      const nick = m[1];
      if (NOT_NICK.has(nick.toLowerCase())) continue;
      // Нужна хоть одна цифра/подчёркивание/заглавная внутри или длина ≥ 5 — иначе это слово.
      if (nick.length < 5 && !/[0-9_]/.test(nick)) continue;
      nicks.add(nick);
    }
    for (const m of text.matchAll(/(?:game-pass\/|^|\D)(\d{9,11})(?:\D|$)/g)) passIds.add(m[1]);
  }
  return { nicks: [...nicks].slice(0, 15), passIds: [...passIds].slice(0, 10) };
}

async function usersByCodes(db: Db, codes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (codes.length === 0) return out;
  const rows = await db.wbOrder.findMany({ where: { wbCode: { in: codes } }, select: { wbCode: true, userId: true } });
  for (const r of rows) out.set(r.wbCode, r.userId);
  return out;
}

/**
 * Кто покупатель этого DBS-заказа у нас. Все шаги — только чтение.
 */
export async function identifyWbBuyer(db: Db, marketplaceOrderId: string): Promise<BuyerIdentity> {
  const mo = await db.wbMarketplaceOrder.findUnique({
    where: { id: marketplaceOrderId },
    select: { id: true, buyerName: true, orderUid: true, isTest: true, wbCode: { select: { code: true } } },
  });
  if (!mo) return { matches: [], namesakes: 0, buyerName: null };
  const why = new Map<string, { level: IdentityLevel; why: string }>();
  const mark = (userId: string | undefined, level: IdentityLevel, reason: string) => {
    if (!userId) return;
    const prev = why.get(userId);
    const rank = { exact: 3, likely: 2, namesake: 1 } as const;
    if (!prev || rank[level] > rank[prev.level]) why.set(userId, { level, why: reason });
  };

  // 1–2. Этот заказ и соседи по покупке, активированные по коду.
  const siblings = mo.orderUid
    ? await db.wbMarketplaceOrder.findMany({
        where: { orderUid: mo.orderUid, isTest: mo.isTest },
        select: { id: true, wbCode: { select: { code: true } } },
      })
    : [{ id: mo.id, wbCode: mo.wbCode }];
  const siblingCodes = siblings.map((s: { wbCode: { code: string } | null }) => s.wbCode?.code).filter(Boolean) as string[];
  const byCode = await usersByCodes(db, siblingCodes);
  if (mo.wbCode?.code) mark(byCode.get(mo.wbCode.code), "exact", "этот заказ активирован");
  for (const code of siblingCodes) if (code !== mo.wbCode?.code) mark(byCode.get(code), "exact", "та же покупка WB");

  // 3. Ник Roblox / Pass ID, названные в чате WB.
  const events = await db.wbBuyerChatEvent.findMany({
    where: { marketplaceOrderId: { in: siblings.map((s: { id: string }) => s.id) }, sender: { not: "seller" } },
    orderBy: { sentAt: "desc" },
    take: 40,
    select: { textRedacted: true },
  });
  const refs = extractRobloxRefs(events.map((e: { textRedacted: string | null }) => e.textRedacted ?? ""));
  if (refs.nicks.length || refs.passIds.length) {
    const hits = await db.wbOrder.findMany({
      where: {
        isTest: false,
        OR: [
          ...refs.nicks.map((n) => ({ robloxUsername: { equals: n, mode: "insensitive" } })),
          ...(refs.passIds.length ? [{ gamepassId: { in: refs.passIds } }] : []),
        ],
      },
      select: { userId: true, robloxUsername: true, gamepassId: true },
      take: 20,
    });
    for (const h of hits) {
      const viaPass = h.gamepassId && refs.passIds.includes(h.gamepassId);
      mark(h.userId, "exact", viaPass ? `тот же пасс ${h.gamepassId}` : `тот же ник Roblox «${h.robloxUsername}»`);
    }
  }

  // 4–5. То же имя на WB у других заказов, которые активировали.
  let namesakes = 0;
  if (mo.buyerName && mo.buyerName.trim().length >= 2) {
    const same = await db.wbMarketplaceOrder.findMany({
      where: {
        isTest: mo.isTest,
        buyerName: { equals: mo.buyerName.trim(), mode: "insensitive" },
        wbCodeId: { not: null },
        ...(mo.orderUid ? { NOT: { orderUid: mo.orderUid } } : { id: { not: mo.id } }),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { wbCode: { select: { code: true } } },
    });
    const nameUsers = await usersByCodes(db, same.map((s: { wbCode: { code: string } | null }) => s.wbCode?.code).filter(Boolean));
    const distinct = [...new Set(nameUsers.values())];
    namesakes = distinct.length;
    for (const u of distinct.slice(0, 5)) {
      mark(u, distinct.length === 1 ? "likely" : "namesake",
        distinct.length === 1 ? "то же имя на WB, других с таким именем нет" : `тёзка: ${distinct.length} разных людей с этим именем`);
    }
  }

  if (why.size === 0) return { matches: [], namesakes, buyerName: mo.buyerName };
  const ids = [...why.keys()];
  const [users, orders] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, username: true, tgId: true, vkId: true } }),
    db.wbOrder.findMany({
      where: { userId: { in: ids }, isTest: false },
      orderBy: { createdAt: "desc" },
      select: { userId: true, wbCode: true, status: true },
    }),
  ]);
  const matches: BuyerMatch[] = users.map((u: { id: string; name: string | null; username: string | null; tgId: string | null; vkId: string | null }) => {
    const own = orders.filter((o: { userId: string }) => o.userId === u.id);
    const w = why.get(u.id)!;
    return {
      userId: u.id, name: u.name, tgUsername: u.username, tgId: u.tgId, vkId: u.vkId,
      orders: own.length, bought: own.filter((o: { status: string }) => o.status === "COMPLETED").length,
      lastCode: own[0]?.wbCode ?? null, level: w.level, why: w.why,
    };
  });
  const rank = { exact: 0, likely: 1, namesake: 2 } as const;
  matches.sort((a, b) => rank[a.level] - rank[b.level] || b.orders - a.orders);
  return { matches, namesakes, buyerName: mo.buyerName };
}

/** Как связаться: «@anna (TG)», «TG id 123», «vk.com/id456». */
export function contactOf(m: Pick<BuyerMatch, "tgUsername" | "tgId" | "vkId">): string {
  const parts: string[] = [];
  if (m.tgId) parts.push(m.tgUsername ? `@${m.tgUsername} (TG)` : `TG id ${m.tgId}`);
  if (m.vkId) parts.push(`vk.com/id${m.vkId}`);
  return parts.join(" · ") || "сайт";
}

/**
 * Строки для карточек и уведомлений (обычный текст, без HTML).
 * Точное — одной строкой «это наш клиент», догадка — «вероятно», тёзки —
 * предупреждением, чтобы не перепутать.
 */
export function identityLines(identity: BuyerIdentity, opts: { max?: number } = {}): string[] {
  const max = opts.max ?? 2;
  const lines: string[] = [];
  const describe = (m: BuyerMatch) =>
    `${m.name ?? "без имени"} · ${contactOf(m)} · заказов ${m.orders}, выкуплено ${m.bought}${m.lastCode ? ` · последний ${m.lastCode}` : ""}`;
  const exact = identity.matches.filter((m) => m.level === "exact");
  const likely = identity.matches.filter((m) => m.level === "likely");
  for (const m of exact.slice(0, max)) lines.push(`👤 Наш клиент: ${describe(m)} — ${m.why}`);
  if (exact.length === 0) for (const m of likely.slice(0, 1)) lines.push(`👤 Вероятно наш клиент: ${describe(m)} — ${m.why}`);
  if (exact.length === 0 && likely.length === 0 && identity.namesakes > 1) {
    lines.push(`👥 «${identity.buyerName}» — ${identity.namesakes} разных покупателей с таким именем в базе, не путать`);
  }
  if (lines.length === 0) lines.push("🆕 Новый покупатель — у нас его ещё нет");
  return lines;
}

/** Готовые строки по id заказа DBS; ошибка — пусто (не ломаем уведомление). */
export async function identityLinesFor(db: Db, marketplaceOrderId: string): Promise<string[]> {
  try {
    return identityLines(await identifyWbBuyer(db, marketplaceOrderId));
  } catch {
    return [];
  }
}

/** Полный профиль нашего покупателя: каналы, заказы, имена на WB, след на WB. */
export async function buyerProfile(db: Db, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, username: true, tgId: true, vkId: true, robloxUsername: true, createdAt: true },
  });
  if (!user) return null;
  const orders = await db.wbOrder.findMany({
    where: { userId, isTest: false },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { wbCode: true, amount: true, status: true, createdAt: true, completedAt: true, heldAt: true, robloxUsername: true, isDirectOrder: true },
  });
  const codes = orders.map((o: { wbCode: string }) => o.wbCode);
  const [wb, risks] = await Promise.all([
    codes.length
      ? db.wbMarketplaceOrder.findMany({
          where: { wbCode: { code: { in: codes } } },
          select: { wbOrderId: true, buyerName: true, cancelledAt: true, claimOpenedAt: true, claimReason: true, wbCode: { select: { code: true } } },
        })
      : [],
    codes.length
      ? db.riskEvent.findMany({
          where: { wbCode: { in: codes } },
          orderBy: { occurredAt: "desc" },
          take: 15,
          select: { kind: true, wbCode: true, stars: true, starsBefore: true, text: true, occurredAt: true, resolvedAt: true },
        })
      : [],
  ]);
  return {
    name: user.name,
    contact: contactOf({ tgUsername: user.username, tgId: user.tgId, vkId: user.vkId }),
    since: user.createdAt,
    robloxNicks: [...new Set([user.robloxUsername, ...orders.map((o: { robloxUsername: string | null }) => o.robloxUsername)].filter(Boolean))],
    wbBuyerNames: [...new Set(wb.map((w: { buyerName: string | null }) => w.buyerName).filter(Boolean))],
    orders: orders.map((o: { wbCode: string; amount: number; status: string; createdAt: Date; completedAt: Date | null; heldAt: Date | null; isDirectOrder: boolean }) => ({
      code: o.wbCode, robux: o.amount, status: o.heldAt ? "заморожен" : o.status, created: o.createdAt, bought: o.completedAt,
      source: o.isDirectOrder ? "прямой" : "WB",
    })),
    wbClaims: wb.filter((w: { claimOpenedAt: Date | null }) => w.claimOpenedAt)
      .map((w: { wbCode: { code: string } | null; claimReason: string | null; cancelledAt: Date | null }) => ({ code: w.wbCode?.code, reason: w.claimReason?.slice(0, 200), refunded: Boolean(w.cancelledAt) })),
    wbFootprint: risks.map((r: { kind: string; wbCode: string | null; stars: number | null; starsBefore: number | null; text: string | null; occurredAt: Date; resolvedAt: Date | null }) => ({
      kind: r.kind, code: r.wbCode, stars: r.stars, starsBefore: r.starsBefore, text: r.text?.slice(0, 200), at: r.occurredAt, open: !r.resolvedAt,
    })),
  };
}

/**
 * Найти покупателя по чему угодно: код заказа, номер заказа WB, ник Roblox,
 * @username Telegram, имя на WB или в боте. До трёх профилей.
 */
export async function whoIs(db: Db, query: string) {
  const q = query.trim().replace(/^@/, "");
  if (q.length < 2) return { notes: [] as string[], found: [], more: 0 };
  const userIds = new Set<string>();
  const notes: string[] = [];
  const upper = q.toUpperCase();

  // Код заказа или номер заказа WB → заказ → покупатель (и распознавание WB-стороны).
  const mo = await db.wbMarketplaceOrder.findFirst({
    where: { OR: [{ wbOrderId: q }, { wbCode: { code: upper } }] },
    select: { id: true },
  });
  if (mo) {
    const identity = await identifyWbBuyer(db, mo.id);
    notes.push(...identityLines(identity, { max: 3 }));
    for (const m of identity.matches) if (m.level !== "namesake") userIds.add(m.userId);
  }
  const byCode = await db.wbOrder.findUnique({ where: { wbCode: upper }, select: { userId: true } }).catch(() => null);
  if (byCode) userIds.add(byCode.userId);

  if (userIds.size === 0) {
    const [users, nickOrders, wbNamed] = await Promise.all([
      db.user.findMany({
        where: { OR: [{ username: { equals: q, mode: "insensitive" } }, { robloxUsername: { equals: q, mode: "insensitive" } }, { name: { equals: q, mode: "insensitive" } }] },
        select: { id: true }, take: 5,
      }),
      db.wbOrder.findMany({ where: { robloxUsername: { equals: q, mode: "insensitive" } }, select: { userId: true }, take: 5 }),
      db.wbMarketplaceOrder.findMany({
        where: { buyerName: { equals: q, mode: "insensitive" }, wbCodeId: { not: null } },
        orderBy: { createdAt: "desc" }, take: 50, select: { wbCode: { select: { code: true } } },
      }),
    ]);
    for (const u of users) userIds.add(u.id);
    for (const o of nickOrders) userIds.add(o.userId);
    const named = await usersByCodes(db, wbNamed.map((w: { wbCode: { code: string } | null }) => w.wbCode?.code).filter(Boolean));
    const distinct = new Set(named.values());
    if (distinct.size > 1) notes.push(`«${q}» на WB — ${distinct.size} разных покупателей (тёзки), показаны первые`);
    for (const u of distinct) userIds.add(u);
  }

  const found: Array<NonNullable<Awaited<ReturnType<typeof buyerProfile>>>> = [];
  for (const id of [...userIds].slice(0, 3)) {
    const p = await buyerProfile(db, id);
    if (p) found.push(p);
  }
  return { notes, found, more: Math.max(0, userIds.size - 3) };
}

/**
 * Последние плохие отзывы WB и кто за ними у нас — без ИИ (команда `/reviews`).
 * Один отзыв — одна строка-блок: звёзды, имя на WB, код заказа, наш клиент.
 */
export async function recentBadReviewsWithBuyers(db: Db, limit = 10) {
  const events = await db.riskEvent.findMany({
    where: { kind: "BAD_REVIEW" },
    orderBy: { occurredAt: "desc" },
    take: limit * 3,
    select: { wbCode: true, wbOrderId: true, buyerName: true, stars: true, text: true, occurredAt: true, resolvedAt: true, feedbackId: true },
  });
  const seen = new Set<string>();
  const out: Array<{
    stars: number | null; at: Date; text: string | null; wbName: string | null; code: string | null; wbOrderId: string | null;
    open: boolean; who: string[];
  }> = [];
  for (const e of events) {
    const key = e.feedbackId ?? `${e.wbCode}:${e.occurredAt.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mo = e.wbCode
      ? await db.wbMarketplaceOrder.findFirst({ where: { wbCode: { code: e.wbCode } }, select: { id: true } })
      : null;
    out.push({
      stars: e.stars, at: e.occurredAt, text: e.text, wbName: e.buyerName, code: e.wbCode, wbOrderId: e.wbOrderId,
      open: !e.resolvedAt, who: mo ? await identityLinesFor(db, mo.id) : ["🆕 Заказа у нас нет"],
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Текст профиля для команды `/who` (обычный текст). */
export function profileText(p: NonNullable<Awaited<ReturnType<typeof buyerProfile>>>): string {
  const lines = [
    `👤 ${p.name ?? "без имени"} · ${p.contact}`,
    p.robloxNicks.length ? `🎮 Ник Roblox: ${p.robloxNicks.join(", ")}` : null,
    p.wbBuyerNames.length ? `🛍 Имя на WB: ${p.wbBuyerNames.join(", ")}` : null,
    `📦 Заказы (${p.orders.length}): ${p.orders.slice(0, 6).map((o) => `${o.code} ${o.robux} R$ ${o.status === "COMPLETED" ? "✅" : o.status === "заморожен" ? "❄️" : "⏳"}`).join(" · ")}${p.orders.length > 6 ? " …" : ""}`,
    ...p.wbFootprint.slice(0, 4).map((f) => `⚠️ ${f.kind === "BAD_REVIEW" ? `отзыв ★${f.stars}` : f.kind === "REVIEW_FIXED" ? `отзыв исправлен ★${f.starsBefore}→★${f.stars}` : f.kind} · ${f.code} · ${f.at.toISOString().slice(0, 10)}${f.text ? ` · «${f.text.slice(0, 80)}»` : ""}`),
    ...p.wbClaims.slice(0, 2).map((c) => `↩ заявка на возврат · ${c.code}${c.refunded ? " · деньги вернули" : ""}${c.reason ? ` · «${c.reason.slice(0, 80)}»` : ""}`),
  ];
  return lines.filter(Boolean).join("\n");
}
