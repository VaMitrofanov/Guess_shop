# Roblox Plus buyout — поддержка скидок 10–20%

## Текущий статус на 17.07.2026

**Ручной браузерный выкуп восстановлен.** TG «📋 Скрипт» и TWA `purchase-script` выдают
скрипт, который покупает через официальный модуль страницы
`window.RobloxItemPurchase.startGamepassPurchaseFlow` вместо снятого Roblox
`economy.roblox.com/v1/purchases/products/{productId}`.

Серверная cookie-only покупка через голый HTTP остаётся невозможной, и это **не чинится
сменой URL** — см. «Почему серверный fetch не проходит». Вместо неё SG purchase-service
инъецирует текущую cookie в настоящий Chrome и вызывает официальный client flow.

**P0-инцидент 17.07:** транспорт и Chrome доступны, но production-версия TWA/Web перед
покупкой использует ту же donor-cookie с RF-сервера, а затем переносит её в Chrome на SG.
Две production-попытки дошли до purchase-service и получили `NotLoggedIn`; свежая cookie
стала `401` через две минуты после сохранения.

**Статус исправления:** P0.1–P0.3 и кодовая часть P0.4 реализованы локально, но ещё не
задеплоены. `session`, buyer-specific preflight, ownership и purchase теперь проходят через
один persistent SG Chrome; добавлены стабильные коды ошибок, безопасные structured logs и
contract-test против повторного donor-cookie egress. Production остаётся на старой версии до
поэтапного deploy и живого canary. Kill-switch автомата остаётся OFF.

## P0-инцидент: donor-cookie инвалидируется между RF preflight и SG Chrome (17.07.2026)

### Симптом и доказательства

Менеджер получил в TWA, открытой из бота: «Браузерный сервис выкупа временно недоступен.
Заказ оставлен в очереди; используй ручной скрипт». Это сообщение оказалось слишком общим:
сервис не был недоступен.

- TG-контейнер и Web через туннель получают от `/health` HTTP 200,
  `browser=true`, `queued=0`; Chrome CDP отвечает, purchase-service active.
- В журнале purchase-service есть две фактические попытки: 06:25:12 и 08:20:32 UTC. Обе
  завершились `purchased=false`, `NotLoggedIn: профиль браузера разлогинен`.
- Новая cookie была сохранена в 08:18:07 UTC. В Chrome она физически присутствовала с
  правильными domain/Secure/HttpOnly и полной длиной, но authenticated user и currency API
  уже отвечали 401. С RF та же cookie после попытки тоже отвечала 401.
- Покупка не открылась: balance delta и новое ownership отсутствуют; заказ корректно остался
  в рабочей очереди. `autoBuyoutEnabled=false`.

### Root cause

Application-level причина подтверждена кодом и последовательностью событий:

1. TWA на RF проверяет и сохраняет cookie через прямой authenticated fetch Roblox.
2. `resolveGamepassForBuyer()` и `getAuthenticatedUserId()` снова используют cookie с RF
   непосредственно перед отправкой запроса на покупку.
3. Purchase-service на SG инъецирует ту же cookie в persistent Chrome и только там вызывает
   официальный purchase flow.
4. RF-проверка обязана была пройти, иначе `/purchase` не был бы вызван; следующий SG-шаг уже
   получил 401. Canary проходил в другом режиме: cookie-инъекция и покупка выполнялись на SG,
   без RF preflight.

Следовательно, сломан не listener, туннель или CDP, а **multi-egress session flow**. Точный
закрытый алгоритм Roblox не наблюдаем, но результат согласуется с привязкой/ревокацией сессии
по IP, региону, device/HBA context или их комбинации. Исправление не должно зависеть от
угадывания конкретного сигнала: donor-cookie вообще нельзя предъявлять Roblox вне одного
persistent Chrome context.

### Немедленное ограничение до фикса

1. Оставить `autoBuyoutEnabled=false`; не запускать batch/partner buyout и не повторять
   текущую cookie — она уже невалидна.
2. Не сохранять новую funded cookie через текущий TWA/Web flow: успешное сообщение от RF
   ещё не доказывает, что сессия переживёт перенос в SG.
3. Не добавлять fallback на прямой authenticated fetch с RF или голый HTTP с SG. При
   недоступности Chrome операция должна останавливаться до Roblox-запроса.
4. Новую cookie брать только после deploy исправления. Ручной скрипт допустим лишь в уже
   авторизованном браузере менеджера и не является acceptance автоматического контура.

### План и статус реализации исправления

#### Этап P0.1 — один browser-auth контракт

**✅ Реализовано локально; deploy SG service ожидает отчёта и подтверждения владельца.**

Расширить `scripts/browser-purchase-service.mjs` двумя Bearer-auth операциями, использующими
тот же Chrome, cookie-injection и single-flight lock, что и покупка:

- `POST /session` — инъекция cookie, browser-context fetch authenticated user + currency;
  наружу только `{accountId, accountName, balance}` или стабильный error code;
- `POST /gamepass-preflight` — в том же browser context получить authenticated product-info,
  identity, balance и ownership; вернуть только нормализованные числа/флаги, необходимые
  существующим price/Plus/seller guards;
- `POST /purchase` оставить денежным шагом, но принимать `requestId`/`source` и ожидаемые
  buyer/product/seller/price. Перед кликом он повторно проверяет те же инварианты.

