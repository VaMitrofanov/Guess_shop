# База данных (Prisma)

Neon Postgres + Prisma 7 (`engineType=library`, adapter `PrismaPg`). Модели WB-домена иногда
кастуются в `any` в ботах (генератор отстаёт).

## Профили и каналы аудитории (production-срез 29.07.2026)

Канонический канал аккаунта — `UserIdentity(provider, subject)`; `User.tgId`, `User.vkId`
и `User.email` пока остаются совместимым legacy-слоем. Поэтому операторская аналитика
считает объединение обоих слоёв, но отображает происхождение отдельно. Число Telegram-
и VK-профилей нельзя складывать в число людей: один `User` может присутствовать в обоих
сегментах.

Контрольный срез: 597 `User`; Telegram-канал есть у 372 профилей, VK — у 220, email — у 5;
564 профиля имеют хотя бы один production-заказ, 61 — больше одного. У 170 социальных
профилей хотя бы один канал остаётся legacy-only: TG 128, VK 42. Удалять старые поля или
считать их подтверждёнными нельзя до идемпотентного backfill и ручного разрешения
конфликтов уникальности `UserIdentity(provider, subject)`; threat model — `security.md` §11.

Публичная аудитория сообществ не хранится в БД: `/admin/users` читает её live через
Telegram Bot API и VK API и маркирует отдельно от зарегистрированных профилей. Ошибка
внешнего API даёт «данные временно недоступны», а не нулевую аудиторию.

## Email account lifecycle (18.07.2026)

Аддитивная migration `20260718_email_account_lifecycle` добавляет:

- `User.emailVerifiedAt` и `User.sessionVersion` (`0` по умолчанию);
- `EmailActionToken` для `VERIFY_EMAIL`/`RESET_PASSWORD`: только SHA-256 hash, TTL,
  `consumedAt`, индексы по user/purpose и expiry;
- `ConsentEvidence`: append-only запись версии документа, источника, времени принятия и
  keyed IP hash без сырого IP/user-agent.

`UserIdentity(provider=EMAIL)` больше не создаётся при регистрации: он появляется только
после атомарного consume verification-token. Reset увеличивает `sessionVersion`, поэтому
все JWT старой версии перестают давать пользовательскую сессию. Release order: backup →
`prisma migrate status` → `prisma migrate deploy` → Web deploy; без SMTP схема и Web
остаются рабочими, отправка писем отвечает fail-closed.

## Миграция точной прибыли TWA (13.07.2026)

`20260713_twa_order_profit_snapshots` добавляет в `WbOrder` immutable snapshots DIRECT/AVITO:
`saleAmountKopecks`, `purchaseRobuxAmount`, `purchaseRateUsdPer1k`, `purchaseUsdToRub`,
`purchaseCostKopecks`, `profitKopecks`. Деньги хранятся в целых копейках; ставка закупа —
USD/1000 R$, USD/RUB фиксируется отдельно. Legacy NULL не пересчитывается текущим курсом.

Release order строгий: сначала `npx prisma migrate deploy`, затем новая версия приложения и
ботов. Новый Prisma Client читает эти колонки в стандартном `WbOrder.findMany`.
На production Neon migration применена 13.07.2026 вместе с
`20260713_partner_sync_lease_ledger_v2`, до rollout commit `6551aab`.

## Модели воркфлоу

### `WbCode` — физические коды на вкладышах WB-карт
| Поле | Смысл |
|------|-------|
| `code` | 7 символов, уникальный |
| `denomination` | номинал в R$ (300/500/800/1000…) |
| `status` | `AVAILABLE → RESERVED → CLAIMED` (`WbCodeStatus`) |
| `sessionId` | браузерная сессия при резерве |
| `reservedUntil` | TTL резерва (+60 мин) |
| `isUsed` | `false` = provisional; `true` = финальный заказ создан |
| `userId` | привязка при активации в боте/на сайте |
| `reviewBonusClaimed` | бонус за отзыв начислен |
| `selectedGamepassId` | геймпасс, выбранный на сайте (one-tap в бот) |
| `robloxNick` | ник, с которым искали на сайте |
| `isTest` | тестовый код |

**Provisional состояние:** `status=CLAIMED, isUsed=false, userId=set`. Бот не блокирует юзера,
финальная транзакция ставит `isUsed=true`.

#### Ручная доливка кодов (2026-07-16)

