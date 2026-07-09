# База данных (Prisma)

Neon Postgres + Prisma 7 (`engineType=library`, adapter `PrismaPg`). Модели WB-домена иногда
кастуются в `any` в ботах (генератор отстаёт).

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

### `WbOrder` — заказы на выкуп
Ключевые поля: `amount` (**чистые** R$), `gamepassUrl`, `status` (`WbOrderStatus`),
`platform` (`TG`/`VK`), `wbCode` (**@unique** — один заказ на код), `userId`,
`orderSource` (`WB`/`DIRECT`/`AVITO`/`MANUAL`), `isDirectOrder`, `isFavorite`, `isTest`,
`adminNote` (только для админа), `robloxUsername` (продавец, **только подтверждённый** ник),
`purchaserUsername` (куки-аккаунт-покупатель), `purchaseRate` (снапшот курса при выкупе),
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

Статусы (`WbOrderStatus`):
`AWAITING_PAYMENT` · `PAYMENT_PENDING` · `AWAITING_GAMEPASS` (provisional, ждём ссылку) ·
`PENDING` (ссылка принята) · `IN_PROGRESS` · `COMPLETED` · `REJECTED` · `ERROR` (неуспешный выкуп).

Индексы покрывают все вкладки TWA (status+createdAt, favorites, purchaserUsername, orderSource,
robloxUsername, userId+createdAt).

### `DirectIntent` — намерение прямого заказа
Создаётся только когда есть реквизиты (сумма/бонус/скидка/ник/gamepass). Статус
`DirectIntentStatus`: `PENDING` (ждёт менеджера, живёт 24 ч) → `CONSUMED` (превращён в
`WbOrder` `DIR-…` через QR/реквизиты — из TG-карточки или TWA-вкладки «Прямой») /
`CANCELLED` (отклонён) / `EXPIRED` (>24 ч, авто). Предотвращает «мёртвые» полу-заказы.

### `GlobalSettings` (id=`global`)
Настройки выкупа: `robloxCookie` (`.ROBLOSECURITY` донора), `robloxCookieUpdatedAt`,
`robloxAccountName` (ник донора), `purchaseRate` (R$/₽), `usdToRub`.
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

### `PurchaseBatch`
Durable-запись одной пачки «Выкупить всё»: `accountName` (донор), `startedAt`/`finishedAt`,
`totalGross` (грязные R$), `okCount`/`failCount`, `items` (JSONB: `[{orderId,nick,wbCode,gross,ok,reason}]`).
Пишется клиентом после пакетного выкупа (`api/twa/purchase-batch` action `save`).

### `Partner`, `PartnerBuyoutTask`, `PartnerLedgerEntry` (2026-07-09)
B2B/partner-ops контур для сторонних выкупов, первый instance — `slug=anton` / «Антон».
Это отдельный bounded context и он **не использует `WbOrder`**.

`Partner`: справочник партнёров (`slug`, `name`, `isActive`, `notes`). Для Антона добавлены
денежные и Sheets-настройки: `ledgerCurrency=USDT`, `robuxRateUsdtPer1000` (сейчас `5.05`),
`googleSheetId`, `googleSheetTab`, `googleSheetUrl`.
Боевой `googleSheetId` Антона: `1jzWZZ_AeM0IMyHaljaLBei0hu_zDwktiysbgGt324rs`; фиксированного
`googleSheetTab` нет, потому что каждый лист таблицы соответствует новой дате.
`GET /api/twa/partners/anton/tasks` синхронизирует `googleSheetId/googleSheetUrl` из env
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
Для Google Sheets `externalRowId` должен включать tab title и row number; в `sheetRaw` стоит
сохранять исходные `A/C/D/E/F`, чтобы write-back и диагностика ошибок были воспроизводимыми.

`PartnerLedgerEntry`: отдельный ledger партнёрских денег. Для Антона ledger ведётся только
в `USDT`; R$ остаются ценой геймпасса в `PartnerBuyoutTask`.
Типы `PartnerLedgerType`: `TOPUP` · `BUYOUT` · `ADJUSTMENT` · `REFUND`.
`amount` хранится со знаком: пополнение положительное, выкуп отрицательный. API `Антон`
считает баланс aggregate по USDT-ledger, перед ручным закрытием/покупкой конвертирует
грязную R$-цену задачи по `Partner.robuxRateUsdtPer1000`, проверяет баланс и блокирует
повторное `BUYOUT`-списание по одной задаче.

Миграция `20260709_partner_anton_usdt_sheets` фиксирует стартовый кейс Антона:
`150 USDT` пополнения, 8 уже выкупленных XLSX-строк (`19 106 R$`) и агрегированное списание
`96.49 USDT`, расчётный остаток `53.51 USDT`.

Для рабочей TWA-фичи на проде должны быть применены миграции
`20260709_add_partner_buyout`, `20260709_partner_anton_usdt_sheets` и
`20260709_partner_xlsx_upload_source`. Если Web-контейнер уже обновился, а БД ещё нет,
`/api/twa/partners/anton/tasks` возвращает `503 PARTNER_SCHEMA_NOT_READY`, чтобы не
маскировать ошибку схемы нулевым балансом.

Прод-БД синхронизирована с этими миграциями 2026-07-09: partner-таблицы созданы, enum
`PartnerExternalSource` содержит `XLSX_UPLOAD`, baseline Антона виден в TWA/API как 8 DONE-задач
на `19 106 R$`, ledger `150.00 - 96.49 = 53.51 USDT`.

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
