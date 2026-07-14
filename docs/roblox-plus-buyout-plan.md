# Roblox Plus buyout — поддержка скидок 10–20%

Статус на 14.07.2026: **классификация и расчёт пачки реализованы; cookie-only покупка
pass с Plus-account заблокирована как неподдерживаемая (`ROBLOX_PLUS_FLOW`)**.

## Что подтверждено

Roblox Plus уменьшает фактическую цену покупателя на 10%, а с третьего месяца — на 20%.
Roblox субсидирует скидку, поэтому creator earnings считаются от полной цены. Источник
истины для конкретного пасса — authenticated `PriceDiscountDetails`, а не legacy Premium
membership flag.

Официальные источники:

- https://create.roblox.com/docs/production/monetization/roblox-plus
- https://create.roblox.com/docs/production/monetization/passes
- https://devforum.roblox.com/t/disabling-cross-game-sales-of-passes-and-dev-products-and-introducing-the-transfers-api/4618396

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

## Текущее production-поведение

- обычный non-Plus cookie-flow возвращён на проверенный legacy v1;
- typed Plus продолжает участвовать в фильтре и расчёте Account-пачки;
- на этапе покупки TWA, Account, partners, TG manual/script и auto-buyout возвращают
  `ROBLOX_PLUS_FLOW` без purchase POST; order-flow сохраняет заказ как `ERROR` с этим
  кодом, а партнёрская задача остаётся `READY`;
- unknown/regional price остаётся `REGIONAL_PRICE`;
- batch продолжает обработку других допустимых non-Plus заказов, Plus-заказы остаются в
  очереди/фильтре ошибок с понятной причиной;
- balance, ownership recovery и seller/price guards остаются обязательными.

Drain не является способом обхода: он сохраняет legacy v1 и не используется для выплаты
Plus-заказов.

## Следующее решение P0

Безопасны два варианта:

1. **donor без Plus** — самый быстрый путь вернуть cookie-only выкуп текущей пачки;
2. **официальный client/experience bridge** — инициировать `PromptGamePassPurchase` в
   originating experience, подтверждать ownership/balance и только затем закрывать заказ.

Transfers API можно исследовать отдельно, но это другой payout-flow с собственными
лимитами и не drop-in замена покупки клиентского pass.

## Критерии готовности Plus-покупки

- есть официальный, документированный или подтверждённый Roblox client flow;
- canary подтверждён ответом, balance delta и ownership;
- продавец подтверждает полный creator payout;
- минимум три одиночных успешных canary до batch/auto-buyout;
- rollback, мониторинг и runbook синхронизированы;
- только после этого снимается `ROBLOX_PLUS_FLOW`.