Все три операции проходят через один no-backlog single-flight lock. Cookie запрещено
логировать, возвращать или сохранять в service. Read-only операции тоже не должны выполняться
параллельно с покупкой: иначе один запрос может заменить cookie другого до клика.

Authenticated Roblox fetch выполнять через `page.evaluate(... credentials: "include")` в
persistent Chrome, а не через Node `fetch` даже на SG. Public product-info/thumbnail без
cookie может оставаться на текущих серверах.

#### Этап P0.2 — убрать прямой donor-cookie egress из приложения

**✅ Реализовано локально.** Мигрированы TWA account/dashboard/orders/account purchase,
partner tasks через общий buyout helper, TG manual/auto и donor-часть ручного/автослива.
Прямые cookie-запросы сохранены только для отдельного аккаунта-приёмника drain, который
управляет ценой собственного геймпасса и не использует donor-cookie.

Добавить типизированный клиент browser donor service (с зеркалом для `src/` и `bots/` либо
общим нейтральным модулем) и заменить все прямые authenticated обращения:

- TWA `roblox-account`: set-cookie, refresh и balance;
- TWA dashboard donor snapshot;
- orders: `gp-live-check`, поиск замены, `purchase-script` и `purchase`;
- Account search/batch/purchase;
- partner `purchase-task`;
- TG manual buyout и auto-worker;
- donor-часть `/api/twa/drain` и любые ownership/balance checks с `robloxCookie`.

`resolveGamepassForBuyer()`, `getAuthenticatedUserId()` и cookie-вариант ownership-check не
должны вызываться из RF/Web. После миграции либо удалить их, либо оставить только за новым
service boundary. Нужен contract-test, который падает при появлении `.ROBLOSECURITY` в
Roblox request headers вне browser service. **Никакого direct-fetch fallback:** outage
service = fail-closed, иначе fallback сам снова инвалидирует cookie.

#### Этап P0.3 — точные ошибки и наблюдаемость

**✅ Реализовано локально.** Service и клиенты используют стабильные коды; UI больше не
называет invalid cookie общей недоступностью сервиса. Логи содержат operation/source,
`requestId`, gamepass ID, code и duration, но не cookie, Bearer token или script.

Заменить regex/generic message на стабильные коды:

- `DONOR_COOKIE_INVALID` — обновить cookie после устранения причины;
- `BROWSER_SERVICE_UNAVAILABLE` — listener/tunnel/CDP;
- `BROWSER_BUSY` — single-flight занят;
- `ROBLOX_SESSION_UNAVAILABLE`, `ROBLOX_PRECHECK_UNAVAILABLE` — временный отказ Roblox;
- `WRONG_DONOR_ACCOUNT`, `TWO_STEP_REQUIRED`;
- `PRICE_GUARD`, `SELLER_GUARD`, `OWNERSHIP_GUARD`;
- `BALANCE_MISMATCH`, `BALANCE_UNCONFIRMED`.

UI показывает действие менеджеру, заказ меняет статус только по существующим fail-closed
правилам. Structured log содержит `requestId`, source, operation, gamepass ID, code,
duration, ownership/balance result, но никогда cookie/token/script. `/health` остаётся
liveness-проверкой и больше не используется как доказательство готовности donor session.
Отдельный authenticated readiness выполняется только по явной команде менеджера.

#### Этап P0.4 — тесты и deploy

**🟡 Код и локальные release-gates готовы; deploy/readiness/canary открыты.** Contract-test
проверяет запрет прямого donor-cookie egress и отсутствие cookie/script в логах. Финальный
production acceptance нельзя заменить unit-тестами: нужна новая cookie после deploy и серия
покупок ниже.

1. Unit/contract: ни один Web/TG call site не посылает donor-cookie Roblox напрямую;
   ответы service валидируются схемой; неизвестный ответ fail-closed.
2. Integration с fake service: set-cookie, full price, Plus 10/20%, invalid cookie, wrong
   account, queue busy, timeout, unsafe discount; ни один отказ не закрывает заказ.
3. Driver/service: session и preflight сериализованы с purchase; cookie A/B не смешиваются;
   401 классифицируется как `DONOR_COOKIE_INVALID`; cookie отсутствует в логах.
4. Deploy order: сначала обратно совместимый SG service, затем health/readiness из TG и Web
   через туннель, затем Web/TG consumers. Старый direct-fetch путь не оставлять fallback.
5. После deploy сохранить **новую** funded cookie. Сразу проверить `/session` дважды через
   Web/TWA и затем из purchase driver: один account ID, баланс и отсутствие 401.
6. Canary 0 — дешёвый тестовый GP: `ownership false→true`, точная balance delta, seller
   payout. Затем три реальных заказа по одному; минимум один Plus, если donor имеет Plus.
7. Только после 3/3 включить auto-buyout и наблюдать первый одиночный auto-tick. Любой 401,
   account mismatch или balance ambiguity = автомат OFF и ручная сверка.

### Acceptance и rollback

Готово, когда новая cookie ни разу не предъявляется Roblox с RF/Node, TWA save/refresh и все
buyout-пути получают identity/price/balance из одного Chrome context, а серия canary даёт
точные ownership + balance + seller payout. Rollback — выключить денежные действия и вернуть
UI в ручной script-only режим; **возврат к RF authenticated fetch не является rollback**.

### ✅ Canary на сервере пройден (17.07.2026)

Chrome на SG-сервере (Xvfb, SwiftShader, профиль прогрет ручным логином с «Trust this
device») **успешно купил геймпасс** через `startGamepassPurchaseFlow`:

