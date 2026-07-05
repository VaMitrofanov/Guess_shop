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
`pendingAt` (момент попадания в «К выкупу» — для сортировки), `rejectionReason`.
Ранний захват ника (+3): `probableNick` / `probableNickAt` — **вероятный** ник «карандашом»
(из nick-поиска / fail-валидации / сайта / VK-бэкфилла; в `robloxUsername` не пишется, пока
клиент не подтвердит). GP-watch: `gpWatchLastCheckAt` (троттлинг проверок),
`gpWatchNotifiedPassId` (дедуп уведомлений). Индекс `[status, probableNick]` — выборка воркера.

Статусы (`WbOrderStatus`):
`AWAITING_PAYMENT` · `PAYMENT_PENDING` · `AWAITING_GAMEPASS` (provisional, ждём ссылку) ·
`PENDING` (ссылка принята) · `IN_PROGRESS` · `COMPLETED` · `REJECTED` · `ERROR` (неуспешный выкуп).

Индексы покрывают все вкладки TWA (status+createdAt, favorites, purchaserUsername, orderSource,
robloxUsername, userId+createdAt).

### `DirectIntent` — намерение прямого заказа
Создаётся только когда есть реквизиты (сумма/бонус/скидка/ник/gamepass). Статус
`DirectIntentStatus`. Предотвращает «мёртвые» полу-заказы.

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

### `DrainEvent` (2026-07-05)
Учёт сливов остатка донора в приёмник: `donorName`, `drainName`, `amount` (грязные R$),
`gamepassId`, `source` (`manual` — кнопка 💧 в TWA / `auto` — автослив-воркер), `createdAt`.
Пишется при успешном сливе; читается «Историей покупок» (`/api/twa/drain?events=1`).

## Legacy-модели (вне WB-воркфлоу)

`Product`, `Order` (`OrderStatus`), `Review`, `FAQ`, `MarketRate`, `RateSnapshot`,
`WbProductCost`, `WbSettings` — часть старой e-commerce-модели и WB-аналитики. `Order`/`Product`
относятся к спящему checkout-слою (см. [architecture.md](architecture.md#legacy)).
