#!/usr/bin/env node

import {
  priceForTargetMargin,
  quoteGamepassPayment,
  type GamepassPricingRates,
  type UsnMode,
} from "../src/lib/gamepass-pricing";

type Args = Record<string, string | undefined>;

function argsFrom(argv: string[]): Args {
  const result: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const [rawKey, inline] = token.slice(2).split("=", 2);
    const following = argv[index + 1];
    if (inline !== undefined) result[rawKey] = inline;
    else if (following && !following.startsWith("--")) {
      result[rawKey] = following;
      index += 1;
    } else result[rawKey] = "true";
  }
  return result;
}

function numberArg(args: Args, key: string, fallback: number): number {
  const value = args[key] === undefined ? fallback : Number(String(args[key]).replace(",", "."));
  if (!Number.isFinite(value)) throw new Error(`--${key} должно быть числом`);
  return value;
}

function rub(kopecks: number) {
  return `${(kopecks / 100).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function pct(value: number) {
  return `${value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function printHelp() {
  console.log(`
Калькулятор цены Roblox Game Pass

Обязательные для рабочего расчёта параметры можно менять при каждом запуске:
  --robux 1000          чистые R$, которые должен получить клиент
  --usd-rub 81.05       рублей за 1 доллар
  --usd-per-1k 4.3      долларов за 1000 грязных R$
  --margin 40.45        целевая чистая маржа, % от платежа

Необязательные параметры:
  --price 995           текущая цена покупателю для сравнения, ₽
  --roblox-fee 30       комиссия Roblox, %
  --acquiring 3.49      эквайринг, %
  --acquiring-min 3.49  минимальная комиссия эквайринга, ₽
  --receipts 0          сервис чеков, %
  --usn 6               налог УСН, %
  --usn-mode income     income или income-minus-expenses

Пример:
  npm run calc:gamepass -- --robux 1000 --usd-rub 81.05 --usd-per-1k 4.3 --margin 40.45 --price 995
`);
}

function main() {
  const args = argsFrom(process.argv.slice(2));
  if (args.help === "true") {
    printHelp();
    return;
  }

  const usnMode = (args["usn-mode"] ?? "income") as UsnMode;
  if (usnMode !== "income" && usnMode !== "income-minus-expenses") {
    throw new Error("--usn-mode: допустимы income или income-minus-expenses");
  }

  const netRobux = Math.round(numberArg(args, "robux", 1000));
  const targetMarginPct = numberArg(args, "margin", 40.45);
  const rates: GamepassPricingRates = {
    usdToRub: numberArg(args, "usd-rub", 81.05),
    rateUsdPer1k: numberArg(args, "usd-per-1k", 4.3),
    taxPct: numberArg(args, "roblox-fee", 30),
    acquiringPct: numberArg(args, "acquiring", 3.49),
    acquiringMinKopecks: Math.round(numberArg(args, "acquiring-min", 3.49) * 100),
    receiptPct: numberArg(args, "receipts", 0),
    usnPct: numberArg(args, "usn", 6),
    usnMode,
  };

  const recommended = priceForTargetMargin(netRobux, targetMarginPct, rates);
  if (!recommended) throw new Error("Целевая маржа недостижима с указанными ставками");

  const currentPriceRub = args.price === undefined ? null : numberArg(args, "price", 0);
  const current = currentPriceRub === null
    ? null
    : quoteGamepassPayment(netRobux, Math.round(currentPriceRub * 100), rates);

  console.log("\nКАЛЬКУЛЯТОР GAME PASS");
  console.log(`Клиент получает:       ${recommended.netRobux.toLocaleString("ru-RU")} R$`);
  console.log(`Цена Game Pass:        ${recommended.grossRobux.toLocaleString("ru-RU")} R$`);
  console.log(`Комиссия Roblox:       ${recommended.robloxCommissionRobux.toLocaleString("ru-RU")} R$ (${rates.taxPct}%)`);
  console.log(`Себестоимость:         ${rub(recommended.purchaseCostKopecks)}`);
  console.log(`Эквайринг + чеки:      ${rub(recommended.acquiringKopecks)}`);
  console.log(`Налог УСН:             ${rub(recommended.usnKopecks)}`);
  console.log(`Цена покупателю:       ${rub(recommended.buyerPaymentKopecks)}`);
  console.log(`Чистая прибыль:        ${rub(recommended.profitKopecks)} (${pct(recommended.marginPct)})`);

  if (current) {
    console.log("\nСРАВНЕНИЕ С ТЕКУЩЕЙ ЦЕНОЙ");
    console.log(`Текущая цена:          ${rub(current.buyerPaymentKopecks)}`);
    console.log(`Текущая прибыль:       ${rub(current.profitKopecks)} (${pct(current.marginPct)})`);
    console.log(`Изменение цены:        ${rub(recommended.buyerPaymentKopecks - current.buyerPaymentKopecks)}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`Ошибка: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