Код `6QYDK79` (2000 R$) добавлен вручную с batch-маркером `2026_07_07_batch_manual_add`:
физически напечатанная карта из тиража 07.07, которой не было в загруженном CSV (подтверждено
владельцем). Расследование 15–16.07: точного совпадения в БД не было, fuzzy-соседей нет,
состав `2026_07_07_batch` (300×500 + 48×2000) сходился с ожиданием — то есть **печатный тираж
разошёлся с импортом**, а не «недогрузился» батч.

Правило: коды, долитые вне исходного CSV, помечаются отдельным batch (`*_manual_add`), а не
дописываются в исходную партию — иначе теряется след «печать ≠ импорт» и невозможно отличить
легитимную доливку от вставки кода неизвестного происхождения (см. риск подделки вкладыша,
[security.md](security.md)).

#### Загрузка кодов нового тиража

Загрузчик **один** — `scripts/push-wb-codes.js` (Prisma Client, не сырой SQL):

```bash
node scripts/push-wb-codes.js codes.csv --dry-run   # что произойдёт, без записи
node scripts/push-wb-codes.js codes.csv             # загрузка
```

CSV: обязательный заголовок с `code`, `denomination` и опционально `batch` (порядок колонок
любой). Скрипт **падает с ненулевым exit code**, если хоть один код из CSV не оказался в БД
после вставки, если сверка `строк CSV == вставлено + дубли` не сошлась, или если в CSV есть
невалидная строка (неизвестный номинал, дубль внутри файла). Валидация — всё или ничего: при
любой плохой строке не грузится ничего.

> **Почему так строго (инцидент 6QYDK79, 15–16.07).** Прежние скрипты молча теряли коды:
> `load-wb-codes.js` глотал **все** ошибки вставки (`catch {}` с комментарием про дубликаты) и
> считал дубли как успешно добавленные, поэтому печатал `✅ ГОТОВО` даже при нуле вставок;
> оба скрипта не передавали `updatedAt` (а `push-` ещё и `id`), а DEFAULT с этих колонок снят
> (миграция `20260521_add_wbcode_updated_at` создавала `updatedAt` с `DEFAULT NOW()`, но
> Prisma-`@updatedAt` — app-level, и default ушёл), из-за чего raw INSERT падал по not-null.
> Вдобавок оба требовали `@neondatabase/serverless`, которого нет ни в `node_modules`, ни в
> `package.json`. Результат — напечатанная карта без кода в БД и «Код не найден» у клиента.
> Поэтому пишем через Prisma Client (схема и скрипт не разъезжаются) и проверяем факт наличия
> каждого кода в БД отдельным запросом после загрузки. `load-wb-codes.js` оставлен заглушкой,
> которая падает и отправляет к `push-wb-codes.js`.

### `WbOrder` — заказы на выкуп
Ключевые поля: `amount` (**чистые** R$), `gamepassUrl`, `status` (`WbOrderStatus`),
`platform` (`TG`/`VK`/`WEB`), `wbCode` (**@unique** — один заказ на код/публичный WEB-id), `userId`,
`orderSource` (`WB`/`DIRECT`/`AVITO`/`MANUAL`/`SITE`), `isDirectOrder`, `isFavorite`, `isTest`,
`adminNote` (только для админа), `robloxUsername` (продавец, **только подтверждённый** ник),
`buyoutErrorCode` (структурированная причина `ERROR`; `REGIONAL_PRICE` = региональная цена
на доноре и не найдена безопасная full-price замена),
`purchaserUsername` (куки-аккаунт-покупатель), `purchaseRate` (снапшот закупки в $ за
1000 R$ при выкупе), `saleAmountKopecks`, `purchaseRobuxAmount`,
`purchaseRateUsdPer1k`, `purchaseUsdToRub`, `purchaseCostKopecks`, `profitKopecks`
(immutable snapshots точной прибыли новых DIRECT/AVITO),
`pendingAt` (момент попадания в «К выкупу» — для сортировки), `rejectionReason`,
`paidAt` (2026-07-06, миграция `20260706_add_paid_at`) — момент подтверждения оплаты
прямого заказа (`pay_ok:` в TG); DIR без `paidAt` исключён из всех путей выкупа
(гейт — `docs/twa-admin.md`); бэкфилл: DIR в PENDING/IN_PROGRESS/COMPLETED → `updatedAt`.
Ранний захват ника (+3): `probableNick` / `probableNickAt` — **вероятный** ник «карандашом»
(из nick-поиска / fail-валидации / сайта / VK-бэкфилла; в `robloxUsername` не пишется, пока
клиент не подтвердит). GP-watch: `gpWatchLastCheckAt` (троттлинг проверок),
`gpWatchNotifiedPassId` (дедуп уведомлений), `gpWatchDeclinedAt` (П3, миграция
`20260706_add_gpwatch_declined_at`: клиент ответил «❌ Не мой ник» — бейдж в TWA;
сбрасывается при новом probableNick). Индекс `[status, probableNick]` — выборка воркера.
Таймер разблокировки робуксов (Ф6.3, миграция
`20260712_wborder_completed_at_unlock_remind`, **применена к прод-Neon 2026-07-12**):
`completedAt` — момент фактического выкупа (перехода в `COMPLETED`), базис
«Roblox разблокирует ~ completedAt + 5 дней»; ставится во ВСЕХ путях COMPLETED
(TWA `complete`/`purchase`/move-to DONE, автовыкуп, TG-карточка `pb:`/`admin_ok:`,
hub bulk-complete; батч «Выкупить всё» ходит через `purchase`). Старые заказы —
NULL (крон разблокировки их не трогает, нет пушей задним числом).
`robuxUnlockRemindLevel` (0=не слали, 1=пуш 5-го дня «могли разблокироваться»,
2=пуш 7-го дня «точно разблокированы») — уровни крона разблокировки (Ф6.3/О3).

