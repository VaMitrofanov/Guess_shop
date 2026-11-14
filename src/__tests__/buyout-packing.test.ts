import { BALANCE_PRESETS, fitToBalance } from "@/lib/buyout-packing";

/** Строка выгрузки: `expectedPrice` — грязная цена пасса. */
const item = (code: string, clean: number) => ({ code, expectedPrice: Math.ceil(clean / 0.7) });

describe("набор заказов под баланс выкупного аккаунта", () => {
  it("берёт сверху вниз — по старшинству очереди, а не по цене", () => {
    // FFD набил бы плотнее, но увёз бы старейший заказ в следующий аккаунт.
    const fit = fitToBalance([item("old", 1200), item("new", 500)], 2000);
    expect(fit.picked.map(i => i.code)).toEqual(["old"]);
    expect(fit.rest.map(i => i.code)).toEqual(["new"]);
  });

  it("докладывает всё, что ещё помещается", () => {
    // 800 → 1143, 500 → 715: вместе 1858 при балансе 2000.
    const fit = fitToBalance([item("a", 800), item("b", 500)], 2000);
    expect(fit.picked).toHaveLength(2);
    expect(fit.gross).toBe(1858);
    expect(fit.left).toBe(142);
  });

  it("перешагивает через слишком дорогой заказ и берёт следующий влезающий", () => {
    // 1000 → 1429 занимает аккаунт; 1200 → 1715 уже не влезет, а 500 → 715 нет.
    const fit = fitToBalance([item("a", 1000), item("b", 1200), item("c", 500)], 2000);
    expect(fit.picked.map(i => i.code)).toEqual(["a"]);
    expect(fit.rest.map(i => i.code)).toEqual(["b", "c"]);
  });

  it("не прячет заказ дороже баланса — выносит отдельно", () => {
    // 2000 R$ стоит 2858 грязными: в аккаунт на 2000 он не влезет никогда.
    const fit = fitToBalance([item("big", 2000), item("small", 500)], 2000);
    expect(fit.unfit.map(i => i.code)).toEqual(["big"]);
    expect(fit.picked.map(i => i.code)).toEqual(["small"]);
  });

  it("на балансе покрупнее тот же заказ перестаёт быть «не влезает»", () => {
    const fit = fitToBalance([item("big", 2000)], 3000);
    expect(fit.unfit).toHaveLength(0);
    expect(fit.picked).toHaveLength(1);
  });

  it("считает, сколько ещё таких аккаунтов нужно на остаток", () => {
    // Четыре заказа по 1000 (1429): в каждый аккаунт на 2000 влезает один.
    const fit = fitToBalance([item("a", 1000), item("b", 1000), item("c", 1000), item("d", 1000)], 2000);
    expect(fit.picked).toHaveLength(1);
    expect(fit.moreAccounts).toBe(3);
  });

  it("не считает аккаунты под то, что в них не влезает вовсе", () => {
    const fit = fitToBalance([item("big", 2000), item("big2", 2000)], 2000);
    expect(fit.picked).toHaveLength(0);
    expect(fit.moreAccounts).toBe(0);
    expect(fit.unfit).toHaveLength(2);
  });

  it("на пустой очереди ничего не выдумывает", () => {
    const fit = fitToBalance([], 2000);
    expect(fit.picked).toHaveLength(0);
    expect(fit.fill).toBe(0);
    expect(fit.moreAccounts).toBe(0);
  });

  it("предлагает 2000 первым — столько кладут на выкупной аккаунт", () => {
    expect(BALANCE_PRESETS[0]).toBe(2000);
  });
});