```
Аккаунт:   KrytishVadim4ick (3828548511)
Пасс:      1882704092 «Перезагрузка», ProductId 3605935014
Окно:      "Buy Item · Перезагрузка · 20 · Buy"
Результат: баланс 295 → 275 R$ (−20), ownership: false → true
```

Что это доказало:

1. **Chef проходится реальным браузером.** Голый HTTP получал `blocksession:
   AutomatedTampering`, потому что не исполнял chef-скрипты вообще. Chrome их исполнил —
   и Roblox пропустил на штатную spending-верификацию.
2. **SwiftShader не мешает.** Софт-рендер на VPS без GPU chef устроил. Гипотеза «нужна
   настоящая видеокарта» **опровергнута** — GPU не нужен.
3. **Managed pricing ×6.25 не подтвердился.** `PriceInRobux=20`, `UserBasePriceInRobux=20`,
   `PriceDiscountDetails=[]`, списано ровно 20. Ранее задокументированные 125 R$ не
   воспроизвелись.
4. **CDP не палит автоматизацию.** `navigator.webdriver=false` при подключении puppeteer к
   уже запущенному Chrome: маркер ставит `--enable-automation`, а не сам CDP-порт.
5. **Страница пасса отдаёт 404** (cross-game sales выключены), но модуль покупки на ней
   всё равно грузится. Поэтому дёргаем модуль напрямую, а не ищем кнопку Buy на странице.

**Про 2SV.** На canary-аккаунте каждая покупка требовала код с почты, и галки «Trust this
device» на spending-окне НЕТ (она есть только на логине). Это свойство аккаунта с
включённой 2FA: у доноров 2FA выключена, поэтому автовыкупу это не мешает. Обратная
сторона — донор без 2FA уязвимее; размен принят владельцем.

**Cookie-инъекция доказана отдельной живой покупкой 17.07.** Чистый профиль без form-login
после `Network.setCookie` авторизовался правильным donor и купил пасс за 18 R$:
ownership `false→true`, баланс `275→257`. Поэтому выбран вариант A: существующего
`/setcookie` достаточно, логины/пароли donor в TWA и БД не добавляются.

### Почему серверный fetch не проходит

| Транспорт | Результат |
|---|---|
| Старый `economy/v1/purchases/products` | Снят Roblox 10.04.2026 (`InvalidArguments`) |
| Новый `game-passes/{productId}/purchase`, неверная цена | `200 PriceChanged` — challenge не триггерится |
| Новый endpoint, **верная** цена, голый HTTP | `403` + `rblx-challenge-type: chef` → 2SV (email-код принят) → `blocksession: AutomatedTampering` → `ApplicationError` |
| Реальный браузер, официальный модуль | ✅ покупка проходит |

Chef — проверка browser fingerprint: Roblox отдаёт `scriptIdentifiers`, которые должны быть
реально исполнены в DOM (Canvas/WebGL/navigator). Email-подтверждение fingerprint не
заменяет. Поэтому **ни один HTTP-клиент не купит пасс ни на каком URL** — нужен рендер-стек.

Официальный модуль работает потому, что ходит через httpService Roblox, который сам
добавляет HBA-подпись (`x-bound-auth-token`) и решает chef с повтором запроса.

### Где живёт логика

`src/lib/roblox-purchase-script.ts` + зеркало `bots/shared/roblox-purchase-script.ts` —
единый билдер скрипта покупки (`bots/` и `src/` не импортируют друг друга, менять
синхронно). Тот же текст скрипта предназначен и для `page.evaluate()` headless-Chrome:
транспорт меняется, скрипт — нет.

Гарды в скрипте дублируют серверные намеренно:

- **[ЦЕНА-СТОП]** — зашита server-resolved buyer-price поверх проверенной base-price
  `ceil(amount / 0.7)`: заранее скопированный скрипт не купит подорожавший пасс, а typed
  Roblox Plus безопасно использует свою 10/20% цену;
- **[ПРОДАВЕЦ-СТОП]** — новый purchase API принимает в теле только `expectedPrice`, поэтому
  Roblox больше **не сверяет продавца** на своей стороне. Раньше это делал
  `expectedSellerId` в economy v1. Теперь проверка только наша;
- **[АККАУНТ-СТОП]** — скрипт откажется покупать, если в браузере залогинен не донор;
- **[ПАСС-СТОП]** — ProductId сменился;
- ownership-precheck — не покупать второй раз.

В скрипт подставляются **только числа**. Имя пасса и ник продавца задаёт клиент, поэтому
они читаются из product-info в рантайме — иначе кавычка в названии пасса стала бы инъекцией
в консоль менеджера.

**Попутный фикс:** в TG-скрипт зашивалась live-цена — гард `Ш2` из PLAN-gp-price-guard
доехал только до TWA. Это тот же сценарий, что инцидент 12.07 (выкуп за 1143 вместо 715).
Закрыто.

## Что подтверждено

Roblox Plus уменьшает фактическую цену покупателя на 10%, а с третьего месяца — на 20%.
Roblox субсидирует скидку, поэтому creator earnings считаются от полной цены. Источник
истины для конкретного пасса — authenticated `PriceDiscountDetails`, а не legacy Premium
membership flag.

Официальные источники:

