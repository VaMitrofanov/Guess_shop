/**
 * F3 (ultra-review 28.07): `eligible` требует `userId`, поэтому анонимный
 * посетитель всегда получал `false` — даже в режиме `on`. Витрина и подвал
 * из-за этого сообщали «приём платежей отключён» открытому миру.
 *
 * Здесь зафиксировано разделение двух вопросов:
 *   siteAcceptsPayments — про САЙТ (что показываем на витрине);
 *   decision.eligible   — про АККАУНТ (можно ли нажать «Оплатить»).
 */
import {
  siteAcceptsPayments,
  siteAcquiringDecision,
  type SiteAcquiringMode,
} from "@/lib/site-acquiring";

const OWNER = "cmrqpf9c20000y6s0vn889rg2";

function decide(mode: SiteAcquiringMode, userId?: string, masterFlag = "true") {
  return siteAcquiringDecision({
    userId,
    masterFlag,
    mode,
    allowlist: OWNER,
    percentage: "100",
  });
}

describe("витрина не зависит от того, вошёл ли посетитель", () => {
  it.each<[SiteAcquiringMode, boolean]>([
    ["off", false],
    ["allowlist", true],
    ["percentage", true],
    ["on", true],
  ])("режим %s → сайт принимает оплату: %s", (mode, expected) => {
    // Ключевой случай: userId нет. Раньше здесь всегда получалось «закрыто».
    expect(siteAcceptsPayments(decide(mode, undefined))).toBe(expected);
    // Для вошедшего ответ про сайт обязан быть тем же.
    expect(siteAcceptsPayments(decide(mode, OWNER))).toBe(expected);
  });

  it("master-флаг выключает витрину в любом режиме", () => {
    for (const mode of ["off", "allowlist", "percentage", "on"] as SiteAcquiringMode[]) {
      expect(siteAcceptsPayments(decide(mode, OWNER, "false"))).toBe(false);
    }
  });
});

describe("допуск аккаунта остаётся строгим", () => {
  it("гость не получает eligible ни в одном режиме", () => {
    for (const mode of ["off", "allowlist", "percentage", "on"] as SiteAcquiringMode[]) {
      expect(decide(mode, undefined).eligible).toBe(false);
    }
  });

  it("allowlist пускает только своих", () => {
    expect(decide("allowlist", OWNER).eligible).toBe(true);
    expect(decide("allowlist", "someone-else").eligible).toBe(false);
  });

  it("в режиме on пускает любого вошедшего", () => {
    expect(decide("on", "someone-else").eligible).toBe(true);
  });

  it("выключенный master закрывает оплату даже владельцу", () => {
    expect(decide("on", OWNER, "false").eligible).toBe(false);
  });
});

describe("баннер витрины", () => {
  /** Та же матрица, что в чекауте и подвале. */
  function tone(mode: SiteAcquiringMode, userId?: string) {
    const decision = decide(mode, userId);
    if (!siteAcceptsPayments(decision)) return "closed";
    if (userId && !decision.eligible) return "limited";
    return undefined;
  }

  it("гость на открытом сайте не видит никакого предупреждения", () => {
    expect(tone("on", undefined)).toBeUndefined();
    // Даже при поэтапном запуске гостю нечего сказать про его аккаунт.
    expect(tone("allowlist", undefined)).toBeUndefined();
  });

  it("вошедший вне группы видит «поэтапный запуск», а не «отключено»", () => {
    expect(tone("allowlist", "someone-else")).toBe("limited");
  });

  it("выключенный сайт честно говорит «отключено» всем", () => {
    expect(tone("off", undefined)).toBe("closed");
    expect(tone("off", OWNER)).toBe("closed");
  });

  it("допущенный клиент не видит баннера", () => {
    expect(tone("allowlist", OWNER)).toBeUndefined();
  });
});