Статусы (`WbOrderStatus`):
`AWAITING_PAYMENT` · `PAYMENT_PENDING` · `AWAITING_GAMEPASS` (provisional, ждём ссылку) ·
`PENDING` (ссылка принята) · `IN_PROGRESS` · `COMPLETED` · `REJECTED` · `ERROR` (неуспешный выкуп).

Ручное восстановление `ERROR → PENDING` выполняется TWA action `restore-to-buyout`:
требует сохранённый `gamepassUrl` и подтверждённую оплату для DIR, не вызывает Roblox,
очищает активный `buyoutErrorCode`, обновляет `pendingAt` и дописывает audit в `adminNote`.
Источник заказа не меняется. Общий `move-to` также доступен из папки `Ошибка`; он больше
не перезаписывает историю заметки, а дописывает причину перевода.

Индексы покрывают все вкладки TWA (status+createdAt, favorites, purchaserUsername, orderSource,
robloxUsername, userId+createdAt).

### `DirectIntent` — намерение прямого заказа
Создаётся только когда есть реквизиты (сумма/бонус/скидка/ник/gamepass). Статус
`DirectIntentStatus`: `PENDING` (ждёт менеджера, живёт 24 ч) → `CONSUMED` (превращён в
`WbOrder` `DIR-…` через QR/реквизиты — из TG-карточки или TWA-вкладки «Прямой») /
`CANCELLED` (отклонён) / `EXPIRED` (>24 ч, авто). Предотвращает «мёртвые» полу-заказы.

С 24.07.2026 менеджер может создать прямой заказ вручную из TWA → Orders → «Прямой» → «+».
После поиска ника Roblox выбирается for-sale геймпасс, сумма `WbOrder.amount` считается как
`floor(priceRobux × 0.7)`, а юзер выбирается через `search-users`. Такой заказ получает
синтетический код `DIR-…`, `isDirectOrder=true`, `orderSource=DIRECT`, `PENDING`,
`pendingAt=now` и `paidAt=now`: ручное действие менеджера считается подтверждением для
немедленного попадания в очередь выкупа. В `paymentDetails` и `adminNote` остаётся явная
пометка ручного создания; `WbCode` для этого сценария не создаётся.