- https://create.roblox.com/docs/production/monetization/roblox-plus
- https://create.roblox.com/docs/production/monetization/passes
- https://devforum.roblox.com/t/disabling-cross-game-sales-of-passes-and-dev-products-and-introducing-the-transfers-api/4618396
- https://devforum.roblox.com/t/official-list-of-deprecated-web-endpoints/62889/118

Production-аудит всех 12 старых `ERROR/REGIONAL_PRICE` показал:

- 12/12 имеют ровно один detail `RobloxPlusSubscription:10`;
- base-price совпадает с `ceil(order.amount/0.7)`;
- buyer-price равна `base - floor(base × 10%)`;
- все пассы On Sale, seller совпадает, reuse/ownership не обнаружены;
- суммарно: base 19 721 R$, ожидаемое Plus-списание 17 758 R$, скидка 1 963 R$.

Первичная классификация этих заказов как Regional Pricing была неверной. Она исправлена,
но корректная цена ещё не означает наличие поддерживаемого серверного transport.

## Классификация цены

Пасс считается `ROBLOX_PLUS`, только если одновременно:

1. `UserBasePriceInRobux` валидна и совпадает с номиналом заказа (допуск ±2 R$);
2. `PriceDiscountDetails` содержит ровно один detail;
3. `Type=RobloxPlusSubscription`;
4. `Percent` равен 10 или 20;
5. `AmountInRobux=floor(base × percent / 100)`;
6. `PriceInRobux=base-AmountInRobux`.

Остальные расхождения buyer/base остаются `UNSAFE_DISCOUNT` и fail-closed. Клиентские
`productId`, seller, price и discount type никогда не являются источником истины.

## Пачка и бухгалтерия

- правильность номинала проверяется по base-price;
- доступность пачки считается по live buyer-price;
- UI показывает base, процент Plus и ожидаемое списание;
- после результата бюджет уменьшается только на подтверждённый `chargedPrice`;
- `purchaseRobuxAmount` записывается только после подтверждённой покупки;
- ожидаемый creator payout остаётся равным номиналу заказа.

Эта часть готова для Plus 10% и 20% и покрыта unit-тестами, включая неверную арифметику,
unknown/mixed details и округление вниз.

## Результат реального canary

С разрешения владельца штатная кнопка `purchase` была вызвана для одного заказа на 2 000 R$.
Preflight: base 2 858 R$, buyer 2 573 R$, Plus 10%, продавец совпал, пасс On Sale, donor не
владел пассом, баланс 20 000 R$.

Проверены два варианта transport:

1. legacy `POST /v1/purchases/products/{productId}` с base-price и buyer-price — Roblox
   вернул `PriceChanged`;
2. `POST /v2/user-products/{productId}/purchase` — Roblox вернул HTTP 404 с пустой ошибкой.

После каждой попытки баланс оставался 20 000 R$, ownership не появилось, заказ не был
закрыт, purchase snapshots не записаны. Остальные 11 заказов намеренно не отправлялись.

Официальная документация pass указывает `MarketplaceService:PromptGamePassPurchase`
внутри originating experience и Store/EDP как поддерживаемые способы покупки. Начиная с
30.05.2026 cross-game pass sales отключены. Cookie-only Economy API для покупки Plus-pass
Roblox не документирует. Следовательно, `/v2/user-products` не является заменой pass
endpoint, а дальнейший перебор guessed endpoint на реальных заказах запрещён.

## Удаление legacy purchase endpoint (16.07.2026)

Roblox официально объявил удаление
`POST https://economy.roblox.com/v1/purchases/products/{productId}` с 10.04.2026 и указал
in-experience purchase API как путь миграции. Живые non-Plus попытки теперь возвращают
старый ответ `InvalidArguments` / `Invalid arguments.`. Поэтому корректные On Sale GP с
верной ценой и продавцом ошибочно попадали в `ERROR`: приложение считало infrastructure
refusal проблемой строки.

Фикс 16.07:

- `InvalidArguments` / `Invalid Parameter` → внутренний `LEGACY_PURCHASE_FLOW`;
- retail TWA не переводит заказ в `ERROR` и не ставит `buyoutErrorCode`;
- partner task возвращается в `READY`, без красного write-back в Google;
- auto-buyout возвращает claim в `PENDING` и делает паузу 60 минут после первого отказа;
- чистый отказ не запускает лишний ownership retry.

## Текущее production-поведение

Операционное уточнение 14.07: по решению владельца 12 пригодных заказов были вручную
возвращены из `ERROR` в `PENDING` без попытки покупки. Геймпассы и источники сохранены,
активные коды ошибки очищены. Это восстановление очереди, а не снятие transport-блокировки:
до смены donor/client-flow повторный cookie-only purchase Plus-пасса останется fail-closed.

- non-Plus legacy flow больше не считается рабочим: endpoint удалён;
- typed Plus продолжает участвовать в фильтре и расчёте Account-пачки;
- на этапе покупки TWA, Account, partners, TG manual/script и auto-buyout возвращают
  `ROBLOX_PLUS_FLOW` без purchase POST; order-flow сохраняет заказ как `ERROR` с этим
  кодом, а партнёрская задача остаётся `READY`;
- unknown/regional price остаётся `REGIONAL_PRICE`; transport refusal оставляет заказ в
  рабочей очереди с `LEGACY_PURCHASE_FLOW` только в API-ответе;
- batch продолжает обработку других допустимых non-Plus заказов, Plus-заказы остаются в
  очереди/фильтре ошибок с понятной причиной;
- balance, ownership recovery и seller/price guards остаются обязательными.

