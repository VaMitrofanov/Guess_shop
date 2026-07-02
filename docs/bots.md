# Боты (Telegram + VK)

Оба бота — отдельные процессы. Воркфлоу идентичен. VK шлёт уведомления менеджерам через
Telegram (`bots/shared/notify.ts` → `tgSend` → `ADMIN_IDS`).

## Общее

- `bots/shared/admin.ts` — карточки заказов/отзывов, объект `CB` со всеми `callback_data`.
- `bots/shared/roblox.ts` — валидация геймпасса. Богаче, чем `src/lib/roblox.ts`: возвращает
  `validationSkipped`, `isNotInCatalog`, `isGamePrivate`, `isAgeRestricted`, managed-pricing.
- `bots/shared/gamepass-search.ts` — `searchGamepassesByNick` → union `user_not_found /
  no_gamepasses / ok`.
- Сессии — **in-memory** (`session.ts`): `pendingLink`, `pendingRobloxNick`,
  `pendingDirectFlow`, `pendingNickEdit`, `pendingReview`, `pendingPaymentScreenshot` и т.д.
  После рестарта восстанавливаются из БД (см. ниже).

## TG-бот — `bots/tg/handlers.ts`

Регистрация: `registerStart`, `registerStatus`, `registerText`, `registerPhoto`,
`registerAdmin`, `registerCallbacks`, `registerChatMember` + admin-хабы (`admin/index.ts`).

### Активация (`bot.start`)
- Парсит `wbg_`/`wb_` payload (код + sessionId + guide-флаг).
- Rate-limit: 5 стартов / мин на sessionId|tgId; дедуп дубля iOS-deep-link (`recentCodeStarts`).
- Без кода → приветствие по статусу клиента: активный `AWAITING_GAMEPASS` → персональная
  инструкция; активный заказ → статус; вернувшийся → апселл прямых заказов; новый → подписка.
- С кодом → provisional TX (claim + `AWAITING_GAMEPASS`) → админ-уведомление → гейт подписки
  (опц.) → инструкция или one-tap подтверждение.

### Текстовый роутер (`registerText` / `bot.on("text")`)
Приоритеты: reply-keyboard кнопки → админ-режимы (reject-reason, payment-details) →
ввод ника → прямой заказ (сумма/ник) → редактирование ника → восстановление сессии из БД
(`AWAITING_GAMEPASS`) → прямой ввод WB-кода → REJECTED-заказ (resubmit) → идл.
Ник-подобный текст в активной сессии уходит в поиск по нику, а не в ошибку формата.

### Приём геймпасса (`processGamepassSubmission`)
`getGamepassDetails` → ветки ошибок с конкретными подсказками:
- не найден / черновик → поддержка;
- не в каталоге (закрытая игра) → как открыть Public;
- private-игра → инструкция открытия;
- не на продаже → включить On Sale;
- неверная цена → детект **Managed pricing** (частая причина) + как отключить;
- Roblox недоступен → принять `validationSkipped`, алерт админам о ручной проверке.

Финальная транзакция атомарна: claim кода (`updateMany` с OR-guard на RESERVED/null/provisional)
+ промоушен/создание `WbOrder → PENDING`. `COMPLETED` — единственный терминальный блок.

### Прямые заказы (без WB-кода)
`startDirectFlow` → выбор пакета (`buildPackKb`, бонусы/скидки) → подтверждение → ник →
поиск геймпасса → submit. Код заказа — синтетический `DIR-…` (нет `WbCode`).
`orderSource = DIRECT`.

### Поддержка, отзывы, напоминания
- Отзыв: `registerPhoto` (фото-пруф) → `sendAdminReviewCard` → `review_ok` (+100 R$) / `review_no`.
- `crons.ts`: напоминание об отзыве (через час, эскалация по расписанию), алерт о стоке
  WB-кодов (каждые 30 мин), напоминание по `AWAITING_GAMEPASS` (каждые 2 часа).

### Admin-хаб (`bots/tg/admin/`)
`hub-orders`, `hub-stats`, `hub-wildberries` (WB API), `hub-system` (health сервисов),
`hub-rates`, `hub-autobuy`. Health-URL ботов берётся из env (`*_BOT_HEALTH_URL`).

## VK-бот — `bots/vk/handlers.ts`

Паритет с TG. Отличия:

- **Support-pause.** После нажатия «Поддержка» / ответа менеджера из сообщества — пауза 30 мин,
  которая раньше молча дропала ВСЕ входящие. Теперь **пропускает сообщения с `payload.command`**
  (нажатия inline-кнопок — осознанное действие) и фото-пруфы. Свободный текст менеджеру — молчит.
- **Лимит inline-клавиатуры VK — 10 кнопок.** `buildVkPackKb` использует 8 пакетов
  (`VK_PACKS = [100,200,300,500,800,1000,1500,2000]`); «✏️ Своё» и «❌» — в одной строке.
  С reorder-кнопкой: 7 пакетов + reorder + ✏️ + ❌ = 10. Превышение → VK error 911, бот молчал.
- **Восстановление состояния** (`tryRestoreState`): `WbCode(userId, no order)` →
  `WbOrder(AWAITING_GAMEPASS)` → `WbOrder(REJECTED)`.
- `handleRefActivation` — точка входа с `ref=КОД` (или `GD+КОД` → guide-режим).
- `message_new` в `bot.ts` имеет catch-reply: при необработанной ошибке юзер получает
  «⚠️ Произошла ошибка» вместо молчания.

## Уведомления — кто и когда

**Клиент:** provisional-заказ (приветствие+цена), геймпасс принят (`PENDING`), `COMPLETED`
(+CTA отзыв), `REJECTED` (причина + «исправить ссылку»), `review_ok` (+100 R$ + «заказать ещё»).

**Админы (TG):** provisional-заказ (карточка `sendAdminOrderCard` с [✅ ВЫКУПЛЕНО][❌ ОШИБКА]),
VK-логин с кодом / без, fail валидации геймпасса, нажатие поддержки, фото отзыва.
