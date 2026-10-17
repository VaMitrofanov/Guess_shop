import { readFileSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..");
const route = readFileSync(path.join(ROOT, "src/app/api/twa/orders/route.ts"), "utf8");
const screen = readFileSync(path.join(ROOT, "src/app/twa/_components/screens/OrdersScreen.tsx"), "utf8");
const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
const deskDialog = readFileSync(path.join(ROOT, "src/components/admin/orders/split-dialog.tsx"), "utf8");
const deskWorkspace = readFileSync(path.join(ROOT, "src/components/admin/orders/orders-workspace.tsx"), "utf8");
const deskDossier = readFileSync(path.join(ROOT, "src/components/admin/orders/order-dossier.tsx"), "utf8");

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

  /* ── Привязка не зависит от браузера выкупа ───────────────────────────────
     03.09.2026: заказ на 2000 не разбивался вовсе — `set-gamepass-split`
     спрашивал пасс только у серверного браузера, а тот лежал, и операция
     падала с «Браузерный сервис выкупа недоступен». Разбиение не тратит
     робуксы: оно записывает, чем закрывается заказ. Ронять его из-за упавшего
     браузера — терять работу админа, ничего не выигрывая в безопасности.
     ──────────────────────────────────────────────────────────────────────── */
  describe("привязка переживает упавший браузер выкупа", () => {
    it("у донора спрашивают первым, но не единственным", () => {
      expect(route).toContain("async function resolveGamepassForBinding(");
      const binding = route.slice(route.indexOf("async function resolveGamepassForBinding("));
      const body = binding.slice(0, 2600);
      expect(body).toContain("resolveGamepassForBuyer(gamepassId, cookie)");
      // Публичная карточка идёт через мост: с российского хоста прямой путь
      // до API Roblox не работает вовсе.
      expect(body).toContain("getGamepassById(gamepassId)");
    });

    it("у каждого источника есть бюджет — модалка не висит минуту", () => {
      // preflight браузера ждёт до 70 с; без бюджета лежащий браузер держал бы
      // разбиение на каждый уникальный пасс.
      expect(route).toContain("BINDING_DONOR_BUDGET_MS");
      expect(route).toContain("BINDING_PUBLIC_BUDGET_MS");
      expect(route).toContain("function withBudget<T>");
    });

    it("не ответил никто — разбиение всё равно записано, но со следом", () => {
      const handler = route.slice(route.indexOf('if (action === "set-gamepass-split")'));
      const block = handler.slice(0, 8000);
      expect(block).toContain("const unverified: string[] = []");
      expect(block).toContain("БЕЗ ПРОВЕРКИ");
      // И экран обязан сказать это вслух, а не показать обычное «готово».
      expect(block).toContain("warning: unverified.length");
      expect(screen).toContain("d?.warning");
      expect(deskDialog).toContain("data?.warning");
    });

    it("ответивший источник по-прежнему может ЗАПРЕТИТЬ разбиение", () => {
      // Деградация касается только молчания Roblox. Если пасс снят с продажи,
      // стоит не столько или принадлежит чужому нику — это отказ, как и был.
      const handler = route.slice(route.indexOf('if (action === "set-gamepass-split")'));
      const block = handler.slice(0, 6000);
      expect(block).toContain("не выставлен на продажу");
      expect(block).toContain("partPriceMatches(part, info.price, info.basePrice)");
      expect(block).toContain("sellerMatchesOrder(order.robloxUsername, info.sellerName)");
    });

    it("деньги стережёт покупка, а не привязка", () => {
      // Ровно то, что делает деградацию безопасной: перед списанием робуксов
      // цена и продавец проверяются заново.
      expect(route).toContain("checkGamepassPrice(guardAmount, price, base)");
      expect(route).toContain("sellerMatchesOrder(order.robloxUsername, creatorName)");
    });
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

  it("один пасс МОЖЕТ стоять в нескольких частях — уникальности в схеме нет", () => {
    // Заказ на 2000 при единственном выставленном пассе на 1000 закрывается
    // двумя одинаковыми частями с РАЗНЫХ доноров. Вернувшийся @@unique снова
    // сделал бы такой заказ неразбиваемым вовсе.
    expect(schema).not.toContain("@@unique([orderId, gamepassId])");
    // Но исполнение ручное, и модалка обязана об этом предупреждать.
    expect(screen).toContain("AlreadyOwned");
  });

  describe("разбиение на сайте", () => {
    it("лист есть и доступен из досье, клавиатуры и палитры", () => {
      expect(deskWorkspace).toContain("SplitDialog");
      expect(deskDossier).toContain("Разбить выкуп");
      // Клавиша S и команда палитры — иначе лист есть, но до него не дойти.
      expect(deskWorkspace).toContain('key === "s"');
      expect(deskWorkspace).toContain('command === "split"');
    });

    it("сохраняет тем же контрактом, что и телефон", () => {
      expect(deskDialog).toContain('action: "set-gamepass-split"');
      expect(deskDialog).toContain('action: "split-candidates"');
      expect(deskDialog).toContain('action: "clear-gamepass-split"');
      // Сумма обязана сойтись и частей должно быть от двух — те же ворота.
      expect(deskDialog).toContain("picked.length >= 2 && diff === 0");
    });

    it("подбор идёт через общее правило, а не своей арифметикой", () => {
      // Вторая копия размена разошлась бы с сервером на первом же 802+499.
      expect(deskDialog).toContain("planSplitFor");
      expect(deskDialog).toContain("MAX_SPLIT_PARTS");
    });

    it("предупреждает про донора при повторе пасса", () => {
      expect(deskDialog).toContain("AlreadyOwned");
    });

    it("состав после частичного выкупа не редактируется", () => {
      expect(deskDialog).toContain("hasPurchased");
      expect(deskDialog).toContain("!hasPurchased && picked.length >= 2");
    });
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
