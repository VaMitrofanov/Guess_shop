/* ─────────────────────────────────────────────────────────────────────────────
   Заказ на выкуп по DBS-коду — одна запись для консоли DBS и для бота (31.10.2026).

   Раньше заказ из DBS-кода рождался только кнопкой «Создать заказ на выкуп
   вручную» (src/lib/wb-delivery-workflow.ts). Покупатель без Telegram и VK,
   приславший пасс в чат WB, оставался без заказа: бот не умел его создать, а
   оператор думал, что бот подхватит пасс сам (PXGLH7F, 30.10). Теперь оба пути
   пишут заказ одной функцией — расхождений «как создала консоль» и «как создал
   бот» быть не может.

   Проверки (цена, продажа, дубль пасса, заморозка, отмена) — на стороне
   вызывающего: у консоли есть «создать принудительно», у бота — нет.
   ───────────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface DbsBuyoutOrderInput {
  activationCode: string;
  wbCodeId: string;
  /** Владелец кода, если покупатель его уже активировал; иначе служебный аккаунт. */
  wbCodeUserId: string | null;
  denomination: number;
  saleAmountKopecks: number | null;
  gamepassId: string;
  gamepassUrl: string;
  nick: string | null;
  adminNote: string;
}

export interface DbsBuyoutOrderRow {
  id: string;
  amount: number;
  status: string;
  platform: string;
  orderSource: string | null;
  wbCode: string;
  userId: string;
  createdAt: Date;
}

/** Создать заказ в «К выкупу» и погасить код — одной транзакцией. */
export async function createDbsBuyoutOrder(db: Db, input: DbsBuyoutOrderInput): Promise<DbsBuyoutOrderRow> {
  return db.$transaction(async (tx: Db) => {
    const wbOrder = await tx.wbOrder.create({
      data: {
        amount: input.denomination,
        gamepassUrl: input.gamepassUrl,
        gamepassId: input.gamepassId,
        robloxUsername: input.nick,
        status: "PENDING",
        // Покупатель говорил с нами в чате WB, а не в нашем мессенджере; TG —
        // платформа, на которой живут все служебные заказы.
        platform: "TG",
        wbCode: input.activationCode,
        orderSource: "WB_DBS",
        adminNote: input.adminNote,
        pendingAt: new Date(),
        saleAmountKopecks: input.saleAmountKopecks ?? undefined,
        user: input.wbCodeUserId
          ? { connect: { id: input.wbCodeUserId } }
          : { connectOrCreate: { where: { tgId: "admin" }, create: { tgId: "admin", name: "Admin (DBS)" } } },
      },
      select: { id: true, amount: true, status: true, platform: true, orderSource: true, wbCode: true, userId: true, createdAt: true },
    });
    // Как при настоящей активации: код погашен и второй раз не предъявляется.
    await tx.wbCode.update({
      where: { id: input.wbCodeId },
      data: {
        isUsed: true,
        status: "CLAIMED",
        usedAt: new Date(),
        ...(input.nick ? { robloxNick: input.nick } : {}),
        selectedGamepassId: input.gamepassId,
      },
    });
    return wbOrder;
  });
}