### `GlobalSettings` (id=`global`)
Настройки выкупа: `robloxCookie` (`.ROBLOSECURITY` донора), `robloxCookieUpdatedAt`,
`robloxAccountName` (ник донора), `purchaseRate` ($ за 1000 R$), `usdToRub`.
Аккаунт-приёмник слива («мой акк»): `drainCookie`, `drainCookieUpdatedAt`, `drainAccountName`,
`drainGamepassId` (геймпасс, чью цену меняем). `drainProductId` (`Int`) — **legacy, больше не
пишется**: у современных геймпассов ProductId > INT32 (2.1 млрд) → запись падала с
`ValueOutOfRange` и роняла `set-gamepass` («Ошибка сети» в TWA). Фикс: productId не кэшируем,
а берём заново из `product-info` в момент слива. Колонка оставлена, чтобы не плодить миграцию.
Автовыкуп (+1): `autoBuyoutEnabled` (kill-switch, default OFF), `autoBuyoutThreshold` (порог
слива, R$, default 150), `autoBuyoutMaxPerTick` (default 5), `autoBuyoutBelowSince` (дедуп
алерта «пора сливать»). GP-watch (+3): `gpWatchEnabled` (kill-switch, default OFF),
`gpWatchNotify` (`admin`/`customer`/`both`, default `both` — кому сообщать о найденном ГП:
алерт менеджеру и/или пинг клиенту; миграция `20260704_add_gpwatch_notify_mode`).
Автослив (+5.G.3): `autoDrainEnabled` (kill-switch, default OFF; миграция
`20260705_add_autodrain_flag`). СБП-QR: `sbpQrBase64` — base64-картинка QR прямых заказов
(миграция `20260706_add_sbp_qr`; до неё колонки в проде НЕ БЫЛО, боты ловили 42703 и
отвечали «QR не настроен» — см. `docs/bots.md`).

> ⚠️ `usdToRub` — `Float` без default. Любой `globalSettings.upsert` **обязан** передавать
> `usdToRub` в блоке `create`, даже если фактически сработает `update` — Prisma валидирует
> форму `create` всегда. Пропуск = `PrismaClientValidationError` на 100% вызовов.
> Конвенция в коде: `usdToRub: 90`.

### `User`
`tgId` (@unique), `vkId` (@unique), `balance` (бонусы R$), `role` (`USER`/`ADMIN`),
`robloxUsername`, `username` (@handle для кнопки «Написать» в TWA).

### Identity, бонусы и цена витрины (foundation эквайринга, migration применена 2026-07-12)

- `UserIdentity` — серверно проверенная внешняя identity (`TG`/`VK`/`EMAIL`) с уникальностью
  `(provider, subject)`. Пока legacy-поля `tgId`/`vkId`/`email` остаются для ботов; исходная
  migration один раз backfill-ила существовавшие записи без создания или слияния `User`,
  но до 29.07 боты продолжали создавать новые legacy-only профили. Теперь каждый настоящий
  actor update лениво синхронизирует соответствующую identity; исторический долг закрывается
  по мере следующего контакта, без слепого массового повышения доверия. Email-регистрация создаёт
  `User` и `UserIdentity(EMAIL)` в одной транзакции; VK web-login сначала ищет эту таблицу,
  затем legacy `vkId`.
- `UserRobloxAccount` — one-to-many проекция Roblox-аккаунтов клиента. Уникальность
  `(userId, usernameNormalized)` не объединяет разных пользователей; `source` различает
  `ORDER_HISTORY` и `MANUAL`, `orderCount/firstOrderAt/lastOrderAt` хранят основание,
  `selectedAt` — выбор, `hiddenAt` — мягкое скрытие. Автопроекция принимает только собственные
  non-test `WbOrder` с `paidAt IS NOT NULL` или `COMPLETED`; новый заказ после `hiddenAt`
  возвращает ник в список.
- `User.roblox*` — совместимое зеркало выбранной `UserRobloxAccount`, а не самостоятельный
  источник доверия. Migration импортирует старую запись как `MANUAL` только если уже были
  `robloxUserId` и `robloxProfileSyncedAt`; старый ник от неоплаченного draft исключён.
  Любой ник не является доказательством личности и не используется для account merge.
- `BonusLedger` — append-only журнал изменения R$-бонусов. `User.balance` остаётся быстрым
  итогом; migration записывает текущий ненулевой balance как одну opening-строку с
  idempotency key. Новые начисления/списания должны писать обе сущности в одной транзакции.
- `AccountMergeAudit` — audit-след step-up merge: source/target, доказательства двух свежих
  авторизаций, результат и rollback-marker. TG link переносит identities/orders/intents,
  суммирует бонус через отдельную ledger-строку и оставляет source как инертный audit anchor.
  Автоматически объединять пользователей по нику, имени или email нельзя.
- `TelegramWebLoginChallenge` — одноразовый login/link challenge на 5 минут. В БД хранится
  только SHA-256 случайного state, режим и для link — заранее зафиксированный target User;
  `consumedAt` выставляется атомарно до создания сессии/merge. Migration
  `20260715_telegram_web_login_challenge` применена к production 2026-07-15.
