# Предрелизный аудит ссылки для Т‑Банка — 17.07.2026

## Решение

**Формальная отправка сайта как полностью готового к одобрению эквайринга — NO-GO.**
URL уже публичен, а приём денег fail-closed. Quick-fix batch ниже реализован и локально
проверен; после последовательного production rollout Web → Guide и финального smoke ссылку
можно отправлять для **предварительного просмотра витрины**. Внешние юридические/платёжные
гейты до включения денег остаются открыты.

Минимальный сегодняшний gate для предварительной ссылки:

1. [x] Web, затем `RobloxBank-Guide` последовательно развёрнуты на commit `b6b699f`;
   source fingerprint совпадает: `20183b40b8783d9c`. Web дополнительно поднят до `709f8e8`
   (mobile card overflow) — см. «Проверка прода на `709f8e8`».
2. [x] VK ID скрыт fail-closed из публичного login; Guide использует прямую VK-ссылку до
   отдельного live provider acceptance.
3. [x] Mobile overflow `/legal/policy` исправлен: `390 px` viewport даёт
   `scrollWidth 386 == clientWidth 386`, заголовок виден целиком.
4. [x] Из FAQ/гарантий убраны фразы «реквизиты появятся/мы заполним»: реквизиты уже
   опубликованы; часы и SLA берутся из общего источника `/legal/details`.
5. [x] Размещены логотипы Т‑Банка, МИР, Visa, Mastercard и СБП.
6. [x] Checkout читает runtime acquiring status, показывает review-баннер и не активирует
   CTA при выключенном gate; сервер сохраняет независимую exact-`true` проверку.
7. [x] `/register` требует явный privacy consent; API отклоняет обход клиентской формы.

Даже после этих быстрых правок **нельзя включать оплату**, пока не закрыты категория/MCC,
юридическая модель Roblox/бренда/возраста, фактическая РФ-локализация первичной БД,
terminal/KKT/OFD test matrix и боевой payment/refund E2E.

## DEMO-терминал: тест Init + оплата — 18.07.2026

DEMO-терминал `…DEMO` env добавлены в Coolify Web, redeploy выполнен.
`/api/acquiring/status` → `{"enabled":true}`.

| Шаг | Результат |
|---|---|
| Init (прямой вызов API) | ✅ `Success:true`, PaymentId `8875548218`, PaymentURL получен |
| Тестовая карта `4300…0777` на pay.tbank.ru | ✅ Оплата прошла |
| GetState | ✅ `Status: CONFIRMED`, Amount 10000 коп |
| Webhook handler доступен | ✅ `401` на невалидную подпись (корректный reject) |
| Full Refund (Cancel 100 руб → 0) | ✅ `REFUNDED`, NewAmount=0 |
| Init 500 руб (для partial) | ✅ PaymentId `8875607284` |
| Оплата 500 руб тестовой картой | ✅ `CONFIRMED` |
| Partial Refund (200 из 500) | ✅ `PARTIAL_REFUNDED`, NewAmount=30000 |
| Second Refund (300 остаток) | ✅ `REFUNDED`, NewAmount=0 |

### Обязательные тесты Т-Банка (18.07, все пройдены)

| Тест | Карта | Результат |
|---|---|---|
| 1. Успешная оплата (12 390,01 ₽) | `4300 0000 0000 0777` | ✅ CONFIRMED (PaymentId `8875839868`) |
| 2. Неуспешная оплата (12 390,01 ₽) | `5000 0000 0000 0009` | ✅ REJECTED (PaymentId `8875855365`) |
| 3. Возврат (12 390,01 ₽) | `4000 0000 0000 0119` | ✅ CONFIRMED → Cancel → REFUNDED (PaymentId `8875855431`) |

**Итог:** все 3 обязательных теста Т-Банка пройдены. Рабочий терминал одобрен и выдан;
credentials получены владельцем, но по решению 18.07 не вставляются до приёмки текущего
ЛК/checkout/WB batch и allowlist-плана.

