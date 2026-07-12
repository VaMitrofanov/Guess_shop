# Платежи, возвраты и ККТ

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

Темы: `payment.confirmed`, `payment.refund.recorded`. Ручной replay dead-letter пока только
через контролируемое изменение записи оператором; перед снятием maintenance нужен admin UI/runbook.

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
