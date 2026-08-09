# Аудит production и кода — 09.08.2026

## Результат remediation 09.08

Найденные P0/P1 исправлены в release candidate; production deploy и контролируемая денежная
приёмка ещё не выполнялись:

- stale SITE-платежи теперь сверяются через T‑Bank `GetState`, незавершённые попытки
  отменяются через `Cancel`, а льготы возвращаются только после terminal provider status;
- поздний `CONFIRMED` повторно резервирует уже возвращённые bonus/discount атомарно; при
  недостатке льгот платёж сохраняется как подтверждённый, заказ блокируется в `ERROR`,
  выкуп не запускается, администраторам уходит reconciliation alert;
- Next/Auth/Prisma обновлены, уязвимый `xlsx` заменён на ExcelJS, `npm audit` и
  `npm audit` показывают 0 vulnerabilities во всех трёх lockfile: root, TG и VK;
- добавлен CI (`prisma validate` → `gates` → `build`), regression-тесты payment lifecycle,
  bounded polling, исправлены stale WB search и пустая инвалидация;
- TLS задан явно как `sslmode=verify-full`, просроченные WB-reservations отделены от активных,
  legacy payment initializer удалён.

Локальная приёмка после payment reliability + hybrid bot checkout: web **502/502**,
bots **46/46**, оба TypeScript,
critical/full baseline lint, production build Next.js **16.3.0** — зелёные; полный lint
fingerprint уменьшен **1096 → 1088**. Prisma schema valid, локальный production smoke
**15/15**, оба npm audit — **0 vulnerabilities**. Ручной выкуп принят владельцем как штатный
режим и поэтому недоступность browser purchase service больше не считается блокером приёма
оплаты.

### Follow-up реализован: прямые заказы TG/VK + переход на сайт

После direct submit TG/VK показывают три пути: готовый заказ на сайте, тот же эквайринг
Т‑Банка прямо в боте и manual transfer. HMAC Bot→Web endpoint по actor+intent создаёт один
canonical `WbOrder`, provider attempt, consent, event/outbox и резервирует льготы
serializable-транзакцией. Сайт открывается по secret status token уже с суммой/заказом и
кнопкой оплаты. SITE/BOT presentation разделяют один `PaymentURL`, поэтому двойного
банковского платежа нет.

Manual details читаются из runtime env, в Git/Trello/order не копируются; создаётся
`MANUAL_TRANSFER` attempt. Скриншот не меняет paid-state, а admin `pay_ok` требует manual
provider и атомарно пишет confirmed/event/outbox. Legacy TG/TWA consume переведён на CAS,
чтобы не гоняться с новым клиентским callback. Добавлены HMAC/ownership/canonical-order,
retry/benefits и stale-direct regressions. Детали —
[bot-acquiring-plan.md](bot-acquiring-plan.md). ККТ/допустимость получателя manual transfer
остаются осознанным внешним риском, который код не может закрыть.

## Вердикт на момент исходного аудита

Публичный сайт, checkout `Init`, WB-коридор, БД, worker/outbox и основные внешние API
доступны. При этом систему нельзя считать полностью исправной:

- **P0 — жизненный цикл платежа:** автоотмена SITE-заказа через 2 часа переводит заказ в
  `REJECTED` и возвращает бонус/скидку, но не закрывает `PaymentAttempt=INITIATED` и не
  отменяет банковскую ссылку. В production уже две такие пары `REJECTED + INITIATED`.
- **P0 operational — выдача:** browser purchase service недоступен, donor cookie не
  обновлялся почти 21 день, автовыкуп выключен. В очереди 17 production-заказов, 7 старше
  суток; без ручного выкупа новые оплаты увеличивают backlog.
- **P0 security — зависимости:** актуальный `npm audit --omit=dev` видит 14 advisories
  основного lock graph, включая 2 critical. Уязвимы фактически используемые Next.js
  16.2.2 и Auth.js/next-auth 5.0.0-beta.31.

Поэтому ответ на вопрос «работают ли платежи» — **частично да**: банк создаёт платёжные
сессии, подтверждённый платёж после SSL-фикса есть, webhook/outbox работают. Но безопасная
обработка брошенной/поздней оплаты и гарантированная автоматическая выдача сейчас не
обеспечены. В рамках аудита новый реальный платёж и списание денег не выполнялись.

