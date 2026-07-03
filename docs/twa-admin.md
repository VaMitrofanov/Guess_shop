# TWA — админка в Telegram Web App

`/twa` — панель менеджера внутри Telegram. Целевые устройства: iPhone 14/15 Pro Max +
MacBook 16". Дизайн — iOS-эстетика, минимальный контентный шрифт 14px.

## Аутентификация — `src/lib/twa-auth.ts`

1. `validateInitData(initData)` — проверяет HMAC подписи Telegram (`HMAC-SHA256`, ключ
   от `TG_TOKEN`), отклоняет старше 24 ч, извлекает `userId`/`firstName`.
2. `isAdmin(userId)` — проверка по `ADMIN_IDS`.
3. `signTwaToken` → JWT (`role: twa-admin`, TTL 12 ч), `verifyTwaToken` при каждом запросе.
4. `extractTwaUser(req)` — читает `Authorization: Bearer` и верифицирует.

**Все `/api/twa/*` роуты вызывают `extractTwaUser` в начале** (кроме `auth` — точка входа —
и `debug` — за `ADMIN_SECRET`).

> ⚠️ **Известный риск:** `api/twa/auth` имеет fallback-путь (Path 2), доверяющий `userId`
> из тела запроса без initData. Telegram ID не секретны → потенциальный обход. См.
> [security.md](security.md#twa-auth).

## Экраны — `src/app/twa/_components/screens/`

| Экран | Роль |
|-------|------|
| `Dashboard` | сводка |
| `OrdersScreen` | заказы: 8 логических вкладок + поиск + перепривязка |
| `BossrobuxScreen` | «Аккаунт»: поиск/выкуп геймпассов, баланс, cookie, «К выкупу», «Выкупить всё», «Слив остатка», история покупок |
| `CalcScreen` | калькулятор цен |
| `CodesScreen` | WB-коды |
| `AnalyticsScreen`, `StocksScreen`, `WbScreen` | WB-аналитика/остатки |
| `ReviewsScreen`, `SettingsScreen`, `SystemScreen` | отзывы, настройки, health |

## Вкладки заказов (`OrdersScreen` + `api/twa/orders`)

Виртуальные фильтры (`buildTabWhere`), а не просто статусы:

| Вкладка | Фильтр | Сортировка | Цена |
|---------|--------|------------|------|
| Все | всё (кроме `isTest`) | новые сверху | чистые |
| К выкупу | PENDING+IN_PROGRESS, не direct, не avito, не favorite | старые сверху | грязные (чистые) |
| Прямой | direct, активные статусы | старые сверху | грязные |
| Авито | `orderSource=AVITO`, активные | старые сверху | грязные |
| Новые | AWAITING_GAMEPASS < 40 ч | новые сверху | чистые |
| Ошибка | ERROR | старые сверху | грязные |
| Ждут ссылку | AWAITING_GAMEPASS ≥ 40 ч | старые сверху | чистые |
| Готово | COMPLETED (аккордеон по куки-аккаунту) | новые сверху | чистые |
| Избранное | isFavorite | новые сверху | чистые |

Счётчики/суммы — один `$queryRaw` с `FILTER (WHERE …)`, кэш 30 с (`cachedCounts`), сбрасывается
при любой мутации.

**Два таймера на карточке.** `⏱` — возраст заказа от `createdAt`. `🛒` — время в очереди
«К выкупу» от `pendingAt` (момент перехода в `PENDING`, когда пришла ссылка на геймпасс).
Второй таймер показывается только для заказов в `PENDING`/`IN_PROGRESS`. Оба цвета — по
`ageColor` (зелёный <2ч → жёлтый → оранжевый → красный >24ч). Есть и в списке «К выкупу»
на экране «Аккаунт» (`BuyoutOrderCard`).

Карточка заказа со статусом `COMPLETED` показывает строку **«💳 Выкуп: {аккаунт}»**
(`purchaserUsername`, `null` → «Ручные») — видно во вкладке «Все» и в результатах поиска.
Во вкладке «Готово» аккаунт уже в шапке аккордеона, поэтому строка там не дублируется.
`purchaserUsername` пишется при серверном выкупе (`purchase`) и сливе; ручной `complete` его
не пишет (остаётся «Ручные»).

## Действия (`POST /api/twa/orders`, поле `action`)

`create-avito`, `set-note`, `toggle-favorite`, `set-error`, `move-to`, `complete`, `reject`,
`purchase` (реальный серверный выкуп через `.ROBLOSECURITY` cookie из `GlobalSettings`),
`edit-avito`, `set-source`, `purchase-script` (генерит JS для ручного выкупа в консоли),
`search-users`, `rebind-order` (перепривязка заказа к другому юзеру, транзакция
`WbOrder + WbCode`, аудит в `adminNote`, уведомление новому юзеру),
`attachable-orders` (список заказов без геймпасса: AWAITING_GAMEPASS / REJECTED / ERROR,
опциональный `query`), `attach-gamepass` (ручная привязка геймпасса к заказу — см.
«Привязка геймпасса к заказу» ниже).

Все действия, кроме `create-avito`, `search-users` и `attachable-orders`, требуют `orderId` —
guard стоит после этих блоков. **Не добавлять безордерные action'ы ниже guard'а**: клиент получит 400
«orderId required», а RebindModal молча глотает не-ok ответы и показывает «Никого не найдено»
(так сломался поиск при первом релизе перепривязки — фикс 2026-07-02).

## Аккаунт-выкуп (`BossrobuxScreen`)

- **Баланс** куки-аккаунта: `1 570 R$ (1 099 чистых)` — `floor(balance * 0.7)`.
- **Cookie** `.ROBLOSECURITY` хранится в `GlobalSettings`, задаётся через `/setcookie` (бот)
  или кнопку в TWA. Ник куки-аккаунта кэшируется в `robloxAccountName`. Это аккаунт-**донор**
  (с него покупаем).
- **«К выкупу»**: параллельно грузит DIRECT + BUYOUT + AVITO. Прямые и Авито — **обязательные**
  (всегда в пачке), WB — **оптимизированное подмножество** через 0/1 DP-knapsack
  (`optimizeWbSubset`, target `[budget-143, budget]`) под баланс аккаунта.
- **«⚡ Выкупить всё»**: клиентский цикл по выбранной пачке через существующий серверный
  `purchase` (action в `api/twa/orders`), с рандомной паузой 2–8 c между покупками, прогрессом
  и кнопкой «Стоп». Авто-стоп при нехватке баланса / протухшем cookie. По завершении — отчёт
  (что куплено, суммы, ошибки), который сохраняется в `PurchaseBatch` и присылается менеджеру
  в Telegram (`api/twa/purchase-batch`, action `save` + `notify`).
- **История покупок** — аккордеон по `purchaserUsername` (куки-аккаунт, с которого выкуплено).

### Привязка геймпасса к заказу (📎 в «Поиск и выкуп»)

Сценарий: бот проспал геймпасс клиента (или заказ отклонён/в ошибке), но менеджер знает ник —
находит геймпасс сам через «Поиск и выкуп» и привязывает его к существующему заказу, не гоняя
клиента по новой.

- На каждой карточке результата поиска — кнопка **📎** → модалка `AttachOrderModal`:
  список заказов в статусах `AWAITING_GAMEPASS` / `REJECTED` / `ERROR` (50 последних,
  `action: "attachable-orders"`). Поиск — **серверный** (debounce 350 мс, `query` от 2
  символов, ищет по коду ВБ / нику / имени / robloxUsername по всей БД): старые заказы
  за пределами первых 50 находятся именно через него, клиентский фильтр — лишь мгновенное
  сужение уже загруженного списка. У каждого заказа — сверка требуемой цены
  `ceil(amount / 0.7)` с ценой геймпасса (✓ зелёная / ⚠️ оранжевая + плашка
  предупреждения, привязать можно и при расхождении — решает менеджер).
- Подтверждение → `action: "attach-gamepass"` (`orderId` + `gamepassId`): пишет канонический
  `gamepassUrl`, статус → `PENDING`, `pendingAt` = now (если заказ не был в PENDING),
  чистит `rejectionReason`, дописывает аудит `[GP-ATTACH дата] url (вручную из TWA)` в
  `adminNote`. Разрешён и повторный вызов на `PENDING`-заказе (замена ссылки, `pendingAt`
  сохраняется).
- Клиент получает то же уведомление, что и от бота: «🎉 Отлично, геймпасс принят!» + номер
  заявки (`notifyGamepassAttached`, TG или VK). Отправка **не** fire-and-forget: роут ждёт
  результат, `tgPost`/`vkPost` возвращают фактический успех, и тост менеджеру честный —
  «привязан, клиент уведомлён (TG/VK)» либо «привязан, но уведомление НЕ доставлено — напиши
  клиенту вручную» (типовой случай недоставки: VK error 901 — юзер логинился VK-ом на сайте,
  но никогда не писал сообществу; проверить можно `messages.isMessagesFromGroupAllowed`).
- После привязки секция «К выкупу» перезагружается — заказ сразу попадает в пачку выкупа.
- Предшественник — одноразовый `scripts/link-gamepass-order.mjs` (ручной прогон по wbCode);
  для новых случаев использовать TWA.

### Слив остатка (`DrainSection` + `api/twa/drain`)

Консолидация «хвоста» баланса донора (напр. 98 R$, которые ничем не выкупить) на аккаунт-**приёмник**
(«мой акк»): цена геймпасса на приёмнике ставится = балансу донора, донор его покупает.

- Второй cookie — `GlobalSettings.drainCookie` (+ `drainAccountName`), геймпасс приёмника —
  `drainGamepassId`. Оба задаются в блоке «⚙️ Настройка» секции «Слив остатка».
- **Автосписок геймпассов приёмника.** GET `/api/twa/drain` отдаёт `gamepasses[]` аккаунта
  приёмника (`GET apis.roblox.com/game-passes/v1/users/{userId}/game-passes?count=50` по
  `drainCookie`). В «⚙️ Настройка» под ручным вводом ID — тап-список (имя · цена · off если не
  продаётся, ✓ у выбранного); тап = `set-gamepass` с этим ID. Убирает ручной ввод и защищает
  от «подставил чужой геймпасс».
- ⚠️ **Фикс 2026-07-02:** `set-gamepass` писал `drainProductId` в `Int`-колонку, а у новых
  геймпассов ProductId > 2.1 млрд → `ValueOutOfRange` → роут падал немым 500 → в TWA «Ошибка
  сети». Теперь productId не кэшируем (берём из `product-info` при сливе), а POST-роут обёрнут
  в try/catch и возвращает текст ошибки JSON-ом вместо голого 500. `product-info` с прод-
  контейнера доступен (HTTP 200, ~0.4 c) — проблема была не в сети.
- Поток (`action: "drain"`): читаем баланс донора → меняем цену геймпасса приёмника
  (`setGamepassPrice`) → **поллим `product-info`, пока цена не подтвердится** (задержка
  распространения у Roblox) → донор покупает геймпасс той же механикой, что обычный выкуп.
- ✅ **SPIKE закрыт (верифицировано вживую 2026-07-03).** Рабочая смена цены геймпасса:
  1. геймпасс → `placeId` (GET `apis.roblox.com/game-passes/v1/game-passes/{id}/details`) →
     `universeId` (GET `apis.roblox.com/universes/v1/places/{placeId}/universe`);
  2. **`PATCH apis.roblox.com/game-passes/v1/universes/{universeId}/game-passes/{gpId}`**,
     тело — **multipart/form-data** с полями `IsForSale` + `Price` (с заглавной),
     заголовок `X-CSRF-TOKEN`, успех = **204**.
  Грабли: запись **universe-scoped** (сначала резолвим universe); тело обязано быть form-data —
  JSON / merge-patch / json-patch дают **415**; `Content-Type` руками не ставить (fetch сам
  добавит boundary); старый `POST .../game-passes/{id}/details` мёртв (теперь GET-only → 404
  на запись), как и legacy `roblox.com/game-pass/update`. `setGamepassPrice` возвращает
  `via: "universes-patch"`. Комиссия Roblox 30% и pending-заморозка робуксов на приёмнике — как
  у любой продажи геймпасса.

## Тестовые коды

9 кодов, единый `src/lib/test-codes.ts`. Сброс из Settings → «Тестовые коды»
(или `npm run dev:reset-test`). Тестовые заказы помечаются `isTest` и скрыты из списков.
