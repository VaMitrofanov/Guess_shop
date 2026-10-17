import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allowConflictAlert, ownerLabel, parseXlinkPayload, buildXlinkPayload, resolveCodeClaim } from "../cross-platform-claim";

/* ─────────────────────────────────────────────────────────────────────────────
   Б1: код гейта открывает заказ на любой площадке.

   Что тут защищается:
     - владелец кода, вернувшийся на свою же площадку, НЕ считается чужим;
     - две учётки на ОДНОЙ площадке остаются настоящим конфликтом;
     - живой клиент со своей историей не сливается с чужим заказом молча;
     - недостижимость владельца определяется отказом VK, а не таймаутом.
   ───────────────────────────────────────────────────────────────────────── */

jest.mock("../notify", () => ({ vkCanReceive: jest.fn() }));
import { vkCanReceive as vkCanReceiveReal } from "../notify";
const vkCanReceive = vkCanReceiveReal as jest.Mock;

type Row = Record<string, unknown> | null;

function fakeDb(input: {
  code: Row;
  owner: Row;
  claimantOrders?: number;
}) {
  return {
    wbCode: { findUnique: async () => input.code },
    user: { findUnique: async () => input.owner },
    wbOrder: { count: async () => input.claimantOrders ?? 0 },
  } as never;
}

const VK_OWNER = { id: "owner1", tgId: null, vkId: "827005009", name: "Софи Веном", username: null };
const TG_OWNER = { id: "owner2", tgId: "8509702860", vkId: null, name: "Соня", username: "vviesho" };

beforeEach(() => vkCanReceive.mockReset());

describe("кто владеет кодом", () => {
  it("код без владельца — обычная активация", async () => {
    const verdict = await resolveCodeClaim(fakeDb({ code: { userId: null }, owner: null }), {
      code: "48BMVPF", claimantUserId: "someone", provider: "TG",
    });
    expect(verdict.kind).toBe("free");
  });

  it("владелец вернулся сам — это не чужая активация", async () => {
    const verdict = await resolveCodeClaim(fakeDb({ code: { userId: "owner1" }, owner: VK_OWNER }), {
      code: "48BMVPF", claimantUserId: "owner1", provider: "VK",
    });
    expect(verdict.kind).toBe("mine");
    // Достижимость при этом даже не спрашивается — спрашивать не о чем.
    expect(vkCanReceive).not.toHaveBeenCalled();
  });

  it("у владельца уже есть аккаунт на ЭТОЙ площадке — настоящий второй аккаунт", async () => {
    const verdict = await resolveCodeClaim(fakeDb({ code: { userId: "owner2" }, owner: TG_OWNER }), {
      code: "48BMVPF", claimantUserId: "other", provider: "TG",
    });
    expect(verdict.kind).toBe("conflict");
    if (verdict.kind === "conflict") expect(verdict.reason).toBe("owner_has_same_platform");
  });

  it("владельцу нельзя написать (VK без диалога) — связываем сразу", async () => {
    vkCanReceive.mockResolvedValue(false);
    const verdict = await resolveCodeClaim(fakeDb({ code: { userId: "owner1" }, owner: VK_OWNER }), {
      code: "48BMVPF", claimantUserId: null, provider: "TG",
    });
    expect(verdict.kind).toBe("link_now");
  });

  it("владельцу можно написать — решает он, мы ничего не трогаем", async () => {
    vkCanReceive.mockResolvedValue(true);
    const verdict = await resolveCodeClaim(fakeDb({ code: { userId: "owner1" }, owner: VK_OWNER }), {
      code: "48BMVPF", claimantUserId: null, provider: "TG",
    });
    expect(verdict.kind).toBe("ask_owner");
  });

  it("VK промолчал — это НЕ «недостижим»: спрашиваем, а не сливаем", async () => {
    vkCanReceive.mockResolvedValue(null);
    const verdict = await resolveCodeClaim(fakeDb({ code: { userId: "owner1" }, owner: VK_OWNER }), {
      code: "48BMVPF", claimantUserId: null, provider: "TG",
    });
    expect(verdict.kind).toBe("ask_owner");
  });

  it("у предъявителя своя история заказов, а владельца не спросить — не сливаем", async () => {
    vkCanReceive.mockResolvedValue(false);
    const verdict = await resolveCodeClaim(
      fakeDb({ code: { userId: "owner1" }, owner: VK_OWNER, claimantOrders: 3 }),
      { code: "48BMVPF", claimantUserId: "livecustomer", provider: "TG" },
    );
    expect(verdict.kind).toBe("conflict");
    if (verdict.kind === "conflict") expect(verdict.reason).toBe("claimant_has_own_orders");
  });

  it("у предъявителя история есть, но владелец на связи — пусть решает владелец", async () => {
    vkCanReceive.mockResolvedValue(true);
    const verdict = await resolveCodeClaim(
      fakeDb({ code: { userId: "owner1" }, owner: VK_OWNER, claimantOrders: 3 }),
      { code: "48BMVPF", claimantUserId: "livecustomer", provider: "TG" },
    );
    expect(verdict.kind).toBe("ask_owner");
  });
});

