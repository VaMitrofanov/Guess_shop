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
`WbOrder + WbCode`, аудит в `adminNote`, уведомление новому юзеру).

Все действия, кроме `create-avito` и `search-users`, требуют `orderId` — guard стоит после этих
двух блоков. **Не добавлять безордерные action'ы ниже guard'а**: клиент получит 400
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

### Слив остатка (`DrainSection` + `api/twa/drain`)

Консолидация «хвоста» баланса донора (напр. 98 R$, которые ничем не выкупить) на аккаунт-**приёмник**
(«мой акк»): цена геймпасса на приёмнике ставится = балансу донора, донор его покупает.

- Второй cookie — `GlobalSettings.drainCookie` (+ `drainAccountName`), геймпасс приёмника —
  `drainGamepassId`/`drainProductId`. Оба задаются в блоке «⚙️ Настройка» секции «Слив остатка».
- Поток (`action: "drain"`): читаем баланс донора → меняем цену геймпасса приёмника
  (`setGamepassPrice`) → **поллим `product-info`, пока цена не подтвердится** (задержка
  распространения у Roblox) → донор покупает геймпасс той же механикой, что обычный выкуп.
- ⚠️ **SPIKE не завершён:** точный эндпоинт смены цены не верифицирован вживую (не было
  `drainCookie`). `setGamepassPrice` пробует `POST apis.roblox.com/game-passes/v1/game-passes/{id}/details`,
  затем legacy `POST roblox.com/game-pass/update`. После первого реального слива — оставить
  рабочую ветку, вторую удалить. Роут возвращает `via` (какой эндпоинт сработал).

## Тестовые коды

9 кодов, единый `src/lib/test-codes.ts`. Сброс из Settings → «Тестовые коды»
(или `npm run dev:reset-test`). Тестовые заказы помечаются `isTest` и скрыты из списков.
