-- Отметка присутствия админа — фундамент «Пока вас не было» на «Обзоре».
--
-- Экран смены должен отвечать не только «что делать сейчас», но и «что
-- случилось, пока меня не было». Админов трое, и общее окно «за 24 часа» на
-- этот вопрос не отвечает: один заходил час назад, другой — позавчера.
--
-- Ключ — Telegram ID из ADMIN_IDS: тот же идентификатор, под которым пишутся
-- все действия админа. Второй список админов не заводим (правило этапа A1).
CREATE TABLE "AdminPresence" (
    "telegramId"     TEXT NOT NULL,
    "displayName"    TEXT,
    -- Последний удар пульса: двигается на каждой загрузке «Обзора».
    "lastSeenAt"     TIMESTAMP(3) NOT NULL,
    -- Начало окна дифа. НЕ двигается, пока админ сидит на месте: три обновления
    -- страницы подряд иначе схлопнули бы окно в минуту и съели весь диф.
    -- Сдвигается только после перерыва (см. ADMIN_AWAY_GAP_MINUTES).
    "windowStartAt"  TIMESTAMP(3) NOT NULL,
    -- Заказ, который админ разбирает прямо сейчас. Пока только пишется;
    -- на нём вырастет защита от двойного выкупа при трёх админах.
    "currentOrderId" TEXT,
    "currentOrderAt" TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminPresence_pkey" PRIMARY KEY ("telegramId")
);

CREATE INDEX "AdminPresence_lastSeenAt_idx" ON "AdminPresence"("lastSeenAt");
