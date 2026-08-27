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
