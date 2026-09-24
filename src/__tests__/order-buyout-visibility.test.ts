import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Заказ обязан сам говорить, выкуплен он или нет.
 *
 * 08.09.2026, разбор 49ANALQ. Заказ был выкуплен пятого числа, алерт поддержки
 * так и написал — а карточка того же заказа, открытая кнопкой из этого алерта,
 * показывала «WB DBS · 6д 2ч» и ни слова о выкупе. Причина у всех трёх мест
 * одна: карточка спрашивала ВКЛАДКУ, на которой стоит, вместо СОСТОЯНИЯ заказа.
 * У найденной поиском карточки вкладки под собой нет.
 *
 * Правила закреплены по исходнику: каждое возвращается одной строкой.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const screen = read("src/app/twa/_components/screens/OrdersScreen.tsx");
const searchRoute = read("src/app/api/twa/search/route.ts");
const workflow = read("src/lib/wb-delivery-workflow.ts");
const deliveryScreen = read("src/app/twa/_components/screens/WbDeliveryScreen.tsx");
const deliveryDesktop = read("src/components/admin/wb-delivery-client.tsx");
const deliveryRoute = read("src/lib/wb-delivery-route.ts");

describe("Найденная карточка говорит о состоянии, а не о вкладке", () => {
  it("одиночная карточка помечена `solo` — ей нечего договаривать окружением", () => {
    expect(screen).toContain("currentTab={orderToTab(allOrders[0])}\n                solo");
  });

  it("бейдж состояния показывается всегда, когда карточка стоит одна", () => {
    expect(screen).toContain("const tabBadge = solo || currentTab === \"ALL\"");
  });

  it("строка «Выкуп: …» не исчезает вместе с заголовком аккордеона", () => {
    expect(screen).toContain("order.status === \"COMPLETED\" && (currentTab !== \"DONE\" || solo)");
  });

  it("у закрытого заказа на месте возраста стоит дата выкупа", () => {
    expect(screen).toContain("const boughtAt = order.status === \"COMPLETED\" ? order.completedAt : null;");
    expect(screen).toContain("{boughtAt ? fmtTxDate(boughtAt) : fmtAge(timeRef)}");
  });

  it("«вручную» уступает имени того, кто закрыл заказ", () => {
    expect(screen).toContain("const boughtBy = order.purchaserUsername ?? order.completedBy ?? null;");
    expect(screen).toContain("выкуп: {boughtBy ?? \"вручную\"}");
  });

  it("«Готово» группируется по моменту выкупа, а не по последнему касанию", () => {
    // `updatedAt` двигает любая правка — заметка, избранное, заморозка.
    expect(screen).toContain("const doneAt = (o: Order) => new Date(o.completedAt ?? o.updatedAt).getTime();");
    expect(screen).toContain("const key = o.purchaserUsername ?? o.completedBy ?? \"Ручные\";");
  });
});

describe("Строка WB Доставки в поиске не выдаёт отмену за выдачу", () => {
  it("отменённый и завершённый — разные состояния, а не общий «закрыт»", () => {
    expect(searchRoute).not.toContain("closed: Boolean(order.completedAt || order.cancelledAt)");
    expect(searchRoute).toContain("state: order.cancelledAt ? \"cancelled\" : order.completedAt ? \"closed\" : \"open\"");
  });

  it("состояние второй половины жизни берётся у заказа на выкуп", () => {
    expect(searchRoute).toContain("WB_FUNNEL_LABEL[wbFunnelStep({");
  });

  it("сырой supplierStatus наружу не течёт", () => {
    expect(searchRoute).not.toContain("` · ${order.supplierStatus}`");
  });
});

describe("Заказ DBS достижим и после закрытия", () => {
  it("окно консоли держит самые СВЕЖИЕ закрытые заказы, а не самые старые", () => {
    expect(workflow).toContain("orderBy: [{ completedAt: { sort: \"desc\", nulls: \"first\" } }, { updatedAt: \"desc\" }]");
  });

  it("поиск идёт по всей таблице, а не по загруженному окну", () => {
    expect(workflow).toContain("export async function searchWbDeliveryOrders");
    expect(deliveryRoute).toContain("await searchWbDeliveryOrders(query)");
    expect(deliveryScreen).toContain("/api/twa/wb-delivery?q=${encodeURIComponent(needle)}");
    expect(deliveryDesktop).toContain("/api/admin/wb-delivery?q=${encodeURIComponent(needle)}");
  });

  it("отменённые заказы обзор прячет, но поиск обязан их находить", () => {
    const search = workflow.slice(workflow.indexOf("export async function searchWbDeliveryOrders"));
    const body = search.slice(0, search.indexOf("async function loadOrders"));
    expect(body).not.toContain("cancelledAt: null");
  });

  it("открытый заказ живёт отдельным DTO — найденного может не быть в окне", () => {
    expect(deliveryScreen).toContain("detail?.id === selectedId ? detail :");
    expect(deliveryDesktop).toContain("(detail?.id === selectedId ? detail : null)");
  });
});
