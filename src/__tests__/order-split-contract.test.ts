import { readFileSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..");
const route = readFileSync(path.join(ROOT, "src/app/api/twa/orders/route.ts"), "utf8");
const screen = readFileSync(path.join(ROOT, "src/app/twa/_components/screens/OrdersScreen.tsx"), "utf8");
const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");

/**
 * Разбиение заменяет собой прайс-гард заказа, поэтому его контракт — это
 * контракт денег. Эти проверки держат ровно те места, где ошибка стоит робуксов.
 */
describe("контракт разбитого выкупа", () => {
  it("прайс-гард сверяется с номиналом ЧАСТИ, а не заказа", () => {
    // Сверка с order.amount означала бы, что пасс за 1429 никогда не пройдёт
    // в заказ на 3000 — то есть разбиение не работает вовсе.
    expect(route).toContain("checkGamepassPrice(guardAmount, price, base)");
    expect(route).toContain("const guardAmount = activePart ? activePart.amount : order.amount");
  });

  it("инвариант суммы перечитывается перед каждой покупкой, а не только при записи", () => {
    // Части могли отредактировать между привязкой и выкупом.
    expect(route).toContain("assertSplitCoversOrder(splitParts, order.amount)");
  });

  it("часть отмечается купленной ДО закрытия заказа", () => {
    // Робуксы уже списаны: упасть между покупкой и записью можно, и тогда
    // повторное нажатие обязано увидеть, что часть оплачена.
    const markIdx = route.indexOf("purchasedAt: new Date()");
    const completeIdx = route.indexOf('status: "COMPLETED", buyoutErrorCode: null, purchaseRate: currentRate, purchaserUsername');
    expect(markIdx).toBeGreaterThan(-1);
    expect(completeIdx).toBeGreaterThan(-1);
    expect(markIdx).toBeLessThan(completeIdx);
  });

  it("заказ закрывается только когда куплены все части", () => {
    expect(route).toContain("if (!splitIsComplete(fresh))");
    expect(route).toContain('status: "IN_PROGRESS"');
  });

  it("себестоимость считается по сумме списаний, а не по последнему", () => {
    expect(route).toContain("splitChargedTotal(");
    expect(route).toContain("buildOrderProfitSnapshot(order, settings ?? {}, totalCharged)");
  });

  it("автозамена при региональной цене ищет пасс под номинал части", () => {
    expect(route).toContain("findFullPriceReplacement(order, cookie, gpId, guardAmount)");
    // И не должна попасть в соседнюю часть того же заказа.
    expect(route).toContain("wbOrderGamepass.findMany");
  });

  it("состав нельзя менять после частичного выкупа", () => {
    expect(route).toContain("splitParts.some((p) => p.purchasedAt)");
  });

  it("карточка показывает прогресс, а кнопка называет номер части", () => {
    expect(screen).toContain("SplitPartsBlock");
    expect(screen).toContain("выкуплено");
    expect(screen).toContain("Выкупить часть ");
    // Промежуточный успех не должен читаться как «заказ закрыт».
    expect(screen).toContain("d.splitDone === false");
  });

  it("один пасс не может стоять в двух частях одного заказа", () => {
    expect(schema).toContain("@@unique([orderId, gamepassId])");
  });

  it("бейдж «цена ≠ номиналу» сверяет ТЕКУЩУЮ часть с её номиналом", () => {
    // Иначе на каждом разбитом заказе висела бы ложная тревога: пасс за
    // 1429 R$ в заказе на 3000 — это норма, а не расхождение.
    expect(route).toContain("const activePart = parts.find((p) => !p.purchasedAt) ?? null");
    expect(route).toContain("Math.ceil((activePart ? activePart.amount : o.amount) / 0.7)");
  });

  it("ручная отметка части НЕ уведомляет клиента", () => {
    const markStart = route.indexOf('if (action === "mark-split-part")');
    expect(markStart).toBeGreaterThan(-1);
    const markEnd = route.indexOf('if (action === "reject")', markStart);
    const markBlock = route.slice(markStart, markEnd > markStart ? markEnd : markStart + 4000);
    // Клиент получил не весь заказ — «заказ выполнен» было бы неправдой.
    expect(markBlock).not.toContain("notifyOrderCompleted");
  });

  it("уведомление клиенту шлёт только закрытие всего заказа", () => {
    const completeStart = route.indexOf('if (action === "complete")');
    const completeEnd = route.indexOf('if (action === "mark-split-part")', completeStart);
    expect(route.slice(completeStart, completeEnd)).toContain("notifyOrderCompleted");
  });

  it("ручное «Выкуплено» закрывает и оставшиеся части", () => {
    // Иначе карточка COMPLETED показывала бы «1/3» и вводила в заблуждение.
    expect(route).toContain('wbOrderGamepass.updateMany({\n            where: { orderId, purchasedAt: null }');
  });

  it("когда все части отмечены, кнопка выкупа не предлагает купить купленное", () => {
    expect(screen).toContain("splitAllDone");
    expect(screen).toContain("&& !splitAllDone");
  });

  it("карточка объясняет разницу между галочкой и «Выкуплено»", () => {
    expect(screen).toContain("клиенту ничего не уходит");
  });

  it("ID части копируется по тапу и подтверждает это", () => {
    // Выкуп идёт вставкой ID в донорский аккаунт — это действие совершают
    // на каждой части, поэтому тап по ID копирует, а не открывает Roblox.
    expect(screen).toContain("copyText(p.gamepassId)");
    expect(screen).toContain("скопирован");
  });
});
