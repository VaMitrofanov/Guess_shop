/**
 * 🔑 Админ вставляет ключ покупателя за него (`create-gamepass-by-key`).
 *
 * Владелец, 18.10.2026: «очень часто они кидают ключ нам, а не боту, проще
 * самим его вставить в заказ и сделать все за них». Ядро создания пассов уже
 * жило в проде (28 % заказов за 30 дней закрывались ключом) — новым был только
 * вход для админа. Тест сторожит то, что в этом входе легко потерять:
 *
 *  • гейты: заморозка, неоплаченный прямой, статус, рейт-лимит, флаг;
 *  • порядок после создания (решение владельца О1): сначала карточка НАМ —
 *    «убедиться, что реально создалось», — потом заказ и уже потом клиент;
 *  • ключ не возвращается наружу ни одним ответом.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { buildKeyCreatedAdminCard, passNeedsHands } from "@/lib/gamepass-key-admin-notify";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const route = read("src/app/api/twa/orders/route.ts");

/** Тело действия: от его `if` до следующего действия роута. */
const block = route.slice(
  route.indexOf('action === "create-gamepass-by-key"'),
  route.indexOf('action === "order-events"'),
);

describe("гейты действия", () => {
  it("действие существует и живёт в общем роуте админки", () => {
    expect(block.length).toBeGreaterThan(500);
    // `/api/admin/orders` реэкспортирует POST — обе админки получают действие
    // сразу, без второй двери к деньгам.
    expect(read("src/app/api/admin/orders/route.ts")).toContain('export { GET, POST } from "@/app/api/twa/orders/route"');
  });

  it("выключенный флаг автосоздания закрывает действие", () => {
    expect(block).toContain("gamepassAutocreateEnabled()");
  });

  it("❄️ заморозка запрещает — привязка ставит заказ в очередь выкупа", () => {
    expect(block).toContain("assertOrderNotHeld(prisma, orderId)");
  });

  it("неоплаченный прямой заказ до выкупа не доходит", () => {
    expect(block).toContain("UNPAID_DIR_ERROR");
  });

  it("статусы — те же, что у привязки геймпасса", () => {
    expect(block).toContain('const KEYABLE = ["AWAITING_GAMEPASS", "REJECTED", "ERROR", "PENDING"]');
  });

  it("рейт-лимит: каждый шаг ходит в Roblox через мост", () => {
    expect(block).toContain("rateLimit(`admin-key:");
  });

  it("выкупленную часть разбиения новыми пассами не перетирают", () => {
    expect(block).toContain("splitParts.some((p) => p.purchasedAt)");
  });

  it("замена уже привязанного пасса — только по явному флагу", () => {
    expect(block).toContain("body.replace !== true");
  });
});

describe("порядок шагов", () => {
  const at = (needle: string) => {
    const index = block.indexOf(needle);
    expect(index).toBeGreaterThan(-1);
    return index;
  };

  it("dryRun ничего не создаёт — возврат до создания пассов", () => {
    expect(at("body.dryRun === true")).toBeLessThan(at("createPassesWithKey("));
  });

  it("ключ сперва проверяется мостом, и только потом создаются пассы", () => {
    expect(at("verifyGamePassKeyViaBridge(")).toBeLessThan(at("createPassesWithKey("));
  });

  /* Решение владельца О1: «сначала уведомлять нас чтобы убедиться, что реально
     создалось, а затем формировать заказ и увед клиенту». */
  it("созданное проверяется у Roblox, карточка админам уходит ДО правки заказа", () => {
    expect(at("resolveGamepassForBinding(String(pass.gamePassId)")).toBeLessThan(at("notifyAdminsKeyCreated("));
    expect(at("notifyAdminsKeyCreated(")).toBeLessThan(at("notifyGamepassCreatedForBuyer("));
  });

  it("клиенту пишут последним и только по готовому заказу", () => {
    const buyer = at("notifyGamepassCreatedForBuyer(");
    expect(block.slice(buyer - 200, buyer)).toContain("complete");
  });

  it("неполный набор в очередь выкупа не ставится", () => {
    expect(block).toContain("const complete = outcome.created.length === targets.length");
    // `status: "PENDING"` стоит внутри ветки `complete`.
    const statusAt = at('status: "PENDING"');
    expect(block.slice(0, statusAt)).toContain("...(complete");
  });

  it("в ленте заказа видно, что ключ вводил менеджер", () => {
    expect(block).toContain('via: "admin-key"');
    expect(block).toContain("byAdmin: actor.displayName");
    expect(block).toContain("[КЛЮЧ-АДМИН");
  });

  it("ник из ответа Roblox ложится в заказ, если его не было", () => {
    expect(block).toContain("order.robloxUsername ? {} : { robloxUsername: confirmed }");
  });
});