- `PricingPolicy` хранит версию и JSON-представление опубликованной политики; расчёт
  `retail-direct-v2` остаётся чистой общей функцией `bots/shared/retail-pricing.ts`.
  Migration `20260730_retail_dynamic_net_pricing` применена к production 2026-07-30:
  закрывает v1 и активирует кривую владельца с gross-up на УСН 6% и
  `max(3,49 ₽; 3,49%)`.
- `PriceQuote` фиксирует на 15 минут версию, сумму R$, бонус, скидку и итог в **целых
  копейках**. `POST /api/pricing/quote` создаёт запись для гостя или текущего User.

### Канонический SITE-order и деньги (foundation migration применена 2026-07-13)

Дополняющая migration `20260713_payment_outbox_refund` добавляет refund accounting,
`PaymentRefund` и outbox lease; применена к production 2026-07-13 до push нового
Prisma-клиента.

Миграция `20260713_canonical_web_order_foundation` расширяет `WbOrder` без изменения старых
строк. Для `orderSource=SITE`, `platform=WEB` он хранит ссылку на одноразовый `PriceQuote`,
случайный `publicOrderId`, только SHA-256 хеш status-token, сумму в копейках, email чека,
версию/момент/IP принятия оферты и обязательный UUID идемпотентности. Quote переводится
`ACTIVE → CONSUMED` в той же serializable-транзакции, где создаются заказ, попытка оплаты,
audit-event и outbox.

- `PaymentAttempt` — неизменяемые `provider/publicOrderId/amountKopecks/idempotencyKey` плюс
  provider `paymentId`, URL, монотонный статус и cumulative `refundedAmountKopecks`. Raw
  callback не хранится: остаётся SHA-256.
- `PaymentRefund` — идемпотентный операторский запрос полного/частичного возврата; создаётся
  до provider call и различает `SUBMITTED`, `CONFIRMED`, `SUBMIT_UNKNOWN`.
- `OrderEvent` — append-only события с уникальным idempotency key.
- `OutboxMessage` — durable-доставка (`PENDING/PROCESSING/DELIVERED/DEAD`, attempts,
  `nextAttemptAt`, `lockedAt`, `lastError`). TG-service worker реализует lease, capped
  exponential retry и dead-letter alert; детали — `payments-and-kkt.md`.

Checkout принимает только `quoteId`: сервер повторно проверяет ownership/TTL/status/version,
Roblox owner, sale-state и точную gross-цену. Создание SITE-order пока требует verified
web-сессию; гостевой verified email/magic-link остаётся отдельным инкрементом. Боевой Init
fail-closed за `SITE_ACQUIRING_ENABLED=false` и обязательными ККТ-классификаторами env.
Зафиксированный bonus списывается compare-and-set из `User.balance` и отрицательной строкой
`BonusLedger` в той же транзакции; одноразовый `rubleDiscount` обнуляется там же. Поэтому две
параллельные quotes не могут потратить одну льготу дважды. При неопределённом результате Init
льгота остаётся привязанной к сохранённому заказу до reconciliation/cancel, а не возвращается
автоматически с риском двойного расхода.

### `PurchaseBatch`
Durable-запись одной пачки «Выкупить всё»: `accountName` (донор), `startedAt`/`finishedAt`,
`totalGross` (грязные R$), `okCount`/`failCount`, `items` (JSONB: `[{orderId,nick,wbCode,gross,ok,reason}]`).
Пишется клиентом после пакетного выкупа (`api/twa/purchase-batch` action `save`).

### `Partner`, `PartnerBuyoutTask`, `PartnerLedgerEntry`, `PartnerImportRun` (2026-07-09 / 07-10)
B2B/partner-ops контур для сторонних выкупов, первый instance — `slug=anton` / «Антон».
Это отдельный bounded context и он **не использует `WbOrder`**.

`Partner`: справочник партнёров (`slug`, `name`, `isActive`, `notes`). Для Антона добавлены
денежные и Sheets-настройки: `ledgerCurrency=USDT`, `robuxRateUsdtPer1000` (продажа),
`purchaseRateUsdtPer1000` (закупка), `rateBasis` (`DIRTY`/`NET`), `robloxFeePct`,
`googleSheetId`, `googleSheetTab`, `googleSheetUrl`. Политика новых партий с 29.07.2026:
`5.3 / 1000 NET`, закупка `4.7 / 1000 DIRTY`, комиссия `30%`.
Боевой `googleSheetId` Антона: `1jzWZZ_AeM0IMyHaljaLBei0hu_zDwktiysbgGt324rs`; фиксированного
`googleSheetTab` нет, потому что каждый лист таблицы соответствует новой дате.
`GET /api/twa/partners/[slug]/tasks` синхронизирует `googleSheetId/googleSheetUrl` из env
`ANTON_GOOGLE_SHEETS_SPREADSHEET_ID` при upsert партнёра; если env отсутствует, существующие
поля в БД не затираются.

