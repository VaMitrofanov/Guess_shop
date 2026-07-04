# Боты (Telegram + VK)

Оба бота — отдельные процессы. Воркфлоу идентичен. VK шлёт уведомления менеджерам через
Telegram (`bots/shared/notify.ts` → `tgSend` → `ADMIN_IDS`).

## Общее

- `bots/shared/admin.ts` — карточки заказов/отзывов, объект `CB` со всеми `callback_data`.
  **Идентификатор в карточках и сообщениях — код заказа** (ВБ / `DIR-…` / `AV-…`), внутренние
  номера `#SHORTID` убраны везде (решение владельца, вариант C2, 2026-07-03). Клиент видит
  код ВБ или «заказ на N R$»; заявки (intents) кода не имеют — идентифицируются `ник · сумма`.
  TWA-диплинк из карточек — `?q=<код>`.
- `bots/shared/nick.ts` — `noteProbableNick`: ранний захват ника Roblox в `adminNote`
  заказа (`[НИК? дата] ник (источник)`), веб-зеркало — `src/lib/capture-nick.ts`. Вероятный
  ник **не** пишется в `robloxUsername` (юзер мог опечататься) — основное поле заполняют
  только подтверждённые пути (успешная валидация геймпасса, one-tap, менеджер).
- `bots/shared/roblox.ts` — валидация геймпасса. Богаче, чем `src/lib/roblox.ts`: возвращает
  `validationSkipped`, `isNotInCatalog`, `isGamePrivate`, `isAgeRestricted`, managed-pricing.
- `bots/shared/gamepass-search.ts` — `searchGamepassesByNick` → union `user_not_found /
  no_gamepasses / ok`. Поиск: до 150 публичных игр (cursor-pagination, limit=50 × 3 стр),
  до 100 геймпассов на игру. Фильтр `isForSale !== false` (не strict `=== true`).
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
- С кодом → provisional TX (claim + `AWAITING_GAMEPASS`, предзаполнение `robloxUsername`
  если returning user) → админ-уведомление → гейт подписки (опц.) → инструкция или one-tap.
  Returning user с сохранённым ником видит `🎮 Ник: X` и кнопку `✅ Найти у X` (auto-search).

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

**Идемпотентность повторной отправки (фикс «двойных карточек», 2026-07-03, оба бота):**
- тот же геймпасс на заказ в `PENDING`/`IN_PROGRESS` → no-op в транзакции: без пере-PENDING,
  без второй админ-карточки; клиенту — «✅ Этот геймпасс уже принят» (кейс J2XVS0: one-tap
  с сайта + отправка того же пасса в бот минутой позже);
- **другая** ссылка на заказ в обработке (клиент передумал) → апдейт как раньше, но карточка
  идёт с маркером `🔁 ЗАМЕНА ГЕЙМПАССА (было: <passId>)` (`replacedGamepassUrl` в
  `sendAdminOrderCard`) — менеджер видит, что это не новый заказ;
- `previousOrderCount` («ПОВТОРНЫЙ КЛИЕНТ») исключает сам текущий заказ (`wbCode != текущий`)
  — раньше свежепромоутнутый сайтом заказ считал сам себя и давал ложный бейдж; тот же фикс
  в `renderExtendedCard` admin-хаба (`id != order.id`).

**Ранний захват ника** (`noteProbableNick`): при вводе ника в поиск (все ветки кроме
`user_not_found`) и в fail-ветках валидации геймпасса (`creatorName` от Roblox) ник
дописывается в `adminNote` заказа — менеджер может привязать геймпасс из TWA, не дожидаясь
клиента.

### Прямые заказы (без WB-кода)
`startDirectFlow` → выбор пакета (`buildPackKb`, бонусы/скидки) → подтверждение → ник →
поиск геймпасса → выбор из списка (или автопропуск при ровно одном совпадении по цене) →
итог → submit (создаётся `DirectIntent`; заказ `WbOrder` появляется, когда менеджер шлёт
QR/реквизиты). Код заказа — синтетический `DIR-…` (нет `WbCode`). `orderSource = DIRECT`.

**Фикс 2026-07-04 — шаг выбора геймпасса был мёртв (оба бота).** Результаты
`searchGamepassesByNick` имеют поле `gamepassId` (тип `GamepassSearchResult`), а детали
`getGamepassDetails` — поле `price` (тип `GamepassDetails`). Прямой заказ читал
несуществующие `g.id` / `gpDetails.robux` → кнопки несли `dgp:undefined`, и любой выбор
(в т.ч. верного геймпасса) падал в «Геймпасс не найден»; автопропуск не срабатывал.
Сломано с 2026-06-29 (`ca34e25`/`203111b` — шаг выбора родился с неверными полями);
WB-коридор не был задет (его `gp_pick` использует правильное `m.gamepassId`).
Заодно: (1) ник пишется в `User.robloxUsername` только после того, как поиск подтвердил
существование юзера на Roblox (раньше — до, опечатка затирала валидный ник);
(2) карточка заявки показывает **фактическую** цену выбранного геймпасса
(`gamepassRobux` в `DirectIntentCardPayload`) с маркером `⚠️ ожидалось N R$` при
расхождении — раньше всегда печаталась расчётная `ceil(totalAmount/0.7)`.

### Поддержка, отзывы, напоминания
- Отзыв: `registerPhoto` (фото-пруф) → `sendAdminReviewCard` → `review_ok` (+100 R$) / `review_no`.
- `crons.ts`: напоминание об отзыве (через час, эскалация по расписанию), алерт о стоке
  WB-кодов (каждые 30 мин), напоминание по `AWAITING_GAMEPASS` (каждые 2 часа).