Drain не является способом обхода: он сохраняет legacy v1 и не используется для выплаты
Plus-заказов.

## Исследование нового purchase endpoint (16.07.2026)

### Обнаруженный endpoint

```
POST https://apis.roblox.com/game-passes/v1/game-passes/{gamepassId}/purchase
Content-Type: application/json
Cookie: .ROBLOSECURITY=<cookie>
x-csrf-token: <token>

{"expectedCurrency":1,"expectedPrice":<price>,"expectedSellerId":<id|null>}
```

Ответ (PriceChanged / purchased / challenge):
```json
{
  "purchased": false,
  "reason": "PriceChanged",
  "productId": 1882704092,
  "price": 125,
  "expectedPrice": 999999,
  "balanceAfterSale": 170,
  "currency": 1
}
```

Источник: DevForum (тема FraudCheckBlock, апрель 2026), подтверждён живым тестом.

### Отличия от старого endpoint

| | Старый (мёртв с 10.04.2026) | Новый (жив) |
|---|---|---|
| URL | `economy.roblox.com/v1/purchases/products/{productId}` | `apis.roblox.com/game-passes/v1/game-passes/{gamepassId}/purchase` |
| Идентификатор | productId (из product-info) | gamepassId (прямой) |
| expectedSellerId | обязательный | может быть null |
| CSRF | из `auth.roblox.com/v2/logout` | из 403 самого target endpoint (v2 скрипта) или `auth.roblox.com/v1/authentication-ticket` |

### Тесты и результаты (16.07.2026)

**Тест 1 — Проверка endpoint без авторизации (SG-сервер, curl):**
- `GET /game-passes/1882704092/purchase` → HTTP 404 (ожидаемо, только POST)
- `POST /game-passes/1882704092/purchase` без cookie → HTTP 403 `"XSRF token invalid"`
- **Вывод:** endpoint существует и принимает POST

**Тест 2 — Product-info для 1882704092 (SG-сервер, curl):**
- HTTP 200, `IsForSale: true`, `PriceInRobux: 20`, `ProductId: 3605935014`
- Продавец: GamerBuilderNe0n (9093114547), 0 продаж
- **Вывод:** пасс доступен для покупки через API, несмотря на "Unavailable" на EDP

**Тест 3 — Dry-run с авторизацией (аккаунт KrytishVadim4ick, Node.js):**
- T1 Auth: 200 ✓ (id: 3828548511)
- T2 Balance: 295 R$ ✓
- T3 Product-info: 20 R$, IsForSale: true ✓
- T4 НОВЫЙ endpoint (price=999999): HTTP 200, `reason: "PriceChanged"`, `price: 125`
  - **Endpoint РАБОТАЕТ** — принял cookie, вернул реальную buyer-specific цену
  - Цена 125 R$ ≠ base 20 R$ → managed/regional pricing для RU-аккаунта
- T5 СТАРЫЙ endpoint: HTTP 403, `"Challenge is required to authorize the request"`
  - **Старый endpoint НЕ мёртв** для этого аккаунта — требует challenge, не InvalidArguments
- T6 Ownership: false (не владеет) ✓
- **Вывод:** оба endpoint живы, но требуют разные формы challenge при правильной цене

**Тест 4 — Попытка покупки с правильной ценой (KrytishVadim4ick, price=125):**
- HTTP 403, `{"purchased": false, "productId": 1882704092}`
- Challenge headers:
  - `rblx-challenge-id: us-central-9c557d4f-...`
  - `rblx-challenge-type: chef`
  - `rblx-challenge-metadata`: base64 JSON с scriptIdentifiers
- Roblox отправил email: "Мы заметили попытку потратить Robux с аккаунта KrytishVadim4ick"
  - IP: SG-сервер (Singapore), адрес — в HANDOFF
  - Устройство: Phone (Android) — из User-Agent
- **Вывод:** при совпадении цены endpoint возвращает spending verification challenge
  типа "chef" — это anti-fraud проверка, НЕ визуальная CAPTCHA, а email-подтверждение
  новому устройству/IP

**Тест 5 — Кука донора yqf987159 (свежая, 16.07, с локальной машины РФ):**
- T1 Auth: 200 ✓ (id: 11295557875, name: yqf987159)
- T2 Balance: 15 061 R$ ✓
- T3 Product-info: 20 R$, IsForSale: true, seller: GamerBuilderNe0n (9093114547) ✓
- T4 НОВЫЙ endpoint (price=999999): **HTTP 401** `"User is not authenticated"` (code 9002)
  - CSRF через auth-ticket вернул 401 (без токена)
  - Retry после 403 (с CSRF из 403) → снова 401
- T5 СТАРЫЙ endpoint: **HTTP 401** `"User is not authenticated"` (code 9002)
- T6 Ownership: false ✓
- **Вывод:** GET-запросы работают (cookie жива), POST к purchase endpoints отклоняются
  с 401 — предположительно Roblox блокирует API-вызовы с российских IP для POST-операций.
  Необходимо запустить тест с SG-сервера, где Roblox полностью доступен.

**Тест 5b — Скрипт: `scripts/test-new-purchase-endpoint.mjs` (v2)**
- Обновлён: убрана отдельная getCsrf() → CSRF берётся из 403 самого target endpoint
- Добавлены Origin/Referer в POST-запросы
- Добавлен вывод challenge headers (rblx-challenge-type/id/metadata)
- Загружен на SG-сервер: `/tmp/test-purchase.mjs`
- **Статус: ожидает запуска с SG-сервера**

