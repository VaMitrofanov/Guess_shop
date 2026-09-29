import { readFileSync } from "node:fs";
import path from "node:path";

/* Один заказ — одна ветка, и ни одного сообщения мимо неё.
 *
 * 05.09.2026, скрин владельца по DBS-заказу NGS22UR: под аккуратной живой
 * карточкой висели три сиротские строки — «🆕 Новый пользователь», «👤 Marina
 * Bushlanova», «🆔 VK ID: …». Ни кода, ни номера WB, ни ответа на карточку.
 *
 * Причина — `else if` в `src/auth.ts`: вход, УСПЕШНО свёрнутый в карточку DBS,
 * проваливался в ветку «просто вход на сайт» и слал её вместо ничего. Замысел
 * от 01.09.2026 («о заказе DBS говорит одна карточка») ломался ровно на том
 * пути, ради которого писался.
 *
 * Заодно закреплено, что остальные сообщения о заказе тоже знают свою ветку:
 * поддержка, подтверждённый выкуп, скрин оплаты и скрин отзыва. Все они знают
 * код заказа — и раньше все до одного уходили россыпью.
 */

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("Вход покупателя по DBS-заказу не порождает второго сообщения", () => {
  const auth = read("src/auth.ts");

  it("голая карточка входа не уходит, если шаг свёрнут в карточку DBS", () => {
    expect(auth).toContain("} else if (!foldedIntoDbsCard && shouldSendLoginNotif(vkId)) {");
  });

  it("личность покупателя уходит В карточку", () => {
    expect(auth).toContain('await noteDbsBuyerSignedIn(prisma, wbCode!, "VK", {');
    expect(auth).toContain("url: `https://vk.com/id${vkId}`,");
    expect(auth).toContain("isNew: isNewUser,");
  });
});

describe("Сообщения о заказе встают в его ветку", () => {
  const admin = read("bots/shared/admin.ts");

  it("обращение в поддержку — ответом на карточку заказа", () => {
    expect(admin).toContain("const roots = await orderThreadRoots(db, code);");
    expect(admin).toContain("tgSend(id, text, { reply_markup: reply_markup(id), ...replyToRoot(roots, id) })");
  });

  it("подтверждённый выкуп — туда же", () => {
    expect(admin).toContain("const roots = await orderThreadRoots(db, input.wbCode);");
  });

  it("скрины оплаты и отзыва — тоже шаги заказа, а не отдельная переписка", () => {
    expect(admin).toContain('"скрин оплаты",\n    await orderThreadRoots(db, code),');
    expect(admin).toContain('"скрин отзыва",\n    await orderThreadRoots(db, code),');
    expect(admin).toContain("const thread = replyToRoot(roots, id);");
  });

  it("«покупатель нашёлся сам» говорит на общем языке уведомлений", () => {
    for (const file of ["bots/tg/handlers.ts", "bots/vk/handlers.ts"]) {
      const source = read(file);
      expect(source).toContain('title: "покупатель нашёлся сам"');
      expect(source).toContain("tgSend(id, notice, replyToRoot(roots, id))");
    }
  });
});

describe("Карточка догоняет заказ на каждом громком шаге", () => {
  it("ссылка получена — карточку обновляют оба отправителя карточки выкупа", () => {
    expect(read("src/lib/admin-card.ts")).toContain('if (wbRef.source === "WB_DBS") await refreshDbsCardByCode(prisma, order.wbCode);');
    expect(read("bots/shared/admin.ts")).toContain('if (wbRef.source === "WB_DBS") await refreshDbsCardByCode(db, order.wbCode);');
  });

  it("выкуплен — и с сайта, и из кнопки в Telegram", () => {
    expect(read("src/lib/twa-notify.ts")).toContain("await refreshDbsCardByCode(prisma, order?.wbCode ?? null)");
    expect(read("bots/tg/handlers.ts")).toContain("await refreshDbsCardByCode(db, order.wbCode)");
  });
});