### Admin-хаб (`bots/tg/admin/`)
`hub-orders`, `hub-stats`, `hub-wildberries` (WB API), `hub-system` (health сервисов),
`hub-rates`, `hub-autobuy`. Health-URL ботов берётся из env (`*_BOT_HEALTH_URL`).
⚠️ Эти `hub-*` **осиротели** — вся админ-UI живёт в TWA (кнопка Launch Dashboard); из
`hub-*` живы только фоновые мониторы (`registerAdminHubs`). Управление новыми фичами —
командами бота (см. ниже), не хабами.

### Фоновые воркеры (`bots/tg/auto-workers.ts`, старт из `crons.ts` → `startAutoWorkers`)

Оба kill-switch по умолчанию **OFF** (в `GlobalSettings`), включает владелец командой.

- **🤖 Автовыкуп до порога слива (+1).** Тик 60 с. Пока `autoBuyoutEnabled=true` и баланс
  донора > `autoBuyoutThreshold`, берёт новые `PENDING`-заказы (`isTest=false`, по `pendingAt`,
  ≤ `autoBuyoutMaxPerTick` за тик) и выкупает донорским cookie
  (`purchaseGamepassDirect` — та же механика, что ручной выкуп в TWA). Защиты: **атомарный
  claim** `PENDING→IN_PROGRESS` (нет гонки с ручным выкупом в TWA), проверка цены
  `= ceil(amount/0.7) ±2` + `isForSale` + совпадение продавца с ником (если ник подтверждён);
  несоответствие → `[AUTOBUY-SKIP …]` в adminNote, заказ не трогаем. Успех → `COMPLETED`
  (+`purchaserUsername`) + штатное клиентское уведомление + алерт админам. Провал → откат в
  `PENDING`, `[AUTOBUY-FAIL …]`, алерт; протухший cookie / 3 провала подряд → пауза 15 мин +
  алерт (сам флаг не снимается). Достигли порога → обязательный алерт «💧 пора сливать»
  (дедуп 6 ч через `autoBuyoutBelowSince`); сам слив остаётся ручным (💧 в TWA). Управление:
  `/autobuy` (статус), `/autobuy on|off`, `/autobuy threshold N`.
- **👁 GP-watch по вероятному нику (+3).** Тик 15 мин. Для заказов `AWAITING_GAMEPASS` с
  `probableNick` (см. «Ранний захват ника») и без `robloxUsername`, младше 30 дней, ищет
  `searchGamepassesByNick` геймпасс с ценой `±2`. Нашёл (и это не тот же `gpWatchNotifiedPassId`)
  → действует по режиму **`GlobalSettings.gpWatchNotify`** (`admin`/`customer`/`both`,
  default `both`):
  - `customer|both`: клиенту «🎉 Похоже, твой геймпасс готов!» с кнопками
    **✅ Да, это мой / ❌ Не мой ник** (TG callback `gpw_ok:/gpw_no:`, VK payload `gpw_ok/gpw_no`);
  - `admin|both`: алерт менеджерам «👁 GP-watch: нашёл геймпасс…» (код, ник, пасс, цена,
    статус клиентского пинга) — до 04.07 воркер работал молча для менеджера, и включённый
    `/gpwatch on` выглядел как «ничего не сработало».
  **Fail-safe доставки:** `vkSend` читает ответ VK API (error 901 «юзер не писал сообществу»
  раньше терял пинг молча); недоставленный пинг откатывает `gpWatchNotifiedPassId` → ретрай
  следующим тиком + алерт. Троттлинг: <3 дней — каждый тик,
  дальше раз в 2 ч (`gpWatchLastCheckAt`); лимит 20 проверок/тик. Подтверждение
  (`bots/shared/gp-watch-confirm.ts`, общий для TG+VK): ре-валидация → заказ `PENDING`,
  `robloxUsername = probableNick` (теперь подтверждён), карточка «👁 GP-WATCH подтверждён»
  админам; дальше подхватывает автовыкуп/менеджер. Отказ → `probableNick=null` +
  `[НИК-ОТКАЗ …]`. Управление: `/gpwatch` (статус: режим, наблюдаемые, «ждём ✅», последний
  тик), `/gpwatch on|off`, `/gpwatch mode admin|customer|both`. Ручной пинг тем же текстом —
  кнопка «👁 Найти ГП по нику и оповестить» в TWA-карточке (см. docs/twa-admin.md).

### Ранний захват ника → `probableNick` (структурно) + `adminNote` (история)
`bots/shared/nick.ts` (`noteProbableNick`) и `src/lib/capture-nick.ts` пишут вероятный ник
в **`WbOrder.probableNick`** (структурно, для GP-watch — «последний побеждает») **и** строкой
`[НИК? дата] ник (источник)` в `adminNote` (история). В `robloxUsername` — по-прежнему НИКОГДА
(ник не подтверждён). Бэкфилл старых заказов «Ждут ссылку» — `scripts/backfill-probable-nicks.mjs`
(источники: `User.robloxUsername`, `WbCode.robloxNick`, другие заказы юзера, VK-диалог через
`messages.getHistory` → creator геймпасса / ник-токены с валидацией через Roblox users API;
TG-историю API не отдаёт). Миграция `20260704_add_autobuyout_and_gpwatch` переносит уже
записанные `[НИК?]` из adminNote в `probableNick`.

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