**Тест 6 — Dry-run KrytishVadim4ick на SG-сервере (16.07, новая кука):**
- T1 Auth: 200 ✓ (id: 3828548511, name: KrytishVadim4ick)
- T2 Balance: 295 R$ ✓
- T3 Product-info: "Перезагрузка", 20 R$ base, IsForSale: true ✓
- T4 НОВЫЙ endpoint (price=999999): **HTTP 200**, `reason: "PriceChanged"`, `price: 125`
  - **УСПЕХ:** POST прошёл без challenge! CSRF из 403 → retry 200
  - buyer price = 125 R$ (managed pricing ×6.25), balanceAfterSale: 170
- T5 СТАРЫЙ endpoint: HTTP 403, challenge `twostepverification`
  - metadata: actionType=Generic, eligibleMethods=[] (тупик — нет 2FA методов)
  - requestPath: `/v1/purchases/products/{productId}`
- T6 Ownership: false ✓
- **Вывод:** новый endpoint работает на SG без challenge для dry-run (неправильная цена).
  Старый endpoint требует twostepverification (не chef и не InvalidArguments).

**Тест 7 — РЕАЛЬНАЯ покупка KrytishVadim4ick на SG (16.07, price=125):**
- Price discovery: HTTP 200, price=125 R$ ✓ (без challenge)
- Покупка (price=125, sellerId=9093114547): **HTTP 403**
  - `{"purchased": false, "productId": 1882704092}`
  - challenge-type: **`chef`**
  - challenge-id: `us-central-2edf3ef4-4219-4c6e-947a-fb658ffe3a34`
  - challenge-metadata: `contentInlineBase64: "(() => {})()"`,
    scriptIdentifiers: 2 UUID, eligibleMethods: [], expectedSymbols: []
- Post-purchase: баланс 295 → 295 (delta=0), ownership=false
- **Вывод: ПОКУПКА НЕ ПРОШЛА.** Chef challenge триггерится только при правильной цене
  (когда Roblox реально собирается списать робуксы). Dry-run с неправильной ценой проходит
  без challenge. Это поведение одинаково и с РФ, и с SG — challenge привязан к аккаунту,
  не к IP.

### Итоговая картина purchase flow (16.07.2026)

```
POST /game-passes/{id}/purchase
├─ неправильная цена → 200 PriceChanged (без challenge)
├─ правильная цена, голый HTTP → 403 chef challenge (нет DOM → тупик)
└─ правильная цена, реальный браузер → chef решается нативно JS → purchased: true

POST /v1/purchases/products/{productId} (старый)
└─ любая цена → 403 twostepverification / InvalidArguments (endpoint мёртв)
```

**Chef challenge** требует реальный браузер: Roblox отдаёт scriptIdentifiers (JS-скрипты),
браузер скачивает и выполняет их (browser fingerprint + proof-of-work), результат отправляется
на `/challenge/v1/continue`. Без DOM (Canvas, WebGL, navigator) challenge не решается.

**Тест 8 — Chained challenge с email-кодом (SG, 16.07):**
1. Purchase (price=125) → 403, chef challenge `us-central-582b0071...`
2. `challenge/v1/continue` (chef, пустой metadata) → **200**, вернул twostepverification
   с inner challengeId `7ba382c7...`
3. `twostepverification/email/verify` (code=805978) → **200**, `verificationToken: "sKIHnJMOk0ymVX6TdUytxA"` — **EMAIL КОД РАБОТАЕТ**
4. `challenge/v1/continue` (twostepverification, с verificationToken) → **200**, но вернул
   НОВЫЙ challenge: `blocksession`, body: `Denied.AutomatedTampering.Body`
5. Retry purchase с challenge headers → **200**, `purchased: false`, `reason: ApplicationError`,
   `errorMsg: "An error occured while processing this transaction"`
6. Баланс: 295 → 295 (delta=0), ownership: false

**Вывод:** Roblox обнаруживает, что chef-скрипты не были реально выполнены в браузере
(пустой metadata → нет browser fingerprint → AutomatedTampering). Третий уровень challenge
`blocksession` блокирует транзакцию даже после успешной email-верификации.

Полная цепочка challenge (16.07.2026):
```
Purchase(price=correct) → 403 chef
  → continue(chef, empty) → 200 twostepverification
    → email/verify(code) → 200 verificationToken ✓
      → continue(2sv, token) → 200 blocksession(AutomatedTampering)
        → retry purchase → ApplicationError
```

**Итог исследования:** голый HTTP не является транспортом покупки. Рабочий путь —
официальный purchase module в реальном, заранее прогретом Chrome; текущий runbook ниже.

---

## Browser purchase transport на SG-сервере

Canary 17.07 подтвердил: headless и stealth-plugin не нужны; работает headful настоящий
Google Chrome под Xvfb. Chromium/Chrome for Testing не подходят, поскольку не отдают бренд
`Google Chrome`; голый `page.evaluate(fetch)` chef не решает. `puppeteer.launch()` добавляет
`--enable-automation`, поэтому driver подключается через `connect` к уже запущенному Chrome.
SwiftShader на VPS допустим.

### Почему Puppeteer, а не голый HTTP

| Подход | Результат тестов 16.07 |
|--------|----------------------|
| HTTP + правильная цена | 403 chef → продолжение → 2SV email ✓ → **blocksession AutomatedTampering** → ApplicationError |
| HTTP + неправильная цена | 200 PriceChanged (challenge не триггерится) |
| Реальный Chrome + официальный модуль | Chef решается штатно → canary успешно купил пасс |

