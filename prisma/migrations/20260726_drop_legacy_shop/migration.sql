-- U13: удаление legacy-слоя магазина. Вынесено в ОТДЕЛЬНУЮ миграцию и
-- применяется ПОСЛЕ выкатки кода: пока в проде крутится старая сборка, её
-- страница ЛК ещё читает `prisma.order`, и удаление таблицы до деплоя уронило
-- бы личный кабинет.
-- U13: удаление legacy-слоя магазина. Проверено на проде 26.07:
-- `SELECT count(*) FROM "Order"` = 0, `FROM "Product"` = 0 — данных нет.
-- Обслуживавшие их роуты удалены; два из них (`/api/bot/update-order`,
-- `/api/orders/webhook-to-automation`) всегда отвечали 401, потому что
-- `BOT_API_TOKEN` и `INTERNAL_WEBHOOK_SECRET` отсутствуют в рабочем окружении.
DROP TABLE IF EXISTS "Order";
DROP TABLE IF EXISTS "Product";
DROP TYPE IF EXISTS "OrderStatus";
