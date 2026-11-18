/* ─────────────────────────────────────────────────────────────────────────────
   🧩 «Похоже, один человек» (Э7, 18.11.2026) — подбор пар для склейки.

   Замер 18.11: из 1 969 профилей и Telegram, и ВК есть только у 11. Остальные
   люди с двумя площадками живут двумя профилями: заказ во ВК, переписка в
   Telegram. Автоматически склеиваем только по доказательству (ссылка `ln_…`,
   Э1); всё прочее — сюда, админу, с объяснением, почему мы так думаем.

   Улики по силе:
     • `contact` — аккаунт нажал «Да, это мой заказ» на чужом заказе (по коду,
       номеру покупки кода, пассу, нику или имени). Сильно, но это может быть
       и родитель ребёнка, поэтому решает человек;
     • `name` — одно имя (порядок слов не важен) у профиля только с Telegram и
       профиля только с ВК, хотя бы у одного есть заказы. Слабо — тёзки.
   Модуль чистый: строки на входе, пары на выходе.
   ───────────────────────────────────────────────────────────────────────── */

import { nameKey } from "./order-contacts";

export interface CandidateUser {
  id: string;
  name: string | null;
  username: string | null;
  tgId: string | null;
  vkId: string | null;
  email: string | null;
  role: string;
  createdAt: Date;
  orders: number;
}

export interface ContactLink {
  contactUserId: string;
  ownerUserId: string;
  via: string;
  amount: number;
  kind: "wb" | "code";
}

export type Evidence = { kind: "contact"; text: string; strong: true } | { kind: "name"; text: string; strong: false };

export interface MergePair {
  key: string;
  /** Остаётся (больше заказов; при равенстве — старше). */
  target: CandidateUser;
  /** Вливается в target. */
  source: CandidateUser;
  evidence: Evidence[];
  strong: boolean;
}

const channels = (u: CandidateUser) => [u.tgId ? "TG" : null, u.vkId ? "VK" : null].filter(Boolean) as string[];

/** Склеить можно, только если площадки не пересекаются (иначе два разных Telegram). */
export function mergeable(a: CandidateUser, b: CandidateUser): boolean {
  if (a.id === b.id || a.role === "ADMIN" || b.role === "ADMIN") return false;
  if (a.tgId === "admin" || b.tgId === "admin") return false;
  const ca = channels(a), cb = channels(b);
  if (!ca.length || !cb.length) return false;
  if (ca.some((c) => cb.includes(c))) return false;
  if (a.email && b.email) return false;
  return true;
}

export const pairKey = (a: string, b: string) => [a, b].sort().join(":");

function orient(a: CandidateUser, b: CandidateUser): { target: CandidateUser; source: CandidateUser } {
  if (a.orders !== b.orders) return a.orders > b.orders ? { target: a, source: b } : { target: b, source: a };
  return a.createdAt <= b.createdAt ? { target: a, source: b } : { target: b, source: a };
}

const VIA_TEXT: Record<string, string> = {
  support_code: "назвал код заказа в поддержке",
  support_pass: "прислал геймпасс заказа в поддержке",
  support_nick: "назвал ник заказа в поддержке",
  support_name: "совпало имя, подтвердил покупку кнопкой",
  bot_code: "ввёл код заказа в боте",
  admin: "подключён админом",
};

export function buildMergePairs(input: {
  users: CandidateUser[];
  contacts: ContactLink[];
  dismissed: Set<string>;
}): MergePair[] {
  const byId = new Map(input.users.map((u) => [u.id, u]));
  const pairs = new Map<string, MergePair>();
  const add = (a: CandidateUser | undefined, b: CandidateUser | undefined, ev: Evidence) => {
    if (!a || !b || !mergeable(a, b)) return;
    const key = pairKey(a.id, b.id);
    if (input.dismissed.has(key)) return;
    const pair = pairs.get(key) ?? { key, ...orient(a, b), evidence: [], strong: false };
    if (!pair.evidence.some((e) => e.text === ev.text)) pair.evidence.push(ev);
    pair.strong = pair.strong || ev.strong;
    pairs.set(key, pair);
  };

  for (const c of input.contacts) {
    add(byId.get(c.contactUserId), byId.get(c.ownerUserId), {
      kind: "contact", strong: true,
      text: `${VIA_TEXT[c.via] ?? "подключён к заказу"} — ${c.kind === "code" ? "покупка кода" : "заказ"} на ${c.amount} R$`,
    });
  }

  // Имя: только профиль-с-Telegram против профиля-с-ВК, у одного из них есть заказы.
  const groups = new Map<string, CandidateUser[]>();
  for (const u of input.users) {
    const k = nameKey(u.name);
    if (!k || (u.tgId && u.vkId)) continue;
    const list = groups.get(k) ?? [];
    list.push(u);
    groups.set(k, list);
  }
  for (const list of groups.values()) {
    const tg = list.filter((u) => u.tgId), vk = list.filter((u) => u.vkId);
    // Больше двух тёзок с каждой стороны — это уже не улика, а популярное имя.
    if (!tg.length || !vk.length || tg.length > 2 || vk.length > 2) continue;
    for (const a of tg) for (const b of vk) {
      if (a.orders + b.orders === 0) continue;
      add(a, b, { kind: "name", strong: false, text: "одно имя в Telegram и во ВКонтакте" });
    }
  }

  return [...pairs.values()].sort((x, y) => Number(y.strong) - Number(x.strong) || (y.target.orders + y.source.orders) - (x.target.orders + x.source.orders));
}
