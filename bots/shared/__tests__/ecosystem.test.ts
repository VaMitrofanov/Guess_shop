import { BIND_TTL_MS, TG_INVITE_QUIET_MS, bindFailureText, consumeBindToken, issueBindToken, parseBindStart, prepareTgInvite, tgInviteDue } from "../bot-bind";
import { buildMergePairs, mergeable, pairKey, type CandidateUser } from "../merge-candidates";
import { codeOrderStage, codeOrdersCardText } from "../customer-orders";

function challengeDb() {
  const rows = new Map<string, { stateHash: string; mode: string; targetUserId: string | null; expiresAt: Date; consumedAt: Date | null }>();
  return {
    rows,
    telegramWebLoginChallenge: {
      create: async ({ data }: { data: { stateHash: string; mode: string; targetUserId: string; expiresAt: Date } }) => { rows.set(data.stateHash, { ...data, consumedAt: null }); return data; },
      findUnique: async ({ where }: { where: { stateHash: string } }) => rows.get(where.stateHash) ?? null,
      updateMany: async ({ where, data }: { where: { stateHash?: string; targetUserId?: string; consumedAt: null }; data: { consumedAt: Date } }) => {
        let count = 0;
        for (const r of rows.values()) {
          if (r.consumedAt) continue;
          if (where.stateHash && r.stateHash !== where.stateHash) continue;
          if (where.targetUserId && r.targetUserId !== where.targetUserId) continue;
          r.consumedAt = data.consumedAt; count++;
        }
        return { count };
      },
    },
  };
}

describe("Э1: ссылка привязки Telegram", () => {
  it("разбор /start: только ln_ + 32 знака", () => {
    expect(parseBindStart("ln_" + "a".repeat(32))).toBe("a".repeat(32));
    expect(parseBindStart("ln_short")).toBeNull();
    expect(parseBindStart("web_link_" + "a".repeat(32))).toBeNull();
    expect(parseBindStart(null)).toBeNull();
  });
  it("токен одноразовый, в базе только хеш, ссылка влезает в лимит Telegram (64)", async () => {
    const db = challengeDb();
    const { state, url } = await issueBindToken(db, "u1");
    expect(url).toBe(`https://t.me/RobloxBankBot?start=ln_${state}`);
    expect(`ln_${state}`.length).toBeLessThanOrEqual(64);
    expect([...db.rows.keys()][0]).not.toContain(state);
    expect(await consumeBindToken(db, state)).toBe("u1");
    expect(await consumeBindToken(db, state)).toBeNull();
  });
  it("новый токен гасит старый; просроченный не работает", async () => {
    const db = challengeDb();
    const first = await issueBindToken(db, "u1");
    await issueBindToken(db, "u1");
    expect(await consumeBindToken(db, first.state)).toBeNull();
    const old = await issueBindToken(db, "u2", new Date(Date.now() - BIND_TTL_MS - 1000));
    expect(await consumeBindToken(db, old.state)).toBeNull();
  });
  it("отказ склейки — понятный текст и путь в поддержку", () => {
    expect(bindFailureText("Provider already linked to another subject")).toMatch(/другой Telegram/);
    expect(bindFailureText("Both profiles already have VK identities")).toMatch(/@RobloxBank_PA/);
  });
});

describe("Э6: приглашение из ВК в Telegram", () => {
  const now = Date.now();
  it("только тем, у кого есть ВК и нет Telegram, не чаще раза в 14 дней", () => {
    expect(tgInviteDue({ vkId: "1", tgId: null, tgInviteAt: null }, now)).toBe(true);
    expect(tgInviteDue({ vkId: "1", tgId: "2" }, now)).toBe(false);
    expect(tgInviteDue({ vkId: null, tgId: null }, now)).toBe(false);
    expect(tgInviteDue({ vkId: "1", tgInviteAt: new Date(now - 3 * 86_400_000) }, now)).toBe(false);
    expect(tgInviteDue({ vkId: "1", tgInviteAt: new Date(now - TG_INVITE_QUIET_MS - 1) }, now)).toBe(true);
  });
  it("два события подряд — одно приглашение (отметка атомарная)", async () => {
    const db = { ...challengeDb(), user: {
      findUnique: async () => ({ tgId: null, vkId: "1", tgInviteAt: null }),
      updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
    } };
    expect(await prepareTgInvite(db, "u1")).toMatch(/start=ln_/);
    expect(await prepareTgInvite(db, "u1")).toBeNull();
  });
});

