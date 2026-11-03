/* ─────────────────────────────────────────────────────────────────────────────
   Правила пачечного выкупа, общие для TWA и веб-админки.

   Сама покупка целиком серверная (`POST /api/twa/orders` → `action: "purchase"`
   со всеми гардами: [ЦЕНА-СТОП], [ПРОДАВЕЦ-СТОП], замена при рег-цене). Клиент
   только гоняет очередь и решает, когда остановиться — и вот эти два решения
   обязаны совпадать на обеих поверхностях, иначе один экран продолжит жечь
   баланс там, где другой уже встал.
   ───────────────────────────────────────────────────────────────────────── */

/** Одна строка отчёта пачки — формат совпадает с `PurchaseBatch.items`. */
export interface BatchItem {
  orderId: string;
  nick: string;
  wbCode: string;
  /** Грязные R$, списанные (или которые списались бы) за этот заказ. */
  gross: number;
  ok: boolean;
  reason?: string;
}

/**
 * Причины, после которых продолжать пачку бессмысленно или опасно: кончился
 * баланс, протух cookie/CSRF, занят серверный браузер. Всё остальное —
 * проблема конкретного заказа, очередь едет дальше.
 */
export const BULK_STOP_RE =
  /баланс|insufficient|not enough|истёк|expired|csrf|cookie|браузер занят|BROWSER_BUSY|QueueFull/i;

export const shouldStopBatch = (reason: unknown): boolean =>
  BULK_STOP_RE.test(String(reason ?? ""));

/**
 * Пауза между покупками со случайным разбросом: ровный ритм запросов с одного
 * аккаунта Roblox читается как бот.
 */
export const bulkPause = (): number => 2000 + Math.floor(Math.random() * 6000);

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Цена геймпасса, которую ожидает прайс-гард: комиссия Roblox 30%. */
export const expectedGross = (amount: number): number => Math.ceil(amount / 0.7);
