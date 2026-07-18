# Платежи, возвраты и ККТ

## Launch-safety update 18.07.2026

- Рабочие credentials получены владельцем, но ввод отложен до приёмки текущего сайта.
- Production master flag принудительно установлен в `false`; health и публичный status
  проверены после штатной пересборки.
- Новый код требует два явных разрешения: `SITE_ACQUIRING_ENABLED=true` и режим
  `SITE_ACQUIRING_MODE=allowlist|percentage|on`; default/неизвестное значение — `off`.
- Allowlist/percentage проверяются по authenticated internal `User.id` и повторно
  enforcement-ятся сервером в `POST /api/orders/create`.
- Gate действует только на новые Init. Webhook, payment outbox и refund обязаны продолжать
  работу при master off.
- Production E2E выполняется сначала на allowlist: минимальная оплата → signed webhook →
  order/outbox/ЛК/check → полный возврат и reconciliation. Полная матрица:
  [site-launch-implementation-plan.md](site-launch-implementation-plan.md#5-боевой-e2e-и-включение).
- Desktop `/admin` теперь читает тот же `WbOrder`/payment/outbox-контур: dashboard показывает
  открытые платежи, ошибки, `SUBMIT_UNKNOWN` и dead-letter, досье — сумму/PaymentId/refunds/
  events, а `/admin/activity` — единый журнал без сырых payload. Изменяющие payment-действия
  по-прежнему выполняются через защищённый TWA API, чтобы не дублировать refund-логику.
- `/payment/status` — основная клиентская страница подтверждения покупки; ЛК и bot message
  дополняют её, но не заменяют серверный статус `PaymentAttempt`/`WbOrder`.
- После paid-state страница предлагает TG/VK opt-in: Telegram identity для персональных
  статусов плюс TG-канал, VK-сообщество плюс диалог. CTA скрыты до подтверждения и после
  full refund/failed/canceled. `POST /api/orders/[id]/channel-intent` требует доступ владельца
  или status bearer token, принимает только четыре allowlisted destination и пишет один
  immutable `OrderEvent` на order+destination. Event означает только открытие CTA; факт
  подписки внешней платформой пока не подтверждается и так не называется в аналитике.

## Решение владельца по схеме (16.07.2026)

- Налоговый режим: **УСН**.
- Рабочая схема: **интернет-эквайринг Т‑Банка + сервис «Чеки» Т‑Банка**. Это разные
  контуры: эквайринг принимает оплату и перечисляет возмещение на расчётный счёт за
  вычетом комиссии эквайринга; «Чеки» формирует и отправляет фискальные чеки. По текущим
  условиям Т‑Банка сервис «Чеки» удерживает отдельную комиссию 1,5% за платёж, по которому
  сформирован чек. Налог по УСН банк за ИП не рассчитывает и не удерживает.
- Важно: «Чеки» подходит для ИП на УСН, но не для агентской схемы. До включения боевого
  acquiring Т‑Банк должен письменно подтвердить категорию услуги и что RobloxBank продаёт
  собственную цифровую услугу/товар, а не выступает агентом или посредником.
- Облачную кассу или собственную ККТ параллельно не подключаем: выбирается один фискальный
  контур. Запасной вариант — облачная ККТ, если Т‑Банк не согласует «Чеки» для модели.

Официальные материалы: [сервис «Чеки»](https://www.tbank.ru/business/help/business-payments/internet-acquiring/kassa/check/),
[комиссии и возмещение](https://www.tbank.ru/business/help/business-payments/internet-acquiring/how-work/price/),
[подключение облачной кассы](https://www.tbank.ru/business/help/business-payments/internet-acquiring/kassa/how-connect/).

## Боевой контур

`PriceQuote → WbOrder(SITE/WEB) → PaymentAttempt → OrderEvent → OutboxMessage` — единая
граница платежа. Суммы хранятся целыми копейками. `Init` принимает сумму только из
потреблённой серверной quote и отправляет `NotificationURL`, email и `Receipt.Items`.
Классификаторы ККТ (`Taxation`, `Tax`, `PaymentMethod`, `PaymentObject`) обязательны в env:
без них запрос fail-closed.

Webhook `/api/webhooks/tinkoff` проверяет подпись, terminal, `PaymentId`, `OrderId`, сумму и
монотонность статуса. Ответ `200 OK` возвращается только после commit события и outbox.
Повтор уведомления идемпотентен; несколько `PARTIAL_REFUNDED` различаются hash подписанного
callback, а не только статусом.

## Outbox worker

Worker запускается в long-running TG-сервисе вместе с cron jobs (`bots/shared/payment-outbox.ts`):

- каждые 15 секунд атомарно забирает до 10 due-сообщений;
- `PROCESSING` имеет lease 5 минут, зависшая запись возвращается в очередь;
- backoff: 30 сек, 1, 2, 4… минут, максимум час;
- после 8-й ошибки сообщение получает `DEAD`, причина обрезается до 500 символов, менеджерам
  отправляется alert;
- `DELIVERED` ставится только когда Telegram принял хотя бы одно admin-уведомление;
- неизвестная topic fail-closed и в итоге попадает в dead-letter.

Темы: `payment.confirmed`, `payment.refund.recorded`. Dead-letter виден на dashboard и в
`/admin/activity`, но ручной replay пока только через контролируемое изменение записи
оператором. До снятия maintenance нужен отдельный безопасный replay action/runbook; наличие
read-only журнала не считается автоматической починкой доставки.

## Refund

`POST /api/twa/payments/refund` доступен только TWA-admin JWT. Параметры: внутренний `orderId`,
необязательная сумма в копейках (без неё — весь остаток), UUID idempotency key и причина.
`PaymentRefund` создаётся **до** `/v2/Cancel`, поэтому двойной тап не вызывает второй возврат.

- частичный возврат передаёт `Amount` и чек ровно на возвращаемую часть;
- возврат всего оставшегося остатка не передаёт `Receipt`: итоговый чек возврата формирует банк;
- timeout/обрыв после отправки = `SUBMIT_UNKNOWN`; автоматический повтор запрещён до сверки;
- `SUBMITTED → CONFIRMED` делает подписанный webhook; cumulative refunded amount хранится в
  `PaymentAttempt.refundedAmountKopecks`;
- внешний возврат без локального `PaymentRefund` принимается как банковский факт, но outbox
  получает `needsReconciliation=true`.

## Полная test matrix

Статусы ниже разделяют автоматизированную проверку контракта и обязательный внешний прогон.

| Группа | Сценарий | Ожидание | Сейчас |
|---|---|---|---|
| Init/ККТ | сумма UI=quote=attempt=Init=Receipt item | точное равенство в копейках | unit/contract ✅ |
| Init/ККТ | отсутствует любой ККТ env | Init не отправляется | unit/contract ✅ |
| Init/ККТ | email normalization, item quantity/price/amount | валидный электронный чек | unit/contract ✅ |
| Callback | неверная подпись/terminal/order/payment/amount | 4xx, БД без изменений | код + integration на staging ⏳ |
| Callback | `AUTHORIZED→CONFIRMED` и сразу `CONFIRMED` | один paid-order/outbox | state matrix ✅; staging ⏳ |
| Callback | duplicate/out-of-order callback | без повторного эффекта | state matrix ✅; staging ⏳ |
| Downstream | Telegram/API временно недоступен | retry/backoff, заказ остаётся оплачен | policy tests ✅; fault injection ⏳ |
| Downstream | 8 постоянных ошибок | `DEAD` + alert | policy tests ✅; fault injection ⏳ |
| Refund | полный подтверждённый платёж | `/Cancel`, `REFUNDED`, closing refund receipt | contract ✅; terminal/ОФД ⏳ |
| Refund | частичный и затем остаток | два события, cumulative total, 2 корректных чека | contract/state ✅; terminal/ОФД ⏳ |
| Refund | duplicate UUID/double tap | один provider call | DB idempotency ✅; staging ⏳ |
| Refund | timeout после provider accept | `SUBMIT_UNKNOWN`, без blind retry | код ✅; fault injection ⏳ |
| Refund | внешний refund | callback принят + reconciliation flag | код ✅; staging ⏳ |
| Fiscal | чек успешной оплаты в ЛК/ОФД | сумма, email, СНО, предмет/способ расчёта совпали | test terminal/ОФД ⏳ |
| Fiscal | чек полного/частичного возврата | связан с оплатой, суммы исчерпывают payment | test terminal/ОФД ⏳ |
| Bank cases | официальные «Общие» и «Формирование чека» | кабинет помечает кейсы пройденными | test terminal ⏳ |
| Reconcile | БД ↔ T-Банк ↔ ОФД | PaymentId/OrderId/суммы/статусы совпадают | операторский прогон ⏳ |

Внешние строки нельзя помечать выполненными по локальным тестам. Для них нужен DEMO-terminal,
включённые fiscal notifications, доступ к тестовой ККТ/ОФД и сохранённые обезличенные evidence:
OrderId, PaymentId, fiscal status, время callback и hash ответа. Production terminal для этой
матрицы не используется.
