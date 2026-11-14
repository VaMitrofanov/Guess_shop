/**
 * A1: единственное правило «админ или нет».
 *
 * До этого этапа правда жила в двух местах — `User.role === "ADMIN"` для
 * desktop `/admin` и `ADMIN_IDS` для TWA с ботами, — поэтому при трёх админах
 * состав неизбежно разъезжался, а роль в сессии записывалась один раз при
 * входе и больше не сверялась (A0.2: снятие админа не действовало до
 * перелогина).
 *
 * Тесты фиксируют инварианты: админом делает **проверенная** Telegram-личность
 * из актуального `ADMIN_IDS`; запасной вход требует два независимых условия;
 * состав читается на каждый вызов.
 */

const ADMIN_TG = "85137352";
const SECOND_ADMIN_TG = "304770174";
const STRANGER_TG = "999000111";
const BREAK_GLASS = "owner@robloxbank.test";

process.env.ADMIN_IDS = `${ADMIN_TG},${SECOND_ADMIN_TG}`;
process.env.ADMIN_BREAKGLASS_EMAILS = BREAK_GLASS;

import { adminGrantFor } from "@/lib/admin-grant";
import { adminSetVersion, isAdminTelegramId } from "@/lib/admin-roster";

const user = (over: Partial<Parameters<typeof adminGrantFor>[0]> = {}) => ({
  email: null,
  role: "USER",
  telegramSubjects: [] as string[],
  ...over,
});

describe("adminGrantFor — Telegram как основной путь", () => {
  it("проверенная TG-личность из ADMIN_IDS даёт админа", () => {
    expect(adminGrantFor(user({ telegramSubjects: [ADMIN_TG] })))
      .toEqual({ via: "telegram", telegramId: ADMIN_TG });
  });

  it("чужой Telegram админа не даёт", () => {
    expect(adminGrantFor(user({ telegramSubjects: [STRANGER_TG] }))).toBeNull();
  });

  it("role=ADMIN в базе сам по себе больше ничего не значит", () => {
    // Раньше этого поля хватало для входа в /admin.
    expect(adminGrantFor(user({ role: "ADMIN" }))).toBeNull();
  });

  it("админ узнаётся, даже если TG-личность не первая в списке", () => {
    expect(adminGrantFor(user({ telegramSubjects: [STRANGER_TG, SECOND_ADMIN_TG] })))
      .toEqual({ via: "telegram", telegramId: SECOND_ADMIN_TG });
  });
});

describe("Запасной вход владельца", () => {
  it("требует и адрес из env, и role=ADMIN", () => {
    expect(adminGrantFor(user({ email: BREAK_GLASS, role: "ADMIN" })))
      .toEqual({ via: "break-glass" });
  });

  it("адрес без роли в базе не проходит", () => {
    expect(adminGrantFor(user({ email: BREAK_GLASS, role: "USER" }))).toBeNull();
  });

  it("роль без адреса в env не проходит", () => {
    expect(adminGrantFor(user({ email: "someone@else.test", role: "ADMIN" }))).toBeNull();
  });

  it("регистр и пробелы в адресе не спасают и не мешают", () => {
    expect(adminGrantFor(user({ email: "  OWNER@RobloxBank.TEST ", role: "ADMIN" })))
      .toEqual({ via: "break-glass" });
  });
});

describe("Состав админов читается на каждый вызов", () => {
  it("снятие из ADMIN_IDS действует сразу, без перезапуска модуля", () => {
    const before = adminGrantFor(user({ telegramSubjects: [ADMIN_TG] }));
    expect(before).not.toBeNull();

    process.env.ADMIN_IDS = SECOND_ADMIN_TG;
    expect(adminGrantFor(user({ telegramSubjects: [ADMIN_TG] }))).toBeNull();
    expect(isAdminTelegramId(ADMIN_TG)).toBe(false);

    process.env.ADMIN_IDS = `${ADMIN_TG},${SECOND_ADMIN_TG}`;
    expect(adminGrantFor(user({ telegramSubjects: [ADMIN_TG] }))).not.toBeNull();
  });

  it("отпечаток состава меняется вместе со списком и не зависит от порядка", () => {
    const direct = adminSetVersion();
    process.env.ADMIN_IDS = `${SECOND_ADMIN_TG},${ADMIN_TG}`;
    expect(adminSetVersion()).toBe(direct);

    process.env.ADMIN_IDS = SECOND_ADMIN_TG;
    expect(adminSetVersion()).not.toBe(direct);

    process.env.ADMIN_IDS = `${ADMIN_TG},${SECOND_ADMIN_TG}`;
  });

  it("пустой ADMIN_IDS не раздаёт права", () => {
    process.env.ADMIN_IDS = "";
    expect(adminGrantFor(user({ telegramSubjects: [ADMIN_TG] }))).toBeNull();
    process.env.ADMIN_IDS = `${ADMIN_TG},${SECOND_ADMIN_TG}`;
  });

  it("без ADMIN_BREAKGLASS_EMAILS запасной вход выключен целиком", () => {
    const previous = process.env.ADMIN_BREAKGLASS_EMAILS;
    delete process.env.ADMIN_BREAKGLASS_EMAILS;
    expect(adminGrantFor(user({ email: BREAK_GLASS, role: "ADMIN" }))).toBeNull();
    process.env.ADMIN_BREAKGLASS_EMAILS = previous;
  });
});