describe("ключ не вытекает наружу", () => {
  /** Payload'ы всех ответов действия — ровно до закрывающей скобки вызова. */
  const responses = (() => {
    const out: string[] = [];
    let from = 0;
    for (;;) {
      const start = block.indexOf("NextResponse.json(", from);
      if (start === -1) break;
      let depth = 0;
      let end = start;
      for (let i = block.indexOf("(", start); i < block.length; i++) {
        if (block[i] === "(") depth++;
        else if (block[i] === ")") { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      out.push(block.slice(start, end));
      from = end;
    }
    return out;
  })();

  it("действие отвечает несколько раз — проверяем каждый ответ", () => {
    expect(responses.length).toBeGreaterThanOrEqual(6);
  });

  it("ни один ответ не отдаёт ключ", () => {
    for (const payload of responses) {
      // `key` как поле ответа запрещён; `keyUserId`/`keyLimit`/`keyCookie` —
      // служебные имена, они полем ответа не являются.
      expect(payload).not.toMatch(/[{,]\s*key[,:}]/);
    }
  });

  it("ключ не пишется в логи — в журнал уходит только код отказа", () => {
    const logs = block.match(/console\.(log|warn|error)\([\s\S]*?\);/g) ?? [];
    expect(logs.length).toBeGreaterThan(0);
    // В журнал уходит код отказа и код заказа — но не значение ключа.
    for (const line of logs) expect(line).not.toMatch(/\$\{\s*key[\s.}]|\bkey\s*\)/);
  });
});

describe("карточка админам «реально ли создалось»", () => {
  const base = {
    wbCode: "VGAA3F2",
    amount: 1000,
    nick: "lox23_limon",
    adminName: "Дью",
    attached: true,
  };

  it("называет каждый пасс и то, что про него сказал Roblox", () => {
    const text = buildKeyCreatedAdminCard({
      ...base,
      passes: [{ gamepassId: "123", price: 1429, live: { price: 1429, isForSale: true } }],
    });
    expect(text).toContain("<code>123</code>");
    expect(text).toContain("1429 R$");
    expect(text).toContain("✅ в продаже, цена сходится");
    expect(text).toContain("🔵");
  });

  it("пасс не в продаже — это требует рук, а не «всё хорошо»", () => {
    const pass = { gamepassId: "123", price: 1429, live: { price: 1429, isForSale: false } };
    expect(passNeedsHands(pass)).toBe(true);
    const text = buildKeyCreatedAdminCard({ ...base, passes: [pass] });
    expect(text).toContain("НЕ в продаже");
    expect(text).toContain("🟠");
  });

  it("другая цена — тоже руки: выкуп такой пасс не возьмёт", () => {
    const pass = { gamepassId: "123", price: 1429, live: { price: 100, isForSale: true } };
    expect(passNeedsHands(pass)).toBe(true);
    expect(buildKeyCreatedAdminCard({ ...base, passes: [pass] })).toContain("цена 100 R$ вместо 1429 R$");
  });

  it("молчание Roblox не выдаётся за успех", () => {
    const pass = { gamepassId: "123", price: 1429, live: null };
    expect(passNeedsHands(pass)).toBe(true);
    expect(buildKeyCreatedAdminCard({ ...base, passes: [pass] })).toContain("Roblox не ответил");
  });

  it("неполный набор видно в карточке", () => {
    const text = buildKeyCreatedAdminCard({
      ...base,
      attached: false,
      error: "bad_scope",
      passes: [{ gamepassId: "123", price: 1429, live: { price: 1429, isForSale: true } }],
    });
    expect(text).toContain("создан не полностью");
    expect(text).toContain("НЕ привязываем");
    expect(text).toContain("привяжи руками");
  });

  it("ключа в карточке нет ни при каком исходе", () => {
    const text = buildKeyCreatedAdminCard({
      ...base,
      passes: [{ gamepassId: "123", price: 1429, live: null }],
    });
    expect(text.toLowerCase()).not.toContain("ключ покупателя:");
    expect(text).toContain("ключ вставил админ");
  });
});

describe("что получает покупатель", () => {
  const notify = read("src/lib/twa-notify.ts");
  const text = notify.slice(notify.indexOf("notifyGamepassCreatedForBuyer"), notify.indexOf("export async function notifyOrderRejected"));

  it("ему говорят, что делать больше ничего не нужно", () => {
    expect(text).toContain("ничего не нужно");
    expect(text).toContain("Сделали за тебя");
  });

  it("называет аккаунт, на котором создан пасс", () => {
    expect(text).toContain("opts.nick");
  });

  it("VK получает тот же текст без HTML", () => {
    expect(text).toContain('replace(/<[^>]+>/g, "")');
  });
});

describe("интерфейс — обе админки", () => {
  it("сайт: блок ключа в досье заказа", () => {
    const dossier = read("src/components/admin/orders/order-dossier.tsx");
    expect(dossier).toContain("KeyCreateBox");
    expect(dossier).toContain('action: "create-gamepass-by-key"');
    // Поле ключа — password и без автозаполнения: экран админки шарят.
    expect(dossier).toContain('type="password"');
    expect(dossier).toContain('autoComplete="off"');
    // Блок виден только там, где действие вообще разрешено.
    expect(dossier).toContain("!order.heldAt && KEYABLE.includes(order.status)");
  });

  it("TWA: форма ключа в карточке заказа", () => {
    const twa = read("src/app/twa/_components/screens/OrdersScreen.tsx");
    expect(twa).toContain("KeyCreateForm");
    expect(twa).toContain('action: "create-gamepass-by-key"');
    expect(twa).toContain('type="password"');
    expect(twa).toContain("canKey={isKeyable}");
  });

  it("оба интерфейса сначала проверяют ключ, а потом создают", () => {
    for (const file of ["src/components/admin/orders/order-dossier.tsx", "src/app/twa/_components/screens/OrdersScreen.tsx"]) {
      const source = read(file);
      expect(source).toContain("dryRun: true");
      expect(source).toContain("Проверить ключ");
      expect(source).toContain("Создать и привязать");
    }
  });
});