**Дизайн `/payment/status`:** локальный batch 18.07 заменяет старый pixel UI на Violet/Frost
timeline с mobile/offline/error-состояниями. Production остаётся на старой странице до
безопасного deploy этого batch при `SITE_ACQUIRING_ENABLED=false`.

## Проверка прода на `709f8e8` — 17.07, 12:0x–12:4x UTC

### Инцидент «деплой упал» — ложная тревога

Запись деплоя `failed` действительно есть, но production она не затронула:

| Deployment | Триггер | Время (UTC) | Итог |
|---|---|---|---|
| `uc8h1wnn…` | GitHub webhook (`is_webhook=true`) | 11:59:30 → 12:01:46 | **finished** |
| `tquzrcpm…` | ручной API force (`is_api=true`, `force_rebuild=true`) | 11:59:54 → 12:05:21 | **failed** |

Обе сборки — один и тот же commit `709f8e82`. Ручной force-deploy стартовал через 24 с
после webhook-сборки, две параллельные сборки Next.js на RF (2 vCPU / 4 GB) не помещаются:
вторая умерла на `Running TypeScript ...` c `exit 255` без compile-ошибки. Это тот же
parallel-build failure mode, что задокументирован для Web→Guide, но здесь Web против Web.
Упавшая сборка не заменяет работающий контейнер, поэтому прод остался на успешной сборке.
Правило и диагностика зафиксированы в [deploy.md](deploy.md#как-деплоить).

**Redeploy не потребовался**: прод уже был на нужном коммите. Доказано тремя независимыми
способами — тег образа `z10ws7m1q45h281zwedmhei4:709f8e82405cfa47fa7b14f71c2f1267037e8591`
у контейнера `robloxbank-web` (`healthy`); `last-modified: 12:00:40 GMT` у отданных CSS-чанков;
и сам фикс в отданном CSS (`min-width:0;max-width:100%`, `minmax(0,1fr)`,
`width:min(620px,100% - 28px)` — минификатор свернул `calc()`).

### Результаты production gate

| Проверка | Результат |
|---|---|
| `npm run smoke:site -- --expect-public` | ✅ 15/15 |
| `node scripts/smoke-corridor.mjs` | ✅ 29/29 |
| Fingerprint Web == Guide | ✅ `20183b40b8783d9c` |
| Mobile `390×844`, 11 публичных страниц | ✅ `scrollWidth == clientWidth == 390` везде |
| `/api/acquiring/status` | ✅ `{"enabled":false}` (fail-closed) |
| `/login` без VK ID, Telegram на месте | ✅ |
| Логотипы Т‑Банк/МИР/Visa/Mastercard/СБП | ✅ |
| `/register` consent | ✅ |

Guide остался на `b6b699f`, и это корректно: `709f8e8` не трогает ни один файл Guide-сборки
(только `src/app/storefront.module.css` и `docs/`), совпадающий fingerprint и corridor `29/29`
это подтверждают. Отдельный Guide redeploy не нужен.

Проверено на `709f8e8`: hero/калькулятор на `390 px` укладываются в вьюпорт
(карточка `362 px`, `left=14 … right=376`), горизонтального скролла нет ни на одной из
11 публичных страниц (`/`, `/checkout`, `/guide?source=site`, `/faq`, `/guarantees`,
`/reviews`, `/legal/{policy,offer,details}`, `/login`, `/register`).

### Новое наблюдение — P2, не блокер

- **Гостевая консоль показывает `401` от `/api/account/me`** на каждой публичной странице.
  Функционально безвредно (клиент так определяет, залогинен ли посетитель; гостевой UI
  рендерится верно), но в DevTools у ревьюера банка это красная ошибка. Прошлый прогон
  отчитался «console errors = 0», потому что выполнялся **под сохранённой авторизованной
  сессией** — под чистым гостем картина другая.
  **Закрыто в коде 17.07** (ждёт деплоя): проба отвечает `200 {authenticated:false,
  robloxUsername:null}`. Оба вызывающих места уже использовали `res.ok ? json : null`,
  поэтому контракт обратно совместим. Гостевой ответ не содержит данных и идентичен для
  «не входил» и «сессия истекла», так что эндпоинт не подсказывает, есть ли аккаунт
  (`src/lib/account-session.ts`, 5 тестов).
- **`429` под быстрым автоматическим обходом** — это сработавший rate limiter, а не дефект:
  при обычных интервалах все страницы отдают `200`. Будущим автопроверкам надо разносить
  запросы по времени, иначе они ловят собственный лимит и дают ложные красные.

## Production после quick-fix rollout

| Поверхность | Результат 17.07 | Вывод |
|---|---:|---|
| `/` | `200`, публичная витрина | maintenance снят |
| `/api/health` | `200`, CSP/nosniff/referrer-policy есть | зелёный |
| `/guide?source=site` | `200`, SITE marker и fingerprint есть | зелёный |
| `/guide?source=wb` | `200`, все чанки и vendored SDK `200` | функционально доступен |
| Web ↔ Guide | fingerprint `20183b40b8783d9c` одинаковый | corridor `29/29` |
| `/login` | email и Telegram доступны; неработающий VK ID скрыт fail-closed | зелёный для preview |
| `/dashboard` | авторизованный USER видит ЛК, пустую историю и EMAIL identity | базовый ЛК работает |
| `/checkout` | поиск/quote работают; review-баннер виден, payment CTA не активируется | зелёный для preview |
| Приём денег | `SITE_ACQUIRING_ENABLED` не задан как `true`; код разрешает только точное `true` | fail-closed |
| Legal pages | публичные `200`, реквизиты/телефон/email заполнены | требуется правовая приёмка |

Публичные маршруты `/guarantees`, `/reviews`, `/faq`, `/legal/offer`, `/legal/policy`,
`/legal/details`, `/login`, `/register`, `/checkout`, `/payment/status`, `/admin/login`
вернули `200`; неизвестный URL — custom `404`; `/privacy` корректно переводит на
`/legal/policy`; неавторизованный `/dashboard` переводит на `/login`.

## Выполненные проверки

### Код и сборка

- `npm test -- --runInBand`: исходный аудит **30 suites / 200 tests passed**; после
  quick-fix batch — **31 suite / 203 tests passed**.
- Web TypeScript: без ошибок.
- Bots TypeScript: без ошибок.
- `prisma validate`: схема валидна.
- `npm run build`: production build успешен на Next.js 16.2.2.
- `npm run smoke:site -- --expect-public`: **15/15** после rollout.
- `scripts/smoke-corridor.mjs`: **29/29** после последовательного Web → Guide deploy.
- Полный `eslint src --quiet`: **389 errors**. Основная масса — legacy
  `no-explicit-any`; есть React hook/compiler-ошибки. Поэтому общий lint gate не зелёный,
  даже если scoped lint изменённых storefront-файлов проходил в предыдущих релизах.
- Build сохраняет предупреждение `pg-connection-string` о необходимости явно перейти на
  `sslmode=verify-full` перед следующим major.

### Пользовательский desktop/mobile проход

Проверено в production без создания заказа и без платежа:

- navbar/footer, смена темы, desktop и mobile menu;
- калькулятор и presets: `500 R$ → 450 ₽`, `1000 R$ → 800 ₽` совпадают с `/api/pricing`;
- Roblox lookup `KrytishVadim4ick`: реальный avatar, подходящий pass `715 R$`, CTA в
  checkout; checkout нашёл 6 sellable passes;
- server quote и переход на экран подтверждения; email/consent корректно управляют
  enabled-state кнопки оплаты;
- SITE guide, Creator Hub/support links и поиск;
- FAQ accordion, reviews empty-state, guarantees и все legal links;
- регистрационная форма, login и USER dashboard;
- Telegram login создаёт корректный deep link в `@RobloxBankBot`;
- ширина `390×844`: root, checkout, guide, FAQ, guarantees, reviews, offer и details без
  горизонтального overflow.

Не выполнялись намеренно:

- payment submit и `Init`, потому что это создаёт денежный заказ, а acquiring выключен;
- полный Telegram callback в реальном Telegram;
- logout тестового USER, чтобы не разрушать сохранённую acceptance-сессию;
- создание новой USER-записи и реальные refund/KKT операции.

Один короткоживущий `PriceQuote` был создан при проверке шага «Продолжить»; `WbOrder` и
`PaymentAttempt` не создавались.

## Найденные дефекты и расхождения

### P0 — до формальной заявки/денег

1. **Политика ПД противоречит инфраструктуре.** `/legal/policy` утверждает, что оператор
   обеспечивает локализацию данных граждан РФ, но primary Postgres по документации всё ещё
   вне РФ. Текст также называет `Vercel Inc. / провайдер VPS`, хотя production работает в
   другом контуре. Нельзя лечить это только формулировкой: нужны российский primary,
   data map, решение по трансграничной передаче, restore/reconciliation и юридическая
   редактура политики.
2. **Категория/Roblox/бренд/возраст не согласованы письменно.** Roblox Terms прямо считают
   сторонние сервисы покупки/продажи/передачи Robux нарушением, а real-money операции
   ограничивают совершеннолетними. В оферте нет отдельного age/guardian flow.
3. **Платёж и ККТ не приняты.** Нет terminal test matrix, официальных test cases 7/8,
   фактического `Init → callback → receipt → fulfillment → refund`, сверки с кабинетом
   Т‑Банка и ОФД.
4. **Корневая проблема VK ID остаётся открыта, публичный дефект mitigated.** Provider
   продолжает требовать отдельной диагностики и live callback acceptance, но broken control
   скрыт fail-closed из login; Guide использует прямой VK handoff.
5. **Registration consent — закрыто 17.07.** `/register` показывает отдельное согласие и
   ссылку на Политику; API требует literal `true` и отклоняет обход UI.
6. **Платёжные логотипы — закрыто 17.07.** Footer/checkout показывают Т‑Банк, МИР, Visa,
   Mastercard и СБП вместе с честным статусом выключенной оплаты.

### P1 — до сегодняшней предварительной ссылки

1. **Guide drift — закрыто:** Web/Guide на одном fingerprint, corridor `29/29`.
2. **Mobile policy overflow — закрыто:** `386/386`, заголовок виден целиком.
3. **Устаревший public copy — закрыто:** FAQ/guarantees используют опубликованные условия,
   общие support hours/SLA.
4. **Payment CTA mismatch — закрыто:** runtime status и сервер используют один exact-`true`
   gate; при `enabled:false` баннер виден, CTA не активируется.
5. **Legal copy шире фактической услуги:** оферта описывает также коды и gift cards, хотя
   текущий сайт продаёт услугу через gamepass. Момент исполнения, возвраты, SLA и точный
   предмет расчёта должны быть согласованы с юристом/бухгалтером/ККТ.
   (Отдельно: товар «коды активации» теперь прорабатывается — [roblox-codes-plan.md](roblox-codes-plan.md).
   До его запуска оферта не должна обещать то, чего сайт не продаёт.)
6. **Контактный email — личный ящик, не на домене (найдено 17.07).** В реквизитах и оферте
   опубликован `demidispanov@yandex.com`, тогда как ИП — **Юдина Н. А.**. Для банка это
   двойное несоответствие: адрес не на домене магазина и не бьётся по имени с
   предпринимателем. Домен вдобавок вообще не имеет `MX`, то есть `@robloxbank.ru` сейчас
   физически не принимает почту. Закрывается тем же шагом, что и почтовый транспорт для
   auth: ящик `support@robloxbank.ru` — см.
   [auth-account-readiness-plan.md](auth-account-readiness-plan.md#рекомендация-яндекс-360-для-бизнеса).
6. **Общий ESLint не является рабочим release gate:** 389 ошибок при зелёных build/tsc.

### P2 — после отправки предварительной ссылки

- Автоматизировать последовательный Web → Guide deploy и блокировать release при mismatch;
  заодно исключить параллельную сборку одного сервиса (webhook + ручной force), которая
  17.07 дала ложный `failed` — см. «Инцидент „деплой упал“».
- Сделать гостевую проверку сессии тихой: `/api/account/me` не должен писать `401` в консоль
  публичных страниц.
- Добавить полноценный Playwright E2E guest/email/TG/VK/dashboard/checkout/payment/refund.
- Закрыть email verification/reset/throttling, доказательную запись согласия и безопасные
  VK link/unlink/merge по [согласуемому auth-плану](auth-account-readiness-plan.md).
- Зафиксировать performance/accessibility baseline на физических iPhone/Android/WebView.
- Настроить бизнес-алерты по payment/outbox/refund и провести rollback drill.

## Quick-fix acceptance перед production rollout

- Scoped ESLint изменённых файлов — зелёный.
- Web TypeScript — зелёный.
- Production build Next.js 16.2.2 — зелёный.
- Mobile `390×844`: policy, login, register, checkout и footer без horizontal overflow.
- `/login`: VK ID отсутствует при default-false gate; Telegram остаётся доступен.
- `/register`: consent required, ссылка на политику видна, submit до consent disabled.
- Footer: видны пять платёжных брендов и честный статус выключенной оплаты.
- FAQ/guarantees: устаревшие обещания не найдены, часы/SLA совпадают с legal details.
- Checkout: review-баннер виден, console errors отсутствуют, status endpoint fail-closed.

## План реализации

### Сегодня, до отправки ссылки

1. **Web content/UI batch (1–2 часа):** mobile legal heading, актуальные FAQ/guarantees,
   payment-disabled banner, логотипы, consent на `/register` после согласованной формулировки.
2. **Auth/Guide batch (1–2 часа):** диагностировать VK timeout; deploy Web, затем Guide;
   повторить `smoke:site`, corridor smoke и browser mobile check.
3. **Контроль ссылки (30 минут):** проверить root/legal/contacts/offer/refund/FAQ из чистой
   гостевой сессии, убедиться, что acquiring остаётся false, сохранить timestamp/fingerprint.
4. Если РФ-локализация/юрредактура не завершены — отправлять только как
   **предварительную витрину с выключенной оплатой**, явно сообщив менеджеру Т‑Банка, что
   final legal/payment acceptance следует отдельным этапом.

### До включения terminal

1. Письменный category/MCC go-ahead и юридическое заключение по модели/бренду/возрасту.
2. Российский primary Postgres, backup/restore/checksum/reconciliation, data map и
   трансграничный контур; затем обновление политики ПД.
3. Утвердить `Taxation`, `Tax`, `PaymentMethod`, `PaymentObject`, предмет/способ расчёта,
   ККТ/ОФД и агентский статус.
4. Пройти официальную test matrix: Init, duplicate/replay callbacks, timeout, downstream
   failure, closing/refund receipts, full/partial refund и reconciliation.
5. Real-provider acceptance TG/VK/link/merge и существующих клиентов.
6. Allowlist soft launch первых оплат с ручной сверкой, monitoring, kill switch и rollback.

## Ссылки и источник истины

- Общий план: [site-acquiring-master-plan.md](site-acquiring-master-plan.md).
- Платежи/ККТ: [payments-and-kkt.md](payments-and-kkt.md).
- Риски: [security.md](security.md).
- Site/guide: [corridor-and-site.md](corridor-and-site.md).
- Trello workflow: [trello-workflow.md](trello-workflow.md).