## Что проверено фактически

| Контур | Результат на 09.08 | Доказательство |
|---|---|---|
| Storefront | ✅ | `smoke:site` 15/15, `/` и `/api/health` → 200 |
| WB guide | ✅ | `smoke-corridor` 31/31; Web/Guide fingerprint совпадает |
| Production build | ✅ | Next 16.2.2 build и TypeScript успешно |
| Unit/contract tests | ✅ | web 471/471, bots 29/29 |
| Миграции | ✅ | Prisma schema valid; 46/46 migrations applied |
| Эквайринг | ⚠️ | mode `on`; свежий `Init` 09.08; последний `CONFIRMED` 06.08; lifecycle-дефект ниже |
| Webhook guards | ✅ | неверная подпись → 401; unknown order → 404 |
| Payment outbox | ✅ | оба heartbeat свежие; overdue 0; 15/15 сообщений `DELIVERED`, `DEAD=0` |
| Refund | ⚠️ | один production full refund подтверждён; частичный fiscal/ОФД-прогон всё ещё открыт |
| Buyout | 🔴 | browser purchase service unavailable; 17 pending, 7 старше 24 ч |
| TG/VK | ✅ частично | credentials валидны; heartbeat процессов healthy; отправка реального сообщения не выполнялась |
| WB API / Roblox API | ✅ | read-only endpoints → 200; checkout нашёл публичный Roblox-профиль без ошибок приложения |
| Google Sheets / Антон | ✅ с историей partial | последний sync `SUCCESS` 08.08; активных зависших задач нет |
| Admin/TWA auth | ✅ | admin без сессии → 403; мусорный TWA bearer → 401 |
| Browser QA | ⚠️ | storefront/checkout/admin гидратируются без app console errors; fulfillment readiness красный |

## Находки

### P0. Автоотмена оставляет банковский платёж активным — ✅ закрыто в release candidate

`sweepStaleWebOrders()` отменяет `AWAITING_PAYMENT/PAYMENT_PENDING` через 2 часа и сразу
возвращает benefit reservation. Однако `isLivePaymentAttempt()` считает `INITIATED` и
`AUTHORIZED` живыми бессрочно, а `GetState`/reconciliation job отсутствует.

Production-снимок подтвердил две записи:

- order `REJECTED`, причина «авто-отмена через 2 ч»;
- attempt `INITIATED`, `paymentUrl` сохранён, `finalizedAt` пуст;
- бонус/скидка уже возвращены;
- возраст — около 2 часов и около 43 часов.

Поздний signed `CONFIRMED` сейчас безусловно переводит заказ обратно в `PENDING`. При этом
возвращённый бонус/скидка повторно не резервируется. Это одновременно риск позднего
списания, неожиданного «воскрешения» заказа и двойной выгоды.

**Реализовано:** `GetState`/`Cancel`, terminal-only compensation, атомарный late-payment
guard, fail-closed reconciliation alert и regression suite. Две исторические production
попытки будут обработаны worker после deploy; до него их по-прежнему нужно сверить вручную.

### Operational. Ручной выкуп принят владельцем

Живой `/admin/buyout` после принудительного refresh сообщает:
`Браузерный сервис выкупа недоступен`. Donor cookie присутствует, но обновлён 19.07;
`autoBuyoutEnabled=false`. В БД 17 `PENDING`, из них 14 старше 12 ч, 7 старше 24 ч,
самый старый — с 04.08.

Владелец подтвердил, что покупка/выдача выполняется руками и этот режим работает. Очередь и
SLA остаются операционным объектом мониторинга, но browser service/auto-buyout не являются
техническим P0 этого релиза.

### P0. Уязвимые Next.js и Auth.js — ✅ закрыто в release candidate

Установлены `next@16.2.2`, `next-auth@5.0.0-beta.31`, `@auth/core@0.41.2`. Audit включает:

- Auth.js fail-open при configuration error —
  [GHSA-8fpg-xm3f-6cx3](https://github.com/advisories/GHSA-8fpg-xm3f-6cx3);
- Auth.js Unicode email normalization bypass —
  [GHSA-7rqj-j65f-68wh](https://github.com/advisories/GHSA-7rqj-j65f-68wh);
- malformed Bearer DoS —
  [GHSA-xmf8-cvqr-rfgj](https://github.com/advisories/GHSA-xmf8-cvqr-rfgj);
- несколько Next.js middleware/proxy bypass, DoS и SSRF advisories; минимальные patched
  ranges доходят до 16.2.11, а npm предлагает 16.3.0.

Текущие sensitive handlers обычно проверяют `session.user.id`/единый admin grant, а
`getToken` в proxy обёрнут в `catch`, что снижает часть exploitability, но не отменяет
уязвимую production-зависимость.

**Реализовано:** Next 16.3.0, next-auth beta.32, Auth/Prisma updates; build и regression
gates зелёные, npm audit — 0. Production browser acceptance остаётся post-deploy шагом.

### P1. SheetJS без исправления в npm — ✅ закрыто

`xlsx@0.18.5` используется для admin-only XLSX upload. Audit фиксирует prototype pollution
и ReDoS; npm-пакет не предлагает fix. Доступ ограничен admin grant, файл ограничен 5 MB и
числом строк — это снижает, но не убирает риск вредоносного файла.

Admin upload переведён на ExcelJS с лимитом строк и игнорированием ненужных OOXML-узлов;
добавлены parser regression tests, пакет `xlsx` удалён.

### P1. Автотесты не покрывают браузерный денежный коридор — 🟡 частично закрыто

Тестов много, но в репозитории нет CI workflow, Playwright/Cypress E2E и coverage threshold.
Именно поэтому `smoke:site` и unit suite зелёные при недоступной выдаче и паре
`REJECTED + INITIATED`.

CI для `gates + build + prisma validate` добавлен; late payment/auto-cancel покрыты unit и
contract tests. **Осталось:** E2E на staging для
quote → login → gamepass → Init mock → callback → status → outbox → fulfillment readiness;
отдельные regression cases для late payment и auto-cancel.

### P1/P2. Legacy lint скрывает важные React warnings

`lint:critical` зелёный, полный baseline после фиксов имеет 1088 warnings (было 1096):

- 971 `no-explicit-any`, 81 unused;
- 19 sync set-state-in-effect;
- 3 missing hook dependencies;
- render-time ref/immutability/purity warnings.

Конкретные дефекты этой волны закрыты: WB guide search dependency синхронизирована,
пустая `cachedCountsInvalidate()` удалена, status polling ограничен 10 минутами и
замедляется в фоновой вкладке.

**Нужно:** поднять hook rules до zero-warning critical scope, затем уменьшать fingerprint
по модулям. Не тратить первую волну только на массовую замену `any`: сначала stale closures,
refs/immutability и денежные handlers.

### P2. Слишком крупные модули и дублирование доменной логики

Крупнейшие файлы: TG handlers 5539 строк, TWA Boss screen 5076, VK handlers 3540,
partner tasks route 3277, Guide 2964, Orders screen 2870. Это повышает вероятность
рассинхрона TG/VK/Web и затрудняет точечное тестирование.

**Нужно:** выделить use cases/domain services по вертикалям payment, order transition,
buyout, partner sync; оставить route/handler тонким адаптером. Для payment/order transitions
сделать один state machine вместо прямых `status` updates в разных контурах.

### P2. Прочий долг

- legacy `initTinkoffPayment()` удалён;
- dashboard теперь считает active/expired `RESERVED` отдельно;
- web/bots/Prisma CLI нормализуют legacy connection string в `sslmode=verify-full`;
- Prisma schema отформатирована.
- В репозитории есть старые `src/app/api/auth/route.ts*.md` и tracked service certificate;
  это не влияет на build, но требует осознанной инвентаризации и ownership.

## Рекомендуемый порядок

1. Deploy release candidate и убедиться, что worker reconciled две исторические
   `INITIATED + REJECTED` попытки без повторной компенсации.
2. Запустить production smoke и проверить health/outbox/admin reconciliation counters.
3. Выполнить один controlled payment с поздним/отменённым test scenario без реального
   клиентского ущерба; сверить T‑Bank и ОФД.
4. Добавить browser E2E и composite readiness, затем разбирать legacy lint и монолиты.

## Ограничения аудита

Не выполнялись: новое реальное списание/3DS и возврат, отправка клиентского TG/VK/email,
реальный Roblox buyout, просмотр ОФД-чека, destructive admin actions. Эти проверки имеют
денежный или внешний эффект и должны идти отдельным controlled acceptance после P0.