describe("payload подтверждения", () => {
  it("кодируется и читается обратно", () => {
    const payload = buildXlinkPayload("48BMVPF", "cmtwxm9h8098g0iujpcdsp9jb");
    expect(parseXlinkPayload(payload)).toEqual({ code: "48BMVPF", claimantUserId: "cmtwxm9h8098g0iujpcdsp9jb" });
  });

  it("влезает в 64 байта callback_data Telegram", () => {
    expect(Buffer.byteLength(buildXlinkPayload("48BMVPF", "cmtwxm9h8098g0iujpcdsp9jb"))).toBeLessThanOrEqual(64);
  });

  it("мусор не разбирается", () => {
    expect(parseXlinkPayload("xlink:short:x")).toBeNull();
    expect(parseXlinkPayload("gpw_ok:abc")).toBeNull();
    expect(parseXlinkPayload("xlink:48BMVPF")).toBeNull();
  });
});

describe("подпись владельца", () => {
  it("@username важнее имени", () => {
    expect(ownerLabel(TG_OWNER)).toBe("@vviesho");
    expect(ownerLabel(VK_OWNER)).toBe("Софи Веном");
  });
});

/* Прежний сторож («userId не совпал») ловил собственного владельца при
 * повторном входе: 4 срабатывания за 20 часов, все ложные. Ветка «код уже мой»
 * обязана существовать явно, а P2025 — перечитывать победителя гонки. */
describe("сайт: повторный вход владельца больше не «второй аккаунт»", () => {
  const auth = readFileSync(join(process.cwd(), "src/auth.ts"), "utf8");

  it("у кода три исхода, а не два", () => {
    expect(auth).toContain("if (wbCodeRecord.userId === user.id)");
    expect(auth).toContain("} else if (wbCodeRecord.userId) {");
  });

  it("P2025 больше не значит «занят другим» сам по себе", () => {
    expect(auth).toContain("wbCodeClaimedByOther = Boolean(winner?.userId && winner.userId !== user.id);");
  });
});

/* Сигнал, приходящий пачкой, перестают читать — на этом уже обесценился
 * прежний сторож ПВЗ-фрода. Тупик человек жмёт повторно, поэтому у красного
 * есть потолок: раз в час на код. */
describe("потолок красного алерта", () => {
  it("первый раз пропускает, второй в то же окно — нет", () => {
    const code = "TESTAAA";
    expect(allowConflictAlert(code)).toBe(true);
    expect(allowConflictAlert(code)).toBe(false);
  });

  it("другой код считается отдельно", () => {
    expect(allowConflictAlert("TESTBBB")).toBe(true);
    expect(allowConflictAlert("TESTCCC")).toBe(true);
  });

  it("по истечении окна снова пропускает", () => {
    const code = "TESTDDD";
    expect(allowConflictAlert(code, 1)).toBe(true);
    return new Promise((r) => setTimeout(r, 5)).then(() => {
      expect(allowConflictAlert(code, 1)).toBe(true);
    });
  });
});