Roblox проверяет наличие реального browser fingerprint (Canvas, WebGL, navigator) через
chef scriptIdentifiers. Без них любой HTTP-клиент ловит `blocksession` даже после
успешной email-верификации.

### Реализованный browser runbook

```
TG/TWA/auto → buildGamepassPurchaseScript → purchase-service (Bearer, single-flight)
                                             ↓ Network.setCookie
                                  настоящий Chrome → официальный Roblox purchase flow
ручной «📋 Скрипт» ──────────────────────────────────────────────┘
```

Используется реальный Google Chrome с постоянным профилем, запущенный заранее.
`puppeteer-core` подключается по CDP и не добавляет `--enable-automation`. Service получает
cookie из защищённого server-to-server запроса, не логирует и не пишет её в отдельное
хранилище, а инъецирует в изолированный Chrome profile
перед каждой покупкой. На SG он слушает только docker bridge; Web/TWA на RF ходит через
ограниченный SSH-туннель. Пароли нигде не появляются.

| Инструмент | Назначение |
|---|---|
| `scripts/browser-buyout-session.sh` | Поднимает/останавливает Chrome с постоянным профилем и локальным VNC/CDP; вход выполняется формой Roblox. |
| `scripts/browser-buyout-probe.mjs` | Read-only диагностика: проверяет загруженный purchase module, `webdriver`, бренды браузера и WebGL. Ничего не покупает и не посылает POST. |
| `scripts/browser-buy-gamepass.mjs` | Принимает JSON со скриптом, открывает официальный purchase modal и подтверждает результат только по ownership и балансу. |
| `scripts/browser-purchase-service.mjs` | Bearer-auth HTTP bridge: `/session`, `/gamepass-preflight`, `/purchase`, cookie-инъекция через CDP и общий no-backlog single-flight. |
| `infra/systemd/roblox-purchase-*.service` | Автозапуск SG service и постоянного RF→SG SSH-туннеля. |
| `src/lib/roblox-purchase-script.ts` и `bots/shared/roblox-purchase-script.ts` | Зеркальные билдеры ручного скрипта с [ЦЕНА-СТОП], [ПРОДАВЕЦ-СТОП], [АККАУНТ-СТОП] и ownership-precheck. |

**Текущий production-контур:** host service, Chrome и туннель запущены, env Web/TG настроены,
но runtime health проверяет только listener/CDP. Production-попытки 17.07 выявили
multi-egress invalidation cookie. Исправление P0.1–P0.4 готово локально, но production ещё
не обновлён; поэтому TWA/Web buyout не готов к новой funded cookie до deploy и canary.
Автовыкуп kill-switch остаётся OFF. Заказы при отказе остаются в очереди.

### Что осталось до автоматизации

1. После отчёта владельцу задеплоить обратно совместимый SG service, проверить новые
   `/session` и `/gamepass-preflight`, затем задеплоить Web и TG consumers. До этого не
   сохранять funded cookie через TWA/Web и не считать `/health` acceptance-проверкой.
2. После deploy сохранить новую funded cookie без 2FA и провести три последовательных canary
   с проверкой ownership, seller payout и
   точной balance delta; если donor имеет Plus, один canary обязательно Plus.
3. Только после 3/3 включить `autoBuyoutEnabled`; при любом отказе — стоп и ручной режим.
4. После включения проверить первый auto-tick: заказ `COMPLETED`, баланс уменьшился на точную
   buyer-price, клиент получил сообщение, а каждый `ADMIN_IDS` — карточку выкупа.

### Риски и митигация

| Риск | Состояние | Митигация |
|------|-----------|-----------|
| Chef/fingerprint | Подтверждён для голого HTTP | Использовать только реальный предварительно прогретый Chrome; HTTP не ретраить. |
| 2FA при покупке | Возможен у отдельных аккаунтов | Ручной код почты; до отдельного решения такой аккаунт не подходит для автоматизации. |
| EDP `Unavailable` | Подтверждён | Модуль покупки может быть загружен без видимой кнопки; драйвер вызывает только официальный module. |
| Подмена цены/продавца | Высокий | Серверные и browser-гарды, confirmation ownership; не использовать live-цену. |
| Компрометация donor | Высокий | Профиль изолирован, доступ только по локальному VNC/CDP через SSH; автоматизация требует решения владельца. |

---

**Тест 5c — Кука донора yqf987159 на SG (16.07, ~30 мин после Теста 5):**
- T1 Auth: **401** `"User is not authenticated"` — кука мертва
- Проверка curl (SG): 401
- Проверка curl (локально): 401
- **Вывод:** кука донора инвалидирована Roblox. Вероятная причина — неудачные POST-запросы
  к purchase endpoints с нетипичного IP (РФ) в Тесте 5 триггернули security revocation.
  Между Тестом 5 (GET работал, POST 401) и Тестом 5c (GET тоже 401) прошло ~30 минут.
  **КРИТИЧНО:** неудачные POST к purchase/auth endpoints с заблокированного IP могут убивать cookie.
  Все дальнейшие тесты — ТОЛЬКО с SG-сервера, никаких POST с российских IP.

### Расшифровка challenge metadata

