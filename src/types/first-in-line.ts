/* ─────────────────────────────────────────────────────────────────────────────
   Вид блока «Первым делом». Лежит отдельно от `lib/first-in-line.ts`, потому
   что тот помечен `server-only`: обеим главным (сайт и TWA) нужен только тип,
   а не загрузчик с Prisma внутри.
   ───────────────────────────────────────────────────────────────────────── */

export interface FirstInLineOrder {
  id: string;
  wbCode: string;
  robloxUsername: string | null;
  /** Чистые робуксы клиенту. */
  amount: number;
  /** Грязные: столько спишется с выкупного аккаунта. */
  gross: number;
  lane: "WB" | "WB_DBS" | "DIRECT";
  status: string;
  /** С какого момента заказ стоит в очереди. */
  since: string;
  gamepassId: string | null;
  /** Почему он здесь: подняли руками или это прямой заказ. */
  reason: "pinned" | "direct";
}

export interface FirstInLine {
  rows: FirstInLineOrder[];
  /** Сколько всего таких заказов — строк может быть показано меньше. */
  total: number;
  pinned: number;
  direct: number;
  /** Грязные робуксы на все такие заказы: столько нужно прямо сейчас. */
  gross: number;
}
