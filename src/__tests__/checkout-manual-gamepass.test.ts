import { readFileSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..");
const checkout = readFileSync(path.join(ROOT, "src/app/checkout/page.tsx"), "utf8");
const css = readFileSync(path.join(ROOT, "src/app/checkout/checkout.module.css"), "utf8");

/**
 * Запасной вход на витрине: ссылка или ID геймпасса вместо поиска по нику.
 *
 * Поиск по нику стоит на публичных списках Roblox и молчит при живом
 * геймпассе чаще, чем кажется: скрытый плейс (треть застрявших заказов по
 * разбору 22.08), свежий пасс, лаг API. В `/guide` этот вход уже есть; на
 * витрине покупатель упирался в «геймпассов не нашли» и уходил.
 */
describe("checkout — ручной ввод геймпасса", () => {
  it("тупик поиска по нику сам открывает запасной вход", () => {
    expect(checkout).toContain("setNickDeadEnd(true)");
    expect(checkout).toContain("setManualOpen(true)");
    expect(checkout).toContain("вставь ссылку на геймпасс ниже");
  });

  it("принимает и ссылку, и голый ID", () => {
    expect(checkout).toContain('import { parseGamepassRef } from "@/lib/gamepass-id"');
    expect(checkout).toContain("const runManualLookup");
    expect(checkout).toContain("Ссылка на геймпасс или его номер");
  });

  it("ссылка, набранная в поле ника, уезжает в своё поле, а не отбивается валидацией", () => {
    expect(checkout).toContain("if (parseGamepassRef(query))");
    expect(checkout).toContain("setManualRef(query)");
  });

  it("ник заказа берётся у владельца пасса — робуксы уходят именно ему", () => {
    expect(checkout).toContain("const acceptManualPass");
    expect(checkout).toContain("pass.creatorName || pass.sellerName");
    expect(checkout).toContain("Владелец пасса");
  });

  /**
   * Разные получатели денег — единственное место, где витрина обязана
   * остановиться и спросить.
   *
   * Робуксы Roblox переводит ВЛАДЕЛЬЦУ геймпасса. Если покупатель искал один
   * аккаунт, а вставил ссылку на пасс другого, заказ уедет второму. В WB-пути
   * это ловит серверный гард `OWNER_MISMATCH` (`select-gamepass`) и отказывает;
   * витрина через тот роут не идёт и раньше просто молча перезаписывала поле
   * ника владельцем — подмена была видна, но не спрошена.
   *
   * Решение владельца 07.09.2026: не отказывать. Человек вправе оформить на
   * второй аккаунт — от нас требуется показать оба ника и получить нажатие.
   */
  it("расхождение ника и владельца пасса называется вслух, а не подставляется молча", () => {
    expect(checkout).toContain("const ownerMismatch");
    expect(checkout).toContain("owner.toLowerCase() !== claimed.toLowerCase()");
    // Оба имени в одном предложении: «кому не придут» так же важно, как «кому придут».
    expect(checkout).toContain("а этот геймпасс принадлежит");
    expect(checkout).toContain("владельцу геймпасса");
  });

  it("зелёная строка «всё в порядке» не показывается при расхождении", () => {
    expect(checkout).toContain("{ready && owner && !ownerMismatch && (");
  });

  it("последствие названо на самой кнопке, а не только в блоке выше", () => {
    // Карточку жмут, не долистав до предупреждения.
    expect(checkout).toContain("Нажми, чтобы оформить заказ на");
  });

  it("отказ объясняется словами, а не серой кнопкой", () => {
    expect(checkout).toContain("не выставлен на продажу");
    expect(checkout).toContain("вне диапазона заказа");
    expect(checkout).toContain("disabled={!ready}");
  });

  it("несёт свои стили", () => {
    expect(css).toContain(".manualToggle");
    expect(css).toContain(".manualWarn");
    expect(css).toContain(".manualOk");
  });
});