`PartnerBuyoutTask`: одна партнёрская строка/задача на выкуп геймпасса. Статусы
`PartnerTaskStatus`: `NEW` · `READY` · `PURCHASING` · `DONE` · `FAILED` · `CANCELLED`.
Ключевые поля: `externalSource` (`MANUAL`/`XLSX_UPLOAD`/`GOOGLE_SHEETS`), `externalRowId`,
`robloxUsername`, `gamepassId`, `gamepassUrl`, `productId`, `sellerId`, `sellerName`,
`priceRobux`, `purchasePriceRobux`, `sheetRaw`, `purchaseAccountName`, `purchaseBatchId`,
`completedAt`, `error`, `note`. Unique `[partnerId, externalSource, externalRowId]`
нужен под idempotent ручной импорт `.xlsx` и будущий Google Sheets sync; индексы покрывают
`partnerId+status`, `partnerId+updatedAt`, `gamepassId`. Для `.xlsx` бинарный файл не хранится:
в `sheetRaw` сохраняются source/file/row metadata и исходные значения строки.

`priceRobux` — согласованная глобальная/базовая цена продавца и база партнёрского ledger;
`purchasePriceRobux` — фактически списанная цена Roblox. Региональную цену покупать запрещено,
поэтому новый `purchase-task` при неизвестном/региональном
`PriceInRobux != UserBasePriceInRobux` завершается `FAILED`. Единственное исключение —
серверно подтверждённый `RobloxPlusSubscription` 10%/20% с корректной арифметикой: Roblox
субсидирует разницу, а `purchaseRobuxAmount` хранит фактическое списание buyer-price.
Для Google Sheets `externalRowId` = `spreadsheetId:sheetTitle:rowNumber`; в `sheetRaw`
сохраняются `spreadsheetId`, `sheetTitle`, `rowNumber`, `range`, исходные ячейки `A:F`, время
sync и результат write-back (`writeBackAt` / `lastWriteBackError`), чтобы write-back и
диагностика ошибок были воспроизводимыми.

`PartnerImportRun` (миграция `20260710_partner_google_sheets_sync`): журнал прогонов
серверного импорта/sync. Поля: `source` (`GOOGLE_SHEETS`), `status`
(`RUNNING`/`SUCCESS`/`PARTIAL`/`FAILED`), `spreadsheetId`, счётчики `sheetCount`/`rowCount`/
`createdCount`/`updatedCount`/`failedCount`/`skippedCount`, `diagnostics` (JSON: фильтр по
листам — прочитано / прошло / отсев по `D` и `E` / статусы `E`), `error`, `startedAt`/
`finishedAt`, `createdBy`. Индексы `[partnerId, startedAt desc]` и `[partnerId, source, status]`.
Нужен для статуса sync в TWA и защиты от параллельных прогонов (TTL 60 с + проверка
`status=RUNNING` с порогом 2 мин).

`PartnerLedgerEntry`: отдельный ledger партнёрских денег. Для Антона ledger ведётся только
в `USDT`; R$ остаются ценой геймпасса в `PartnerBuyoutTask`.
Типы `PartnerLedgerType`: `TOPUP` · `BUYOUT` · `ADJUSTMENT` · `REFUND`.
`amount` хранится со знаком: пополнение положительное, выкуп отрицательный. API `Антон`
считает баланс aggregate по USDT-ledger и блокирует повторное `BUYOUT`-списание по одной
задаче. Для `NET` сначала считается `netRobuxAmount=floor(grossRobuxAmount×(1-fee))`,
затем выручка Антона; себестоимость всегда считается от грязного объёма.
С миграции `20260713_partner_sync_lease_ledger_v2` один фактический batch-выкуп хранится
одной строкой: `batchId` — идемпотентный идентификатор запуска, `itemCount` — число
успешных геймпассов, `robuxAmount`/`amount` — суммарные R$/USDT,
`purchaseAccountName` — donor/cookie-аккаунт. Уникальность `(partnerId, batchId)` не даёт
создать второе списание той же пачки; legacy BUYOUT получают `batchId=legacy:<id>`.
С миграции `20260711_partner_rate_history` (Этап 5.9) `BUYOUT`-записи дополнительно
хранят `rateUsdtPer1000` (курс списания) и `robuxAmount` (грязные R$) структурно —
отчёт «сколько куплено по какому курсу» строится `groupBy` по этим полям и не зависит
от join к задаче (`taskId` — `SetNull`). Старые записи бэкфиллятся скриптом
`scripts/anton-backfill-rates.mjs` (курс парсится из `comment`).