```json
{
  "userId": "3828548511",
  "challengeId": "us-central-9c557d4f-3b9e-4478-955a-1f68e1ee776c",
  "contentInlineBase64": "(() => {})()",
  "sharedParameters": {
    "shouldAnalyze": false,
    "eligibleMethods": [],
    "renderNativeChallenge": false
  },
  "scriptIdentifiers": [
    "337f84df-3dd7-4011-bd89-91eab4601c5a",
    "deccb867-f0b2-4d01-9d0a-a0108327a645"
  ]
}
```

Challenge "chef" — proof-of-work / browser fingerprint проверка. В реальном браузере
Roblox.com решает её автоматически через JS. При голых HTTP-запросах (curl/fetch) challenge
не решается → email-верификация → 403.

### Managed/Regional Pricing

> ⚠️ **ОПРОВЕРГНУТО 17.07.** Вывод «×6.25 для RU-аккаунта» не воспроизвёлся. На том же
> аккаунте и том же пассе authenticated product-info вернул `PriceInRobux=20`,
> `UserBasePriceInRobux=20`, `PriceDiscountDetails=[]`, окно покупки показало 20, списано
> ровно 20 R$. Ручные покупки донора 16.07 тоже прошли по base (`500→715`, `1200→1715`).
> Природа разовых 125 R$ в тестах 4/6/7 осталась невыясненной — возможно, price из
> purchase-endpoint при заведомо неверной цене не равен реальной цене списания.
> Прайс-гард остаётся fail-closed, поэтому риск переплаты закрыт независимо от причины.

Ниже — исходный (неподтверждённый) вывод.

Product-info показывает base price (20 R$), но purchase endpoint для RU-аккаунта возвращает
buyer-specific price (125 R$) — managed pricing с множителем ~6.25x. Web-интерфейс
roblox.com показывает base price (20 R$), фактическое списание — buyer price. Для
корректного выкупа необходим price discovery через dry-run purchase (expectedPrice=1 →
PriceChanged → реальная buyer price).

### Выбор решения

> ✅ Рабочий путь подтверждён 17.07: реальный persistent Chrome и официальный purchase
> module. Отдельный canary доказал, что валидная `.ROBLOSECURITY`, инъецированная через CDP,
> авторизует тот же Chrome и позволяет покупку; постоянный формовый login donor не требуется.
> VNC/form-login остаётся recovery-инструментом. Challenge solver не понадобился.

| # | Вариант | Описание | Блокер |
|---|---------|----------|--------|
| A | **Browser driver** | Подключиться к прогретому реальному Chrome и вызвать официальный purchase module. | Автоматизация требует отдельного решения владельца. |
| B | **Ручной browser-скрипт** | TG/TWA выдают скрипт для уже залогиненного браузера менеджера. | Рабочий текущий режим, без batch/auto. |
| C | **Challenge solver** | Программно решить chef challenge через `/challenge/v1/continue` | Требует reverse-engineering JS challenge scripts |
| D | **Доверенное устройство** | Формовый логин в реальном браузере и подтверждение устройства. | Recovery/диагностика, не основной donor-контракт. |

Решение владельца: вариант A реализован через закрытый SG service; вариант B остаётся
ручным fallback. Donor-cookie хранится как раньше, но проверяется и используется только
внутри SG Chrome — никакого параллельного authenticated RF/Node-контура.

### Ручной режим

Не инъецировать `.ROBLOSECURITY`: такая сессия не регистрирует HBA-ключ. Войти формой,
открыть страницу game-pass и запустить выданный TG/TWA скрипт; скрипт сам проверит аккаунт,
цену, продавца, ProductId и ownership. Успех фиксируется только подтверждением ownership и
изменением баланса.

## Повторная проверка заказа 1882704092 (16.07.2026, ранее)

По запросу владельца проведена отдельная read-only проверка в авторизованной браузерной
сессии с включённым VPN. Тестовый аккаунт был принят как donor; реальные Robux не
списывались.

- Для владельца пасса найден originating experience `GamerBuilderNe0n's Place`
  (root place `99634888562525`).
- На странице experience Roblox показывает отключённую кнопку `Unavailable`.
- После открытия вкладки `Store` карточки товаров и кнопки покупки отсутствуют.
- Прямая веб-ссылка `/game-pass/1882704092` в этой сессии возвращает `404 Page Not Found`.
- Возрастная проверка и сетевой доступ не объясняют отказ: аккаунт авторизован, VPN
  устраняет сетевую ошибку, но EDP/Store остаются без purchase control.
- Ранее тот же пасс через legacy Economy API возвращал `InvalidArguments`; баланс и
  ownership не менялись. Перебор POST из консоли или обход `Unavailable` не является
  поддерживаемым Roblox client flow и в систему не добавляется.
- **Обновление:** новый purchase endpoint (`game-passes/{id}/purchase`) ВИДИТ пасс как
  IsForSale=true и принимает покупку (до challenge). EDP "Unavailable" — это ограничение
  веб-интерфейса (cross-game sales отключены), а не API.

Итог: пасс технически выкупаем через новый API endpoint. Блокер — anti-fraud challenge
(spending verification), решаемый через браузерную автоматизацию или доверенное устройство.

## Критерии готовности Plus-покупки

- есть официальный, документированный или подтверждённый Roblox client flow;
- canary подтверждён ответом, balance delta и ownership;
- продавец подтверждает полный creator payout;
- минимум три одиночных успешных canary до batch/auto-buyout;
- rollback, мониторинг и runbook синхронизированы;
- только после этого снимается `ROBLOX_PLUS_FLOW`.
