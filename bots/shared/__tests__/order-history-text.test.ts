import { actorText, describeEvent, mskText } from "../order-history-text";

describe("order-history-text", () => {
  it("время — по Москве строкой", () => {
    expect(mskText("2026-11-03T13:37:46Z")).toBe("03.11.2026 16:37 МСК");
    expect(mskText(null)).toBeNull();
  });

  it("Claude — ИИ-помощник, а не спрашивающий; admin: — админ", () => {
    expect(actorText("admin:Claude")).toMatch(/ИИ-помощник/);
    expect(actorText("Claude")).toMatch(/ИИ-помощник/);
    expect(actorText("admin:Demid")).toBe("админ Demid");
    expect(actorText("bot")).toBe("автоматика");
  });

  it("перевыкуп назван перевыкупом и с исполнителем", () => {
    const t = describeEvent("ORDER_STATUS_CHANGED", { from: "COMPLETED", to: "PENDING", why: "rebuy", actor: "admin:Claude", reason: "новый пасс" });
    expect(t).toMatch(/ПЕРЕВЫКУП/);
    expect(t).toMatch(/ИИ-помощник/);
    expect(t).toMatch(/новый пасс/);
  });

  it("смена статуса — русскими названиями", () => {
    expect(describeEvent("ORDER_STATUS_CHANGED", { from: "PENDING", to: "COMPLETED", actor: "admin:Demid", gross: 1429 }, { PENDING: "к выкупу", COMPLETED: "выкуплен" }))
      .toBe("статус «к выкупу» → «выкуплен»; сделал: админ Demid; списано 1429 R$");
  });

  it("обращение — с темой из поддержки, а не сырым ключом", () => {
    const t = describeEvent("SUPPORT_REQUEST_DELIVERED", { via: "tg-bot", text: null, photo: true, ocr: "unreadable", contextKey: "robux_low_pending_retry" })!;
    expect(t).toMatch(/Робуксов нет/);
    expect(t).not.toMatch(/robux_low_pending_retry/);
    expect(t).toMatch(/своего текста нет, прислал фото/);
    expect(t).toMatch(/не слова покупателя/);
    expect(t).toMatch(/не распознал/);
  });

  it("служебные события скрыты", () => {
    expect(describeEvent("ADMIN_CARD_ROOT", {})).toBeNull();
    expect(describeEvent("ORDER_PIN", {})).toBeNull();
  });

  it("ввод ника — попытка, не итог", () => {
    expect(describeEvent("AUDIT_NICK_ENTERED", { nick: "MEO", via: "site-search" })).toMatch(/попытка/);
  });
});

describe("notesByTime", () => {
  const NOW = Date.UTC(2026, 10, 26);
  it("смешанный порядок → по времени, старые сверху", async () => {
    const { notesByTime } = await import("../order-history-text");
    const note = [
      "[EDIT 2026-11-10 от Claude] ГП сменён",
      "[РАЗМОРОЗКА 03.11, 14:42 · Roblox] снята",
      "[❄️ ЗАМОРОЗКА 2026-09-21] висит",
      "[НИК? 2026-09-03] CAXAPOK299",
      "[УВЕД 2026-11-03 13:37] извещён",
      "[СВЯЗЬ 2026-11-26 от Claude] выкуп заказом MN",
      "[ПЕРЕВЫКУП 2026-11-26 от Claude] MN закрыт",
    ].join("\n");
    expect(notesByTime(note, NOW)).toEqual([
      "[НИК? 2026-09-03] CAXAPOK299",
      "[❄️ ЗАМОРОЗКА 2026-09-21] висит",
      "[РАЗМОРОЗКА 03.11, 14:42 · Roblox] снята",
      "[УВЕД 2026-11-03 13:37] извещён",
      "[EDIT 2026-11-10 от Claude] ГП сменён",
      "[СВЯЗЬ 2026-11-26 от Claude] выкуп заказом MN",
      "[ПЕРЕВЫКУП 2026-11-26 от Claude] MN закрыт",
    ]);
  });
  it("dd.mm без года не уезжает в будущее", async () => {
    const { notesByTime } = await import("../order-history-text");
    expect(notesByTime("[A 20.12] старое\n[B 2026-11-01] новее", NOW)).toEqual(["[A 20.12] старое", "[B 2026-11-01] новее"]);
  });
});