const u = (over: Partial<CandidateUser>): CandidateUser => ({
  id: "x", name: null, username: null, tgId: null, vkId: null, email: null, role: "USER", createdAt: new Date("2026-11-01"), orders: 0, ...over,
});

describe("Э7: похоже, один человек", () => {
  const vk = u({ id: "vk1", name: "Екатерина Никитина", vkId: "34345713", orders: 1, createdAt: new Date("2026-11-17T11:08:00Z") });
  const tg = u({ id: "tg1", name: "Никитина Екатерина", tgId: "1257226627", username: "NikitinaEO", createdAt: new Date("2026-11-17T12:23:00Z") });

  it("одно имя TG и ВК с заказом — слабая пара; остаётся профиль с заказами", () => {
    const [p] = buildMergePairs({ users: [vk, tg], contacts: [], dismissed: new Set() });
    expect(p.strong).toBe(false);
    expect(p.target.id).toBe("vk1");
    expect(p.source.id).toBe("tg1");
  });
  it("подтвердил кнопкой — сильная, и наверху очереди", () => {
    const other = u({ id: "a", name: "Иван Петров", tgId: "5" });
    const otherVk = u({ id: "b", name: "Иван Петров", vkId: "6", orders: 3 });
    const pairs = buildMergePairs({
      users: [vk, tg, other, otherVk],
      contacts: [{ contactUserId: "tg1", ownerUserId: "vk1", via: "support_name", amount: 800, kind: "code" }],
      dismissed: new Set(),
    });
    expect(pairs[0].key).toBe(pairKey("vk1", "tg1"));
    expect(pairs[0].strong).toBe(true);
    expect(pairs[0].evidence.map((e) => e.kind).sort()).toEqual(["contact", "name"]);
  });
  it("«разные люди» больше не показываем; пересекающиеся площадки и админов не склеиваем", () => {
    expect(buildMergePairs({ users: [vk, tg], contacts: [], dismissed: new Set([pairKey("vk1", "tg1")]) })).toEqual([]);
    expect(mergeable(tg, u({ id: "z", tgId: "9" }))).toBe(false);
    expect(mergeable(tg, { ...vk, role: "ADMIN" })).toBe(false);
    expect(mergeable(tg, { ...vk, tgId: "admin" })).toBe(false);
  });
  it("тёзки без заказов и популярные имена — не пара", () => {
    expect(buildMergePairs({ users: [{ ...vk, orders: 0 }, tg], contacts: [], dismissed: new Set() })).toEqual([]);
    const many = [1, 2, 3].map((i) => u({ id: `t${i}`, name: "Анна Иванова", tgId: String(i), orders: 1 }));
    expect(buildMergePairs({ users: [...many, u({ id: "v", name: "Анна Иванова", vkId: "9", orders: 1 })], contacts: [], dismissed: new Set() })).toEqual([]);
  });
});

describe("Э2: покупка кода в «Мой заказ»", () => {
  it("свой выдан — в кабинете; подключённому код не обещаем; номера CODE- нет", () => {
    expect(codeOrderStage({ status: "ISSUED", linked: false }).word).toMatch(/кабинете/);
    expect(codeOrderStage({ status: "ISSUED", linked: true }).word).toMatch(/того, кто покупал/);
    const text = codeOrdersCardText([{ id: "co1", amount: 800, status: "ISSUED", createdAt: new Date("2026-11-17T12:00:00Z"), issuedAt: null, linked: false }]);
    expect(text).toContain("800 R$");
    expect(text).not.toMatch(/CODE-/);
    expect(codeOrdersCardText([])).toBeNull();
  });
});
