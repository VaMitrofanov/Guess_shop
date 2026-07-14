# Roblox Plus buyout — план поддержки скидок 10–20%

Статус: **реализовано в коде; production-приёмка реальным выкупом выполняется отдельно**.

## Решение владельца и цель

Roblox Plus уменьшает фактическое списание покупателя на 10%, а с третьего месяца
подписки — на 20%. Roblox субсидирует разницу: продавец должен получить столько же, сколько
при покупке по полной цене. Цель RobloxBank — корректно отличать Plus-скидку от
Regional/Managed Pricing, считать доступную пачку по реальному списанию donor и проводить
покупку только через подтверждённый Roblox-flow.

Официальные источники:

- https://create.roblox.com/docs/production/monetization/roblox-plus
- https://create.roblox.com/docs/production/monetization/regional-pricing

## Подтверждённые факты 14.07.2026

1. У всех 12 заказов, ранее классифицированных как `REGIONAL_PRICE`, buyer product-info
   содержит единственный discount detail:
   `Type=RobloxPlusSubscription`, `Percent=10`. Базовая цена каждого пасса совпадает с
   `ceil(amount/0.7)`; buyer-price равна base минус `AmountInRobux`.
2. Legacy endpoint `premiumfeatures/.../validate-membership` на donor возвращает `true`,
   но этот флаг недостаточен: Premium и Plus — разные подписки, а размер Plus-скидки со
   временем меняется. Источник истины для конкретной покупки — `PriceDiscountDetails`.
3. Контрольный заказ на 2 000 R$ прошёл preflight: base 2 858 R$, buyer 2 573 R$,
   `RobloxPlusSubscription:10`, продавец совпал, пасс On Sale, владения не было.
4. После деплоя scoped admin override commit `3c32e03` legacy
   `POST economy.roblox.com/v1/purchases/products/{productId}` получил `PriceChanged` даже
   с `expectedPrice=2573`. Баланс не изменился, владение не появилось, заказ остался
   `ERROR/REGIONAL_PRICE`. Значит, снятия локального стопа недостаточно.

Transport-аудит нашёл штатный Economy API v2 для User Product:
`POST /v2/user-products/{productId}/purchase`. Он принимает тот же серверно вычисленный
`expectedPrice`, но, в отличие от legacy v1, является актуальным путём для buyer-specific
цены. Все cookie-пути RobloxBank переведены на v2; успех всё равно подтверждается ответом,
balance и ownership recovery, а не одним HTTP 200.

## Целевая классификация цены

Для каждого пасса непосредственно перед включением в пачку и ещё раз перед POST сохраняем:

- `basePrice = UserBasePriceInRobux` — цена продавца и база проверки номинала;
- `buyerPrice = PriceInRobux` — фактическое ожидаемое списание donor;
- `discountDetails = PriceDiscountDetails[]` — происхождение и величина скидок.

Пасс считается **Plus-safe**, только если одновременно:

1. `basePrice` совпадает с `ceil(order.amount/0.7)` с текущим допуском ±2 R$;
2. пасс On Sale, seller совпадает с подтверждённым ником, donor ещё не владеет им;
3. `buyerPrice = basePrice - AmountInRobux`;
4. есть ровно один detail с `Type=RobloxPlusSubscription`;
5. процент равен 10 или 20, а `AmountInRobux = floor(basePrice × percent / 100)`.

`PriceInRobux != UserBasePriceInRobux` без доказанного Plus-detail, смешанный набор скидок
или неизвестный `Type` остаётся fail-closed как `UNSUPPORTED_BUYER_PRICE`, а не автоматически
как Regional Pricing. Это защищает от региональной цены, экспериментов Roblox и новых типов
скидок.

## Формула фильтра и пачки

- Правильность заказа проверяется по `basePrice`, не по цене списания.
- Стоимость для баланса и доступной пачки — `buyerPrice`, полученная live; не `base × 0.9`.
- Ожидаемая выплата продавцу остаётся `order.amount`, потому что Plus-скидку субсидирует
  Roblox.
- В UI показываем три величины: `база / скидка Plus / спишется` и ожидаемый чистый Robux.
- `WbOrder.purchaseRobuxAmount` хранит фактически списанную buyer-price.
- В item отчёта `PurchaseBatch.gross` теперь передаётся фактически списанная buyer-price;
  полная база остаётся воспроизводима из номинала заказа и `purchaseRobuxAmount` в заказе.
