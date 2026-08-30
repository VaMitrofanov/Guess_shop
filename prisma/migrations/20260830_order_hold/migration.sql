-- Заморозка заказа — «не выкупать, но и не удалять».
--
-- «Ошибка» (status=ERROR) — рабочий статус: там лежат починимые заказы (рег.
-- цена, снятый с продажи пасс) и живут кнопки «Вернуть к выкупу» / «Повторить
-- выкуп». Заказ, который нельзя выкупать НИКОГДА, лежал в той же куче и
-- отличался только текстом заметки — одно нажатие возвращало его в очередь.
--
-- Заморозка — признак ПОВЕРХ статуса: заказ остаётся, где был, но физически
-- выключен из автовыкупа, очередей и ручной покупки.

-- Денормализация на заказе: рабочие вкладки и автовыкуп фильтруют по этому
-- полю на каждом запросе — джойн к OrderHold там был бы на горячем пути.
ALTER TABLE "WbOrder" ADD COLUMN "heldAt"     TIMESTAMP(3);
ALTER TABLE "WbOrder" ADD COLUMN "heldReason" TEXT;
ALTER TABLE "WbOrder" ADD COLUMN "heldBy"     TEXT;

CREATE INDEX "WbOrder_heldAt_idx" ON "WbOrder"("heldAt");

-- Источник истины. Ключ — КОД, а не id заказа: код выдаётся покупателю раньше,
-- чем бот создаёт заказ (случай 84CR7UZ — код на руках, заказа ещё нет).
-- Заморозка по id заставила бы ловить момент создания вручную; по коду она
-- ставится заранее и применяется к заказу сама, как только он появится.
CREATE TABLE "OrderHold" (
    "wbCode"     TEXT NOT NULL,
    "id"         TEXT NOT NULL,
    "reason"     TEXT NOT NULL,
    "createdBy"  TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Снятая заморозка не удаляется, а помечается: историю «кто и почему
    -- заморозил» затирать нельзя, ради неё всё и делалось.
    "releasedAt" TIMESTAMP(3),
    "releasedBy" TEXT,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderHold_wbCode_key" ON "OrderHold"("wbCode");
-- Крон-свип и алерт поддержки читают только активные (releasedAt IS NULL).
CREATE INDEX "OrderHold_releasedAt_idx" ON "OrderHold"("releasedAt");