`PartnerRateChange` (та же миграция): журнал смен курса партнёра — `rate`,
`previousRate`, `createdBy`, `createdAt`, индекс `[partnerId, createdAt desc]`.
Пишется action'ом `set-rate` (no-op смена на тот же курс запись не создаёт);
стартовую запись создаёт бэкфилл-скрипт.

Миграция `20260729_partner_economics_roblox_profile` расширяет журнал ставок полями
`purchaseRate`, `previousPurchaseRate`, `rateBasis`, `previousRateBasis`, `robloxFeePct`.
Каждая новая BUYOUT-запись получает неизменяемый snapshot: `rateUsdtPer1000`,
`purchaseRateUsdtPer1000`, `rateBasis`, `costBasis`, `robloxFeePct`, грязный/чистый объём,
`revenueUsdt`, `expectedRevenueUsdt`, `costUsdt`, `profitUsdt`. История до 29.07 получает
закупку `4.3` с `costBasis=ASSUMED`; завершённые записи сменой текущей ставки не
переписываются. Отмена ошибочного TOPUP создаёт идемпотентный `ADJUSTMENT` с
`batchId=reversal:<originalId>` и сохраняет исходный факт.

Та же миграция добавляет в `User` кэш публичного Roblox-профиля:
`robloxUserId`, `robloxDisplayName`, `robloxAvatarUrl`, `robloxDescription`,
`robloxAccountCreatedAt`, `robloxProfileSyncedAt`. Стабильный `robloxUserId` позволяет
пережить смену username; кэш обновляется раз в 24 часа и может быть полностью отвязан.

Миграция `20260709_partner_anton_usdt_sheets` фиксирует стартовый кейс Антона:
`150 USDT` пополнения, 8 уже выкупленных XLSX-строк (`19 106 R$`) и агрегированное списание
`96.49 USDT`, расчётный остаток `53.51 USDT`.

Для рабочей TWA-фичи на проде должны быть применены миграции
`20260709_add_partner_buyout`, `20260709_partner_anton_usdt_sheets`,
`20260709_partner_xlsx_upload_source`, `20260710_partner_google_sheets_sync` и
`20260713_partner_sync_lease_ledger_v2`, `20260729_partner_economics_roblox_profile`.
Миграция 13.07 также добавляет DB-lease
`Partner.googleSyncLeaseId/googleSyncLeaseAt`, общий для manual/force/background sync. Если
Web-контейнер уже обновился, а БД ещё нет, `/api/twa/partners/[slug]/tasks` возвращает
`503 PARTNER_SCHEMA_NOT_READY`, чтобы не маскировать ошибку схемы нулевым балансом.

Подтверждённое состояние прод-БД на 2026-07-10: последней применена
`20260710_partner_google_sheets_sync`; новую миграцию 2026-07-13 надо применить перед
деплоем этого кода. Partner-таблицы + `PartnerImportRun` созданы, enum
`PartnerExternalSource` содержит `XLSX_UPLOAD`/`GOOGLE_SHEETS`, baseline Антона виден в TWA/API
как 8 DONE-задач на `19 106 R$`, ledger `150.00 - 96.49 = 53.51 USDT`.

### `DrainEvent` (2026-07-05)
Учёт сливов остатка донора в приёмник: `donorName`, `drainName`, `amount` (грязные R$),
`gamepassId`, `source` (`manual` — кнопка 💧 в TWA / `auto` — автослив-воркер), `createdAt`.
Пишется при успешном сливе; читается «Историей покупок» (`/api/twa/drain?events=1`).

## Аудит данных (снапшот 2026-07-07)

- **337 юзеров**, 315 с заказами, 22 без (6.5% «фантомы»).
- 22 юзера без заказов — естественный отсев: зашли в бота, но не завершили активацию.
  Среди них 3 «VK User» (старый баг `vkGetName`, починен), 2 тестовых (владелец, GuessWho).