- Пачка пересчитывается после каждого результата по свежему балансу и свежим
  `PriceDiscountDetails`: подписка может перейти с 10% на 20%, закончиться или изменить
  eligibility между открытием TWA и покупкой.

## Этапы реализации

### P0. Поддерживаемый transport для Plus-покупки — реализовано

1. Legacy v1 и scoped override проверены на `ANZW2M9`: `PriceChanged`, 0 списания.
2. Канонический cookie transport переведён на Economy API
   `POST /v2/user-products/{productId}/purchase` с `expectedCurrency`, свежей buyer-price и
   server-resolved seller ID.
3. Scoped `PAYOUT_EXPERIMENT` удалён: обычная админская кнопка и batch используют один код.
4. После неясного ответа остаётся обязательная ownership recovery; чистый `PriceChanged`
   успехом не считается.

### P0. Контракт цены и тесты — реализовано

1. `ResolvedGamepass` / bot `GamepassProductInfo` расширены типизированным
   `discountDetails` и вычисляемой классификацией `NONE | ROBLOX_PLUS | UNSUPPORTED`.
2. `classifyBuyerPrice()` различает `FULL_PRICE | ROBLOX_PLUS | UNSAFE_DISCOUNT`;
   legacy `hasRegionalPrice()` делегирует классификатору и не блокирует typed Plus.
3. Unit-тесты покрывают Plus 10/20, округление вниз, unknown/mixed detail и неверную
   арифметику; production fixture обезличен.

### P0. Все денежные пути — реализовано

Контракт подключён ко всем путям:

- TWA `orders/purchase` и Account batch;
- `roblox-account/purchase` и drain;
- партнёрский `purchase-task`;
- TG admin purchase/script;
- auto-buyout.

Ни один основной путь не принимает `productId`, seller, buyer-price или discount type из клиента как
источник истины. Перед POST — свежий official product-info с cookie; после любой неясной
ошибки — ownership recovery. `PriceChanged` не переводит заказ в COMPLETED и не уменьшает
виртуальный баланс.

### P1. TWA и наблюдаемость — частично реализовано

- `gp-live-check` читает product-info именно с cookie donor. Строка заказа показывает
  base, Plus 10/20 и ожидаемое списание; unknown buyer-price помечается стопом.
- Account-пачка оптимизируется по live buyer-price и после каждого результата уменьшает
  бюджет на `chargedPrice`, а не на полную базу.
- Старые `ERROR/REGIONAL_PRICE` снова видимы в стандартной очереди: сервер классифицирует
  их заново непосредственно перед покупкой и очищает ошибку только для безопасного Plus.
- Метрики: попытки/успехи/PriceChanged по transport и discount percent, balance delta,
  ownership recovered, экономия пачки. Секреты и payload/token в логах запрещены.

## Rollout и rollback

Отдельный env-режим не введён: allowlist классификатора сам является fail-closed гейтом.
Полный rollback — вернуть transport на v1 и typed Plus снова трактовать как unsafe;
это не требует миграции БД.

Порядок production-приёмки:

1. сверка ERROR-хвоста с `RobloxPlusSubscription:10`;
2. один согласованный реальный заказ, auto-buyout выключен;
4. подтверждение продавца: пришёл полный номинал;
5. ещё две одиночные покупки; только потом Account batch;
6. auto-buyout — отдельное решение после минимум трёх подтверждённых выплат.

Rollback: уже завершённые заказы не откатывать автоматически; сверять ownership, balance
delta и creator payout вручную. Scoped override commit `3c32e03` удалён из рабочего пути.

## Готово когда

- Plus 10% и 20% распознаются только по typed discount details;
- неизвестные/региональные скидки остаются заблокированы;
- фильтр и пачка используют live buyer-price, а номинал — base-price;
- покупка подтверждена balance delta + ownership, продавец подтверждает полный номинал;
- все денежные пути используют один контракт и одинаковые regression tests;
- документация, HANDOFF, Trello и production runbook синхронизированы.

## Решения владельца после P0-spike

1. Оставляем Plus-donor и внедряем новый transport или возвращаем donor без Plus?
2. После подтверждения первой выплаты включаем только ручной TWA или также партнёрский путь?
3. Когда разрешать batch/auto-buyout: после 1, 3 или 10 подтверждённых выплат?