- **0 orphan-заказов** (заказ указывает на несуществующего юзера) — целостность ок.
- **2 WbCode** claimed+isUsed, но без заказа (1FS0SNA, UITRVG1) — оба RESERVED,
  браузерная сессия без привязки к юзеру. Безвредны (сайт перехватывает, код доступен).
- **350 заказов**, 1357 кодов (279 использовано).
- 8 случаев дублирования `gamepassUrl` — ожидаемо: Авито-ретраи (REJECTED → новый),
  повторные покупки того же пасса разными клиентами, DIR-ACCQX5IK (известный кейс
  «неоплаченный DIR + старый геймпасс», гейт paidAt).

## Legacy-модели (вне WB-воркфлоу)

`Product`, `Order` (`OrderStatus`), `Review`, `FAQ`, `MarketRate`, `RateSnapshot`,
`WbProductCost`, `WbSettings` — часть старой e-commerce-модели и WB-аналитики. `Order`/`Product`
относятся к спящему checkout-слою (см. [architecture.md](architecture.md#legacy)).

## Изменения 26.07.2026 (ultra-review)

Миграция `20260726_ultra_review_fixes` (аддитивная, применена до деплоя):

| Объект | Что | Зачем |
|---|---|---|
| `WbOrder.gamepassId` | `TEXT`, `@@index([gamepassId])` | U18: поиск заказа по геймпассу шёл через `gamepassUrl contains '/<id>'` списком `OR` — индекс неприменим, полное сканирование на каждом поиске и **перед каждой покупкой**. Backfill regexp'ом заполнил 548 из 549 заказов со ссылкой (единственный пропуск — ссылка на `/games/`, а не на геймпасс) |
| триггер `wborder_gamepass_id_sync` | `BEFORE INSERT OR UPDATE OF "gamepassUrl"` | ссылку на геймпасс пишут больше десяти мест (сайт, оба бота, TWA, ручное создание, замена пасса); триггер снимает класс ошибок «забыли обновить производное поле» целиком |
| `WbOrder.bonusAppliedRobux`, `WbOrder.discountAppliedKopecks` | `INTEGER` | U3: фактически применённые льготы. Раньше `rubleDiscount` обнулялся «в никуда» и восстановить его при неудачной оплате было нечем |
| `WbOrder.benefitsRevertedAt` | `TIMESTAMP(3)` | U3: отметка проведённой компенсации — защита от двойного возврата на стыке webhook / catch-ветки `Init` / крона протухших заказов |
| `WbOrder.termsUserAgent`, `ConsentEvidence.userAgent`, `ConsentEvidence.deploymentId` | `TEXT` | U9: IP сам по себе слабое доказательство согласия с офертой |

Миграция `20260726_drop_legacy_shop` (разрушительная, применяется **после** деплоя):
`DROP TABLE "Order"`, `DROP TABLE "Product"`, `DROP TYPE "OrderStatus"` — legacy-слой
магазина с нулевым production-остатком (U13). Разделение на две миграции неслучайно: пока
в проде крутится предыдущая сборка, её страница ЛК ещё читает `prisma.order`.

### Ретенция (U12)

До 26.07 `deleteMany` был во всём проекте ровно один — для `TelegramWebLoginChallenge`.
Суточный крон `bots/shared/retention.ts` (TG-сервис):

- `PriceQuote` со `status != CONSUMED`, `expiresAt` старше 7 дней и без привязанного
  заказа — удаляются;
- `EmailActionToken` с `expiresAt` старше 30 дней — удаляются;
- `OrderEvent` старше 18 месяцев — только считаются и выводятся в лог (аудит денежных
  операций, удаление — решение владельца);
- `ConsentEvidence` не трогается: юридическое доказательство согласия.

Отдельно: анонимный `POST /api/pricing/quote` больше **не пишет** строку `PriceQuote` —
потребить её всё равно нельзя (`validateCheckoutQuote` требует совпадения владельца), а
без ретенции и с обходимым rate-limit это был вектор неограниченного роста БД.

### Журнал бонусов

`BonusLedger` стал единственным способом менять `User.balance`: `src/lib/bonus-ledger.ts`
и зеркало `bots/shared/order-benefits.ts` всегда используют `increment`, всегда пишут
строку журнала и требуют ключ идемпотентности. Сверка `SUM(deltaRobux) == balance` —
`node scripts/bonus-ledger-audit.mjs` (dry-run по умолчанию).
