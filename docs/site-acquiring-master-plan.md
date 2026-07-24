# RobloxBank.ru: ультра-ревью и master plan эквайринга

**Статус:** реализация идёт. Рабочий терминал и credentials получены, но по решению владельца
они не вставляются до завершения ЛК/checkout/WB-плана. 18.07 production acquiring возвращён
в `false`, baseline БД снят и проверен. Актуальная последовательность работ:
[site-launch-implementation-plan.md](site-launch-implementation-plan.md).

**2026-07-18, DEMO-терминал: Init + CONFIRMED ✅**

DEMO-терминал `1784295128781DEMO` получен 17.07, env добавлены в Coolify Web 18.07.
Прямой тест Init → PaymentURL → тестовая карта `4300 0000 0000 0777` → GetState =
`CONFIRMED` (PaymentId `8875548218`, OrderId `TEST-1784311298785`, Amount 10000 коп).
Терминал работает, подпись проходит, T-Bank отдаёт PaymentURL и корректно подтверждает.

**Webhook:** standalone Init (без записи в БД) → webhook handler отклоняет по отсутствию
PaymentAttempt — ожидаемо; подпись при этом проходит (404, не 401).

**Refund тесты (18.07):**
- Full Refund (платёж 1, 100 руб → 0): `REFUNDED` ✅
- Partial Refund (платёж 2, 200 из 500): `PARTIAL_REFUNDED`, NewAmount=30000 ✅
- Second Refund (платёж 2, 300 остаток → 0): `REFUNDED` ✅

Весь DEMO API-цикл пройден: Init → оплата → full refund, Init → оплата → partial →
full refund.

**Обязательные тесты Т-Банка (18.07) — ВСЕ ПРОЙДЕНЫ:**
1. Успешная оплата `4300…0777` → CONFIRMED ✅
2. Неуспешная оплата `5000…0009` → REJECTED ✅
3. Возврат `4000…0119` → CONFIRMED → Cancel → REFUNDED ✅

**Рабочий терминал одобрен, выдан Т-Банком, credentials получены владельцем.** Замена
DEMO → production отложена до завершения текущей подготовки сайта; после замены обязателен
allowlist E2E через checkout с реальной БД и контролируемым возвратом.

**24.07.2026:** production runtime подготовлен к одному controlled E2E через `allowlist`.
Non-DEMO TerminalKey и SecretKey введены только напрямую в Coolify и подтверждены внутри
нового Web-контейнера без вывода значений. Master включён лишь для двух внутренних owner-учётных
записей; public guest status = `limited`. Реальная оплата, чек и возврат ещё не запускались:
они должны быть проведены owner-аккаунтом с ручным подтверждением карты/3DS.

**25.07.2026, checkout reliability hotfix:** UI-consent теперь имеет явную animated state,
не зависящую от page-level CSS для input. Если обычные Roblox detail APIs не отдают выбранный
pass, checkout проверяет exact ID в актуальном публичном списке pass'ов того же Roblox-владельца
и затем применяет без изменений owner/sale/price guard. Это не обходит проверку до `Init` и не
ослабляет allowlist; задача — убрать ложный отказ «Геймпасс не найден» перед controlled E2E.

**Дизайн `/payment/status` обновлён локально 18.07:** старый pixel UI заменён на Violet/Frost
order timeline с waiting/paid/work/completed/error/offline состояниями, переходом в ЛК,
защищённой ссылкой и mobile layout. Production rollout выполняется только вместе с текущим
batch после согласования.

**Юридические защиты (18.07):**
- **Footer:** добавлен дисклеймер «не является банком, кредитной или финансовой организацией»
- **Оферта §2:** расширен дисклеймер — nominative fair use для «Roblox», явное отрицание
  статуса банка/кредитной организации со ссылкой на ФЗ-395-1
- **Оферта §11 (новый):** полный дисклеймер — не банк, не партнёр Roblox Corp, не оператор
  ЭДС; ТЗ используются информационно; карточные данные не обрабатываются сервисом
- **Политика §1:** дисклеймер о сервисе + не связан с Roblox Corp
- **Политика §5:** обязательство подать уведомление в Роскомнадзор (ст. 22 ФЗ-152)
- **Политика §6:** формулировка локализации ПДн уточнена — первичное хранение на серверах РФ,
  резервное копирование допускается за рубежом
- **Реквизиты §3 (новый):** правовая информация — не банк, не Roblox Corp, T-Банк лицензия ЦБ
- **Гарантии:** убрана банковская лексика («сейф» → «защита», «Система доверия» → «Система
  защиты заказа»)

**Дата аудита:** 2026-07-12.  
**Цель:** сделать публичную витрину, авторизацию, ЛК и прямую покупку готовыми к реальным
клиентам и модерации интернет-эквайринга Т-Банка без расхождения с TG/VK-ботами.

## Статус реализации

- **2026-07-18, launch-safety + account batch (локально):** production acquiring выключен,
  backup и aggregate baseline проверены. Добавлен двухслойный gate: master kill switch и
  `off/allowlist/percentage/on` с детерминированным per-user bucket. Гость сохраняет
  amount/username/gamepass до обязательного login/register, после входа получает новую
  owner-bound quote. Email/TG/VK return path ограничен same-origin. ЛК получил активный
  четырёхэтапный order timeline, `/payment/status` полностью приведён к текущей системе.
  Jest `35/233`, production build и mobile `390×844` visual QA зелёные. Боевые credentials
  не менялись; подробный план ЛК, WB channel handoff и production E2E — в
  [site-launch-implementation-plan.md](site-launch-implementation-plan.md).

- **2026-07-17, повторный mobile/auth аудит (локальный release-candidate):** на главной
  найдено фактическое переполнение: mobile grid-track `1fr` принимал min-content ширину
  калькулятора (~424 px) и визуально выталкивал карточку вправо. Исправлены zero-min track,
  ширина mobile container и `min/max-width` дочерних карточек; production build и Jest
  `31/203` зелёные. Browser matrix на собранном сайте: `/`, checkout, FAQ, reviews,
  guarantees, login/register, offer/policy/details и guide — без горизонтального overflow
  на `390×844` и `360×800`; desktop root также без регрессии. Отдельно перепроверен ЛК:
  базовые email/TG/merge/dashboard механизмы есть, но публичный email lifecycle не готов
  без verification/reset/throttling/evidence consent и real-provider acceptance. Детальный
  согласуемый план: [auth-account-readiness-plan.md](auth-account-readiness-plan.md).

- **2026-07-17, quick-fix batch для ссылки Т‑Банку:** UI и API используют единый exact-`true`
  `SITE_ACQUIRING_ENABLED` gate через runtime status; при выключенном эквайринге checkout
  показывает review-state и никогда не активирует payment CTA. Добавлены логотипы Т‑Банка,
  МИР, Visa, Mastercard и СБП; `/register` требует privacy consent и клиентом, и API;
  legal shell исправлен для `390 px`; FAQ/guarantees синхронизированы с опубликованными
  документами; VK ID скрыт fail-closed до live acceptance. Локально зелёные 31 suite / 203
  tests, scoped ESLint, web TypeScript, build и mobile browser acceptance.
  **Rollout завершён:** commit `b6b699f`, Web/Guide `running:healthy`, fingerprint
  `20183b40b8783d9c`, public smoke `15/15`, corridor `29/29`; acquiring status `false`.

- **2026-07-17, предрелизный аудит ссылки Т‑Банку:** production root уже отвечает `200`,
  а fail-closed acquiring остаётся выключенным. Code gate: 30 suites / 200 tests, web+bot
  TypeScript, Prisma validate и production build зелёные; public smoke `15/15`.
  Интерактивный desktop/mobile проход подтвердил calculator → Roblox lookup → checkout →
  quote, USER dashboard, Telegram deep link и публичные документы. До отправки ссылки как
  готовой заявки остаются видимые дефекты: Guide/Web fingerprint mismatch, VK ID timeout,
  mobile overflow `/legal/policy`, устаревшие FAQ/guarantees и отсутствие платёжных
  логотипов. Формальный launch денег остаётся NO-GO из-за РФ primary ПД,
  category/Roblox/brand/age, terminal/KKT/OFD и payment/refund E2E. Полный отчёт:
  [tbank-precheck-2026-07-17.md](tbank-precheck-2026-07-17.md).

- **2026-07-16, owner-feedback checkout batch (локально, до deploy):** калькулятор витрины
  после валидного ника с debounce сам проверяет Roblox, показывает реальный headshot,
  найденные пассы и правильный следующий CTA: checkout, выбор другого найденного пасса или
  инструкция. `/api/roblox/gamepasses` возвращает нормализованный account preview вместе с
  пассами. Checkout показывает визуальную связку «аватар аккаунта → изображение пасса» и
  разрешает выбрать любой продаваемый пасс в диапазоне сайта: чистая сумма пересчитывается
  обратно из цены пасса, а сервер сохраняет общий guard ±2 R$ из выкупного контура.
  Небезопасный WebView-вызов `matchMedia(...).matches` и отсутствие fallback без
  `IntersectionObserver` исправлены; fingerprint client-error больше не зависит от имени
  build-чанка. Локальный production-browser подтвердил реальный avatar и 6 пассов для
  owner-кейса, переключение pass `715 R$` с заказа `1000 → 500 R$`, desktop/mobile без
  overflow и console errors; 25 suites / 165 tests и production build зелёные. Это закрывает
  UX-замечания владельца, но не снимает payment/legal/data gates.

- **2026-07-12, `a1993cd`:** план согласован и зафиксирован; реализация начата.
- **2026-07-12:** TG, VK и Web переведены на один чистый модуль `retail-direct-v1`;
  опубликованные пакеты и границы покрыты contract-тестами.
- **2026-07-12, применено к production:** добавлены additive-модели
  `UserIdentity`, `BonusLedger`, `AccountMergeAudit`, `PricingPolicy` и `PriceQuote`;
  migration backfill-ит legacy TG/VK/email identity и открывающие остатки бонусов без
  изменения баланса. VK web-login переведён на `UserIdentity`, а `POST /api/pricing/quote`
  создаёт короткую серверную котировку в копейках. На этом production-коммите quote ещё не
  была подключена к checkout; локальный инкремент 2026-07-13 ниже закрывает разрыв в коде.
  Reconciliation после migrate: `420 User = 420 UserIdentity`, opening ledger:
  `50` строк / `4900 R$`, Roblox-ник есть у `340` User, активна одна policy.
- **2026-07-12:** исправлен email credentials provider; ЛК теперь
  объединяет legacy SITE и реальные `WbOrder` (WB/DIRECT/AVITO/MANUAL), показывает активные
  бонусы и уже проверенные identity. Небезопасная кнопка «привязать VK», которая фактически
  меняла сессию, удалена до реализации fresh-auth link/merge.
- **2026-07-12:** в пустой `User.robloxUsername` backfill-ится
  последний подтверждённый ник из его `WbOrder` без перезаписи существующего профиля. ЛК
  приветствует пользователя по этому нику и передаёт его в checkout; прямой checkout также
  подставляет сохранённый ник в поиск геймпасса для текущей сессии.
- **2026-07-13, production:** Web commit `324a930` развёрнут, контейнер `healthy`; прямой
  HTTPS на `robloxbank.ru` и `www` возвращает `retail-direct-v1`. Корень намеренно остаётся
  `503` в maintenance (`MAINTENANCE_MODE=on`) до launch gates, поэтому это не incident.
- **2026-07-13, production:** checkout переведён с legacy `Order/Product`
  на канонический `WbOrder(SITE/WEB)`: quote одноразово потребляется вместе с созданием
  `PaymentAttempt`, `OrderEvent` и `OutboxMessage`; сервер проверяет ownership/TTL/version,
  Roblox owner/sale-state/точную gross-цену. Добавлены обязательный idempotency UUID,
  email чека, случайный status-token (в БД только hash) и строгая callback state machine со
  сверкой terminal/payment/order/amount. Bonus ledger/баланс и одноразовая скидка потребляются
  атомарно с quote, поэтому параллельные quotes не дают double-spend. Боевой `Init` закрыт `SITE_ACQUIRING_ENABLED=false`
  и fail-closed ККТ env. Migration `20260713_canonical_web_order_foundation` **применена к
  production** 13.07 (аддитивная, с полным backup и сверкой counts), код задеплоен на Web и
  боты; outbox worker, возвраты/чеки, staging test matrix и внешние gates остаются.
- **2026-07-15, production UI release `dfc9a4e`:** storefront переведён на search-first:
  пакет+ник ведут
  сразу к агрегированному списку всех геймпассов, а инструкция стала fallback. Отдельный
  `SiteGuide` удалён; `WB/SITE/BOT` используют одну девятишаговую основу с разными CTA.
  Исправлена hydration-гонка темы, увеличена типографика/контраст инструкции, усилена
  фоновая дверца сейфа и заменён экран восстановления сессии. ЛК в исходниках уже на общем
  Violet/Frost shell и читает `Order + WbOrder`; авторизованный visual/data smoke ЛК ещё
  обязателен. Web и Guide развёрнуты последовательно и `running:healthy`; production-smoke
  коридора прошёл `23/23`, маркеры WB/SITE/DIRECT и owner-only storefront/checkout/auth
  отвечают `200`. Maintenance и `SITE_ACQUIRING_ENABLED=false` не снимались. Предрелизный
  gate: `21 suites / 148 tests`, web+bot TypeScript, Prisma validate, scoped ESLint,
  production build и `git diff --check` — зелёные.
- **2026-07-15, production follow-up ЛК + webview `008735e`:** `/dashboard` перестроен в
  action-center «Личный сейф»: события и требуемые действия идут перед единой историей,
  мобильная таблица заменена карточками, а канонические SITE-заказы показывают безопасный
  payment/receipt snapshot и email чека. Отдельная identity settings-поверхность показывает
  verified TG/VK/EMAIL и оставляет только server-verified TG link; небезопасный VK merge не
  маскируется под готовую кнопку. Канонический `PENDING` исправлен с ошибочного «ожидает
  оплаты» на «в очереди на выкуп». Root viewport получил `viewport-fit=cover`,
  `interactive-widget=resizes-content`, dynamic viewport, safe-area и keyboard scroll-margin
  для storefront/checkout/guide. Read-only visual/data QA ЛК выполнен на реальных историях
  без изменения заказов: desktop `1440×1000`, mobile `390×844`, overflow отсутствует;
  guide дополнительно проверен при высоте `500 px` с активным полем. Локальный gate:
  `22 suites / 156 tests`, web+bot TypeScript, Prisma validate, scoped ESLint, production
  build и `git diff --check` — зелёные. Commit опубликован в `main`; Web auto-deploy и
  последующий Guide deploy завершились `running:healthy` на одном SHA, очередь Coolify
  пуста. Повторный production-smoke коридора прошёл `23/23`, а HTML Guide подтверждает
  `viewport-fit=cover` и `interactive-widget=resizes-content`. Maintenance и
  `SITE_ACQUIRING_ENABLED=false` не снимались. Авторизованный экран проверен локально на
  read-only снимке реальных production-историй; live signed-in acceptance непосредственно
  на production на момент этого релиза оставался ручным пунктом и закрыт следующим
  follow-up под отдельной USER-учётной записью.
- **2026-07-15, auth/LK acceptance follow-up:** владелец указал на старую поверхность
  `/login` и ошибку Telegram `Bot domain invalid`. `/login`, `/register` и `/admin/login`
  переведены на общий Violet/Frost shell «Личный сейф» с адаптивными состояниями ошибок;
  credentials-login нормализует регистр и пробелы email, dashboard выходит без промежуточной
  страницы Auth.js, а публичный admin-login вынесен из защищённой route group и использует
  правильный provider `admin-login`. Legacy Telegram iframe удалён: Web выдаёт одноразовый
  challenge на 5 минут, бот подтверждает Telegram-пользователя подписанной callback-ссылкой,
  а сервер атомарно потребляет только SHA-256 state. Migration
  `20260715_telegram_web_login_challenge` применена к production после полного backup.
  Создана отдельная USER-учётная запись владельца для приёмки; на production проверены
  регистрация, повторный email-login, новый dashboard, пустая история и EMAIL identity без
  создания фиктивных заказов. Локально проверены desktop `1440×1000`, mobile `390×844`,
  отсутствие overflow, отказ USER на admin-login и новый logout. Полный real-provider
  acceptance Telegram/VK остаётся ручным шагом после deploy под настоящими аккаунтами.
  Реализация выпущена commit `54fc400`: Web, TG, VK и затем Guide развёрнуты на одном SHA;
  Web/Guide `running:healthy`, очередь Coolify пуста. Production acceptance под тестовым
  USER после deploy подтвердил email-login, новый пустой dashboard/EMAIL identity,
  Telegram deep link в `@RobloxBankBot`, logout без служебного экрана, доступность
  `/admin/login` и переход «Кабинет» с главной. HTTP smoke Guide/CSP/API — `24/24`.
  Полный Telegram callback требует подтверждения в реальном Telegram, а VK SDK в in-app
  браузере завершился provider timeout, поэтому оба real-provider пункта намеренно не
  отмечены как закрытые. Maintenance и `SITE_ACQUIRING_ENABLED=false` не менялись. Полный
  release-отчёт опубликован в Trello-карточках ЛК `r1UmE4AS`, VK auth `yWoGVP2g` и
  mobile/accessibility `3rAHOEnn`; P0-карточки оставлены открытыми до живой приёмки.
- **Внешние launch-gates остаются обязательными:** письменная категория Т-Банка, юрпроверка
  модели/бренда, реквизиты/ККТ и фактическая локализация первичной БД в РФ не заменяются
  программным кодом.

### Точка входа следующей сессии

Следующую сессию начинать без повторного общего аудита, в таком порядке:

1. После deploy выполнить real-provider acceptance Telegram-входа/привязки через
   `@RobloxBankBot` и VK-входа под настоящими аккаунтами; проверить возврат из Telegram/VK
   WebView и отсутствие переключения чужой сессии.
2. Проверить iPhone Safari, Android Chrome, Telegram WebView и VK WebView: клавиатуру,
   back/refresh/deep link, плохую сеть, восстановление сессии и крупный системный шрифт.
3. После deploy проверить новые 404/500 и PII-safe CWV/error telemetry в production;
   эмуляционный desktop/mobile gate уже закрыт, физические устройства и полевой CWV
   baseline остаются ручной приёмкой.
4. После UX-хвоста продолжить обязательные launch-gates этапов 1, 3, 5–7: identity/link/merge,
   ПД и публичные документы, terminal/ККТ test matrix, E2E, monitoring и soft launch.

Новые замечания владельца по развёрнутой версии имеют приоритет над этим порядком и должны
добавляться в тот же release checklist, а не теряться в отдельном списке.

## 1. Итог ревью: сейчас NO-GO для денег; ссылка на витрину возможна с выключенной оплатой

Публичная витрина уже открыта 17.07: `MAINTENANCE_MODE=off`, public smoke `15/15`.
`SITE_ACQUIRING_ENABLED=true` не задан, поэтому код технически не позволяет создать `Init`
и принять деньги. Ссылку можно использовать для предварительного просмотра только после
быстрых UI/auth/Guide фиксов из
[аудита 17.07](tbank-precheck-2026-07-17.md). Боевой запуск остаётся NO-GO до launch-gates
раздела 10.

Представлять текущий сайт как полностью готовый к формальной приёмке и принимать на нём
деньги нельзя. Code foundation цены, identity, canonical order и обработки событий уже
реализован, но внешние юридические/данные/terminal/ККТ gates и ряд видимых дефектов не
закрыты.

| Приоритет | Блокер | Подтверждённое состояние |
|---|---|---|
| P1 | Предварительная витрина требует release mobile-fix | На release-candidate устранён overflow карточки главной; требуется обычный Web/Guide rollout и production mobile smoke, VK ID остаётся скрыт fail-closed |
| P0 | Канонический checkout развёрнут, но не прошёл payment E2E | Migration применена и код задеплоен 13.07 без legacy `Product/default-calc`; kill-switch выключен, боевой Init/receipt/callback test matrix впереди |
| P0 | Цена не прошла payment E2E | Quote уже одноразово потребляется каноническим order flow, но сумма ещё не проверена реальным Init/receipt/callback test matrix |
| P0 | Общий клиентский аккаунт не завершён | Email и TG login/link, identity foundation и ЛК с `WbOrder`/бонусами готовы; остаются email verification/reset/throttling/evidence consent, real-provider acceptance, безопасные VK link/unlink и recovery. Детали: `docs/auth-account-readiness-plan.md` |
| P0 | Payment E2E не завершён | Strict callback/event/outbox foundation и production migrations готовы; outbox worker развёрнут, но нет terminal/refund/ККТ test matrix и reconciliation UI |
| P0 | Нет готовой фискализации | Checkout собирает email и формирует `Receipt/Items` fail-closed, но нет согласованных ККТ-классификаторов, возвратного/закрывающего чека и проверенного сценария ОФД |
| P0 | Не выполнен публичный чек-лист Т-Банка | Юридические реквизиты, email, телефон, часы поддержки и SLA заполнены; остаются юридическая приёмка, ККТ/ОФД и проверка возвратов |
| P0 | Риск 152-ФЗ | Основная БД находится вне РФ, хотя политика заявляет локализацию в РФ; не зафиксированы локализация первичного сбора, уведомление РКН и трансграничный контур |
| P0 | Категория и бренд требуют письменного решения | Правила Roblox ограничивают стороннюю продажу/передачу Robux и коммерческое использование бренда; слово «Банк» также требует юрпроверки |
| P1 | Прод-качество не закрыто | SDK/headers/rate-limit foundation и локальная theme hydration-гонка закрыты; остаются полноценные E2E, accessibility/performance baseline и общий ESLint debt |

Вывод: maintenance уже снят только для предварительной витрины; acquiring оставляем
fail-closed до прохождения launch gates из раздела 10.

## 2. Что именно проверено

- Текущие `docs/`, `HANDOFF.md`, Prisma schema/migrations, сайт, боты, auth, checkout,
  webhook, guide и TWA-уведомления.
- Публичный production по HTTP, включая `/`, `/guide`, `/api/health`, `/api/pricing`.
- Локальная витрина desktop/mobile и production build.
- Только агрегирующие read-only запросы к общей БД, без вывода PII.
- Актуальная официальная документация Т-Банка, Telegram, Roblox и тексты 152-ФЗ.
- `npm test`: 30/30 тестов; TypeScript корня и ботов: без ошибок; production build: успешен.
- `eslint src --quiet`: 387 ошибок; общий lint дополнительно сканирует чужие
  `.claude/worktrees` и выдаёт 2199 проблем. Это не равно 2199 дефектам production-кода,
  но CI-гейт сейчас непригоден.

Это инженерный и продуктовый аудит, а не юридическое заключение и не внешний pentest.
Юридические P0 ниже должны подтвердить профильный юрист, оператор фискализации и Т-Банк.

## 3. Требования владельца: текущее состояние и целевой результат

### 3.1 Единый курс сайта, TG и VK

Первое расхождение устранено 2026-07-12: TG, VK и Web импортируют одну чистую
`retail-direct-v1` функцию; `/api/pricing` и калькулятор используют её же. Точные пакеты и
границы покрыты contract-тестом. С 2026-07-13 новый checkout принимает только server quote;
production rollout и реальная payment test matrix ещё не выполнены.

Текущая каноническая политика ботов, которую предлагается сделать базовой для сайта:

| Пакет | Цена |
|---:|---:|
| 100 R$ | 160 ₽ |
| 200 R$ | 260 ₽ |
| 300 R$ | 360 ₽ |
| 400 R$ | 460 ₽ |
| 500 R$ | 450 ₽ |
| 800 R$ | 720 ₽ |
| 1000 R$ | 800 ₽ |
| 1200 R$ | 960 ₽ |
| 1500 R$ | 1050 ₽ |
| 2000 R$ | 1400 ₽ |

Для произвольной суммы: `<500 → 1.0 ₽/R$ + 60 ₽`, `500–999 → 0.9`,
`1000–1499 → 0.8`, `>=1500 → 0.7`.

Целевая реализация:

1. Вынести чистую расчётную функцию и типы в общий domain-модуль, импортируемый Web, TG и VK.
2. Хранить активную версию политики в БД (`PricingPolicy`: версия, границы, надбавки,
   активность, время действия, кто изменил), а не в трёх hardcode.
3. Добавить серверный `PriceQuote`/quote-id с `policyVersion`, базовой ценой, бонусом,
   скидкой, итогом и `expiresAt`.
4. Checkout принимает только quote-id и заново проверяет его на сервере; сумму из клиента
   не считает источником истины.
5. Гость видит базовый курс. После TG/VK-login тот же quote учитывает сохранённые бонусы и
   скидки; в интерфейсе отдельно видны база, бонус и итог.
6. Изменение курса публикуется одной операцией и сразу применяется всеми тремя каналами;
   уже выданная короткая котировка не меняется посреди оплаты.

Обязательные contract-тесты: точные пакеты выше и границы `499/500`, `999/1000`,
`1499/1500`, включая надбавку 60 ₽, персональный бонус и истёкшую котировку.

### 3.2 Новая инструкция `/guide`

**Production UI-релиз `dfc9a4e` от 15.07.2026:** витрина и инструкция работают по
search-first модели.
После пакета и ника клиент сначала видит все геймпассы на продажу, отсортированные по
готовности цены; только пустой/неверный результат ведёт в гайд. Девять шагов теперь общие
для `WB/SITE/BOT`, а SITE сохраняет свой checkout-финал и редактирование желаемой суммы
только на шаге расчёта. Payment launch gates ниже не сняты.

**Implementation batch 13.07 — выполнено:**

- [x] Полностью убрать квадратный legacy checkout и собрать rounded Violet / Frost flow.
- [x] Сохранить server quote, проверку gross-цены, email/consent и payment handoff без
  изменения доменного контракта.
- [x] Добавить в site guide произвольный amount из единого pricing policy:
  `CUSTOM_MIN=100`, `CUSTOM_MAX=100 000`; быстрые варианты включают `10k/20k`.
- [x] Синхронно пересчитывать gross pass price и передавать amount+username в checkout.
- [x] Поднять базовый body до 17 px, мелкий текст критического потока — минимум до 13 px.
- [x] Проверить checkout/guide на 390 px: горизонтального overflow нет; ручной `25 000 R$`
  даёт gross-цену `35 715 R$`.
- [x] Удалить отдельный `SiteGuide` и использовать актуальную WB-медиа-основу для SITE.
- [x] Перенести пакет+ник сразу в checkout; показывать все sellable passes и единственное
  ценовое совпадение выбирать автоматически.
- [x] Сохранять `amount+username+gamepassId` при возврате из инструкции в checkout.
- [x] Проверять ник и геймпассы уже в калькуляторе; показывать Roblox-avatar и следующий
  CTA без лишнего перехода.
- [x] Показывать на подтверждении avatar аккаунта и thumbnail выбранного пасса.
- [x] Разрешить выбрать существующий пасс другой цены в границах сайта и пересчитать
  получаемые R$ с тем же серверным допуском ±2 R$, что использует buyout guard.
- [x] Исправить SSR/client theme mismatch; измеренный минимум overlay-меток — `13 px`,
  основной текст — `17 px`, поля — `18 px`.
- [ ] После решения launch gates выполнить боевой payment E2E; этот UI batch сам по себе
  не снимает maintenance и `SITE_ACQUIRING_ENABLED=false`.

`/guide?source=wb`, обычный `/guide?source=site` и `source=direct` используют mobile-first
`WBInstructionV2` с актуальными скриншотами, видео, Managed pricing и поиском геймпасса.
Режим задаёт только номинал/редактирование и финальный CTA; дублирующего SITE JSX больше нет.
SITE-режим дополнительно рендерит общий верхний `Navbar`, поэтому инструкция доступна из
верхнего меню работающей витрины; WB-режим сохраняет отдельный заголовок и входной гейт.

Целевой вариант (пункты 1–4 развёрнуты в production 15.07):

1. Выделить общую основу `GamepassGuide`: создание experience/pass, отключение Managed
   pricing, расчёт gross-цены, публикация и поиск по нику.
2. Оставить разные окончания одного сценария:
   - `WB`: код → канал TG/VK → передача найденного геймпасса;
   - `SITE/DIRECT`: выбранный пакет и quote → найденный геймпасс → checkout → статус заказа;
   - `BOT/DIRECT`: возврат в тот бот, где начат заказ.
3. Не копировать JSX и тексты между версиями: шаги, assets и warning-блоки должны иметь один
   источник, а различаться только режимом и CTA.
4. Передавать сумму из checkout в гайд и обратно через серверный draft/quote, чтобы клиент
   не вводил всё повторно.
5. Удалить неподтверждённые способы оплаты и обещания вроде Apple Pay/Google Pay,
   «мгновенно», «24/7» и «live», пока они не обеспечены реальным контуром.
6. Проверить реальные устройства: iPhone Safari, Android Chrome, desktop Chrome/Safari,
   VK WebView и Telegram WebView; отдельно — крупный шрифт, клавиатура и плохая сеть.

Definition of Done: новый пользователь без подсказки создаёт правильный продаваемый
геймпасс, видит точную gross-цену с комиссией Roblox, находит свой pass и возвращается в
сохранённый checkout; аналитика показывает drop-off каждого шага.

### 3.3 Единая БД, узнавание клиента, TG/VK-login и ЛК

Физически Web, TG и VK уже работают с одной БД и таблицей `User`, поэтому переносить
клиентскую базу «с нуля» не нужно. Проблема — в модели идентичности и чтении истории.

Агрегированный снимок production на 2026-07-12:

| Показатель | Значение |
|---|---:|
| `User` всего | 414 |
| с Telegram ID | 238 |
| с VK ID | 175 |
| с email | 1 |
| одновременно TG+VK | 0 |
| email+социальный ID | 0 |
| пользователи с бонусом | 48 |
| бонусы на балансах | 4700 R$ |
| `WbOrder` | 433 |
| уникальные покупатели `WbOrder` | 388 |
| прямые заказы ботов | 21 |
| завершённые `WbOrder` | 340 |
| legacy `Order` сайта | 0 |

Есть как минимум один повторяющийся Roblox username у разных `User`, поэтому ник Roblox
нельзя использовать для автоматического объединения аккаунтов.

Открытые дефекты идентичности:

- VK-login узнаёт существующий `vkId`; безопасные отдельные VK link/unlink и merge-console
  ещё не реализованы, поэтому ЛК не маскирует обычный login под «привязать VK».
- Telegram login/link реализован через одноразовый bot-assisted challenge; остаётся живой
  acceptance после deploy под реальным Telegram-пользователем.
- Email-регистрация создаёт отдельный `User`; безопасного объединения с ботом нет.

Закрыто после исходного аудита: `/dashboard` читает legacy `Order` и `WbOrder` всех
источников, показывает реальные статусы/бонусы, а credentials provider и форма входа
согласованы. Follow-up 15.07 добавил новый Violet/Frost action-center, карточки истории,
события, payment/receipt snapshot и identity settings; read-only visual/data QA прошёл на
реальных историях. Follow-up `008735e` развёрнут на Web и Guide с повторным smoke `23/23`;
Follow-up 15.07 дополнительно прошёл live email acceptance на production под отдельной
USER-учётной записью: dashboard, пустая история и EMAIL identity открываются корректно,
фиктивные заказы не создавались. Real-provider Telegram/VK acceptance остаётся отдельным
пунктом.

Целевая модель:

- `User` — единственный профиль клиента.
- `UserIdentity` — проверенная внешняя идентичность
  `(provider, subject, userId, verifiedAt, metadata)` с уникальностью provider+subject.
- `AccountMergeAudit` — кто, когда и на основании двух повторных авторизаций объединил
  профили, какие заказы/бонусы перенесены, возможность расследования и ручного rollback.
- `BonusLedger` — неизменяемые начисления/списания с idempotency key; `User.balance` остаётся
  быстрым материализованным итогом и сверяется с ledger.

Миграция и правила:

1. Backfill всех существующих `tgId`, `vkId`, email в `UserIdentity`, не меняя `User.id`.
2. Вход тем же TG/VK subject всегда открывает существующий профиль и его `WbOrder`/бонусы.
3. Telegram bot-assisted Web Login проверяет Telegram HMAC, использует случайный
   одноразовый `state` с TTL 5 минут и хранит в БД только SHA-256; VK остаётся с серверной
   проверкой токенов.
4. Связать два существующих профиля можно только после свежей авторизации в обоих каналах.
   Имя, avatar, email или Roblox nick доказательством не являются.
5. При merge объединить историю и bonus-ledger транзакционно; одинаковые начисления с одним
   origin/idempotency key не удваивать. До миграции снять контрольные суммы, после — сверить
   `414` профилей, `433` заказов и `4700 R$` без потерь.
6. Первое web-посещение существующего клиента: «С возвращением, {имя}. Мы нашли ваши заказы
   и бонусный баланс», затем конкретные числа и последняя заявка.
7. ЛК показывает единый timeline WB/DIRECT/SITE, текущий статус и ETA, bonus ledger,
   связанные TG/VK, безопасное unlink и канал уведомлений.

Рекомендация для конверсии: просмотр и базовый расчёт доступны гостю; применение бонусов
требует TG/VK-login. Гостевой checkout возможен только с проверенным контактом для чека и
последующей magic-link привязкой заказа.

### 3.4 Заказы, оплата и выполнение

Legacy `Order` не является хорошим вторым источником заказов: в нём нет ни одной production
записи, а рабочие 433 заказа находятся в `WbOrder`. Рекомендуемый минимально рискованный путь:

**Статус 2026-07-13:** пункты 1–2 и server-side consumption quote реализованы и задеплоены
(additive migration применена к production); legacy adapter/удаление старой модели и
outbox worker ещё не выполнены.

1. Сделать `WbOrder` каноническим retail-заказом (позже нейтрально переименовать), добавить
   `SITE` в `orderSource` и `WEB` в канал создания.
2. Добавить `PaymentAttempt` (provider, public order id, payment id, amount kopecks,
   status, raw-event hash, timestamps) и `OrderEvent/Outbox`.
3. На переходный период дать read-adapter для legacy `Order`, затем удалить его после
   подтверждения нулевого остатка и удаления старого checkout-кода.
4. Публичный статус открывать по случайному status-token либо владельцу сессии, не только по
   предсказуемому внутреннему CUID.

До `Init` сервер обязан:

- проверить quote, срок и policy version;
- проверить Roblox user, владельца геймпасса, sale-state, точную gross-цену и соответствие
  выбранному пакету;
- создать заказ и payment attempt атомарно с idempotency key клиента;
- собрать email или телефон для чека и зафиксировать версию оферты/согласие;
- передать уникальный `OrderId`, `NotificationURL`, `SuccessURL`, `FailURL`, `Receipt` и
  `Items`, где сумма позиций равна `Amount`.

Callback Т-Банка обязан:

- проверить подпись и свежесть по официальному алгоритму;
- сверить `TerminalKey`, `PaymentId`, `OrderId` и `Amount` с `PaymentAttempt`;
- атомарно применять разрешённый переход статуса ровно один раз;
- отвечать `200` с телом `OK` только после durable-записи события; неверная подпись и
  временная внутренняя ошибка не должны тихо подтверждаться;
- помещать выполнение заказа в outbox/очередь с retry и dead-letter, не считать обычный
  `fetch()` успехом без проверки HTTP status;
- брать ник, сумму и pass только из БД, не из callback payload;
- иметь отдельные сценарии `AUTHORIZED`, `CONFIRMED`, `REJECTED`, `CANCELED`, refund,
  частичный/полный возврат и ручное расследование.

Для фискализации нужны согласованные система налогообложения, ставка НДС, предмет/способ
расчёта, ККТ/ОФД, первый чек, закрывающий чек при предоплате и чек возврата. До этого нельзя
просто добавить фиктивный `Receipt`.

## 4. Готовность сайта к модерации Т-Банка

Официальный чек-лист Т-Банка требует, чтобы покупатель заранее понимал, кто продавец, что он
покупает, за сколько и на каких условиях, как связаться и вернуть деньги. Перед заявкой на
всех публичных страницах должны быть:

- полные реквизиты ИП/ООО: название, ИНН, ОГРН/ОГРНИП, юридический/почтовый адрес;
- поддержка: телефон, email, часы, реальный SLA;
- подробное описание услуги, цена, сроки и способ выполнения;
- способы оплаты и официальные логотипы Т-Банка/поддерживаемых платёжных систем;
- оферта, политика обработки ПД, согласие, правила отмены/возврата и путь подачи обращения;
- возрастной сценарий и решение по согласию законного представителя для несовершеннолетних;
- только доказуемые обещания. Плашки «LIVE», «24/7», «мгновенно», «полная автоматизация» и
  искусственные отзывы скрываются, пока нет метрик/доказательств;
- действующая категория/MCC и описание бизнеса, заранее письменно согласованные с Т-Банком.

До разработки платёжной части нужно получить письменный ответ Т-Банка по модели услуги.
Официальные правила Roblox прямо относят стороннюю покупку/продажу/передачу Robux к
нарушениям, а коммерческое использование названия/логотипа ограничено. Это экзистенциальный
риск для эквайринга и продукта, а не текстовая правка в футере.

Дополнительный P0 по данным: текущая основная БД размещена вне РФ, а в политике обещано
обратное. До публичного запуска нужны карта данных, российская база для первичного
сбора/хранения данных граждан РФ, решение по трансграничной передаче и проверка уведомлений
Роскомнадзора. Миграция проводится с backup, контрольными суммами и rollback-планом.

Официальные источники:

- [Т-Банк: требования к сайту и условия подключения](https://www.tbank.ru/business/help/business-payments/internet-acquiring/how-work/working-conditions/)
- [Т-Банк API: Init](https://developer.tbank.ru/eacq/api/init)
- [Т-Банк: обработка notification](https://developer.tbank.ru/eacq/intro/developer/notification)
- [Т-Банк: фискализация](https://developer.tbank.ru/eacq/scenarios/fiscalization)
- [Telegram: Log In With Telegram](https://core.telegram.org/bots/telegram-login)
- [Roblox Terms of Use](https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use)
- [Roblox Name and Logo Guidelines](https://en.help.roblox.com/hc/en-us/articles/115001708126-Roblox-Name-and-Logo-Community-Usage-Guidelines)
- [152-ФЗ, статья 18](https://www.consultant.ru/document/cons_doc_LAW_61801/cbf4e15b7c330f9372e876cdf2bc928bad7950ef/)
- [152-ФЗ, статья 22](https://www.consultant.ru/document/cons_doc_LAW_61801/d996966e22e1320c9de1ab82d9f6be12c3d9d765/)
- [Закон о банках, статья 7](https://www.consultant.ru/document/cons_doc_LAW_5842/a0d6b7fcedc765dfbbcb94fcb60a367b65f72686/)

## 5. Бренд и дизайн

### 5.1 Название

Вкладывать деньги в новый логотип «Роблокс Банк» до юрпроверки не рекомендуется:

- «Roblox/Роблокс» — чужой товарный знак и коммерческое использование требует проверки
  лицензии/разрешения;
- «Банк» может создавать впечатление финансовой организации и требует отдельной проверки
  юристом, включая правила использования слова в фирменном наименовании;
- дисклеймер «мы не связаны с Roblox» полезен, но сам по себе не даёт права на бренд.

Варианты для обсуждения (это creative directions, не проверенные товарные знаки):

1. **Кубикс** — независимое короткое имя; descriptor: «игровой маркет для пополнения
   баланса». Рекомендованный путь после поиска Роспатента/доменов.
2. **Пиксель Маркет** — сразу объясняет игровую категорию, менее привязан к одной платформе.
3. **RB Market** — мягкий переход с текущего домена, но аббревиатуру и знак всё равно нужно
   проверить.
4. **Dual-brand migration** — 30–60 дней показывать новое имя и подпись «раньше RobloxBank»,
   затем убрать старое имя и сделать 301 на новый домен.

Если владелец временно сохраняет текущее название, визуальные варианты:

- компактная монограмма `РБ` + читаемое «Роблокс Банк» без имитации логотипа Roblox;
- словесный знак «РОБЛОКС / БАНК» в двух строках, где зелёный акцент только на CTA;
- переходная шапка «RB Market — сервис robloxbank.ru».

Все варианты проходят поиск Роспатента, доменов и письменную проверку до внедрения.

### 5.2 Визуальная система

Рекомендация — **Pixel Trust**: fintech-структура и честная информационная иерархия, а pixel
style остаётся как характер, не как шум.

- крупный русский wordmark и понятный descriptor вместо крошечного английского логотипа;
- один главный CTA, рядом реальная цена и срок, ниже — «как это работает»;
- спокойный тёмный фон, белая типографика, зелёный для действия/успеха, красный только для
  ошибки; меньше постоянной анимации и частиц;
- блок доверия: продавец, контакты, оплата, возврат, безопасность, реальные статусы;
- калькулятор с пакетами и полной расшифровкой: R$, цена геймпасса, Roblox fee, к оплате;
- единый shell главной, guide, checkout, success/status и ЛК;
- WCAG AA для контраста/focus, клавиатура, `prefers-reduced-motion`, touch-target >=44 px.

Альтернативы:

- **Dark Fintech** — почти без пиксельных деталей, самый спокойный вариант для модерации;
- **Game Native** — ярче и эмоциональнее, но только после прохождения эквайринга и проверки
  детской аудитории/обещаний.

## 6. Целевая архитектура

```text
TG login ─┐
VK login ─┼──> UserIdentity ──> User ──> BonusLedger
Email ────┘                         └──> единый ЛК / уведомления

Web ─┐
TG  ─┼──> PricingPolicy ──> PriceQuote(policyVersion, expiresAt)
VK  ─┘                              │
                                    v
                           WbOrder(source=SITE)
                                    │
                                    v
                          PaymentAttempt(T-Банк)
                                    │
                         verified webhook/event
                                    │
                                    v
                         Outbox ──> fulfillment
```

Инварианты:

- один человек может иметь несколько проверенных identities, но один канонический `User`;
- один заказ принадлежит одному `User` или гостевому verified-contact и имеет одну
  зафиксированную котировку;
- деньги хранятся в целых копейках, Robux — в целых единицах, расчёт детерминирован;
- внешний callback не исполняет бизнес-логику повторно;
- изменение цены не меняет уже созданный платёж;
- каждое начисление/списание бонуса и каждый переход денег имеет audit trail.

## 7. Этапы реализации

Оценка — **22–35 инженерных рабочих дней** для одного исполнителя, без времени ожидания
юриста, Т-Банка, ККТ/ОФД, DNS и переноса инфраструктуры. После этапа 0 часть UI, данных и
платёжного контура можно вести параллельно.

### Этап 0. Решения и freeze — 0.5–2 дня + внешнее ожидание

- Получить реквизиты, контакты, налоговый/кассовый сценарий, правила возврата.
- Письменно согласовать с Т-Банком категорию/MCC и формулировку услуги.
- Получить юррешение по Roblox/бренду/возрасту и слову «Банк».
- Выбрать российский Postgres и окно миграции.
- Утвердить decisions из раздела 11.

**Gate:** без письменного решения по категории не начинать production-интеграцию терминала.

### Этап 1. P0 безопасность и данные — 2–4 дня

- Подготовить backup, restore drill, checksum и миграцию основной БД в РФ.
- Исправить политику ПД только после фактического контура; оформить data map, retention,
  удаление/экспорт и трансграничные процессы.
- Удалить детерминированный пароль из seed; bootstrap admin только одноразовым секретом
  из env. На 2026-07-12 такого admin в production нет.
- Закрыть публичные API rate limit, CSRF/ownership, добавить security headers и безопасное
  логирование без ПД/токенов.
- Убрать глобальный Telegram SDK с обычной витрины; подключать SDK только нужному layout.

**DoD:** restore проверен, сверка строк/заказов/бонусов равна исходной, политика не
противоречит инфраструктуре, критические auth/payment API проходят security tests.

### Этап 2. Domain foundation: цена, клиент, заказ — 4–6 дней

- Миграции `PricingPolicy`, `PriceQuote`, `UserIdentity`, `BonusLedger`,
  `AccountMergeAudit`, `PaymentAttempt`, `OrderEvent/Outbox`.
- Backfill identities и bonus ledger с dry-run/отчётом; zero-loss reconciliation.
- Общий pricing-модуль и contract-тесты для Web/TG/VK.
- Расширить канонический `WbOrder` источником `SITE/WEB`; adapter legacy `Order`.

**DoD:** три процесса возвращают одинаковую цену на общей тестовой матрице; повторный login
находит тот же `User`; prod-like migration дважды воспроизводима.

### Этап 3. Авторизация и ЛК — 4–6 дней

- Telegram login/link через bot-assisted deep link, server HMAC и одноразовый DB challenge.
- Отдельные действия login/link/unlink/merge для VK и TG; step-up auth для merge.
- Исправить credentials provider; решить судьбу email/password (verification, reset,
  throttling) или заменить magic link.
- Новый dashboard: история всех источников, бонусы, receipt/статус, identity settings,
  warm welcome и notifications. **Follow-up 15.07 завершил клиентскую поверхность: action
  center, корректные source-aware статусы, карточки истории, payment/receipt snapshot,
  verified identity settings и contextual notifications. Полные link/unlink/merge и
  предпочтения доставки уведомлений остаются отдельным identity foundation.**
- Login/register/admin-login приведены к тому же Violet/Frost shell; credentials email
  нормализуется, USER не допускается в admin, выход из ЛК не показывает служебный экран
  Auth.js. Live email acceptance на production выполнен на отдельном тестовом USER.
- Admin merge-console только с audit, preview и двухэтапным подтверждением.

**DoD:** существующие TG/VK-пользователи видят свои заказы/бонусы; негативные тесты не дают
привязать чужой ID; merge сохраняет контрольные суммы и идемпотентен.

### Этап 4. Guide, витрина и публичные документы — 3–5 дней

- Собрать единый `GamepassGuide` из актуальной WB-версии. **Развёрнуто 15.07 в `dfc9a4e`:
  `WBInstructionV2` обслуживает WB/SITE/BOT, отдельный `SiteGuide` удалён; smoke 23/23.**
- Внедрить выбранную brand/design direction, честные тексты, mobile-first checkout.
- Страницы: контакты/реквизиты, оферта, ПД/consent, возвраты, способы оплаты, FAQ,
  status и 404/500. **16.07 custom 404/error surfaces готовы; юридические реквизиты и
  email, телефон, часы поддержки и SLA внесены в `/legal/offer`, `/legal/policy` и `/legal/details`; legal pages остаются
  fail-safe `noindex` и исключены из sitemap до полной приёмки документов.**
- Реальные отзывы либо скрытый блок; никакого seed/fake content.
- SEO, OpenGraph, sitemap/robots, accessibility и performance budget.
  **Metadata/canonical/robots boundaries и сбор CWV готовы; реальные field CWV и финальный
  accessibility audit остаются launch gate.**

**DoD:** content/legal checklist принят владельцем и юристом; гайд проходит usability test;
никаких placeholder и недоказуемых обещаний.

### Этап 5. Т-Банк, ККТ и fulfillment — 5–8 дней

- Новый checkout поверх канонического заказа/quote/payment attempt. **Код задеплоен,
  migration применена; staging/terminal test matrix впереди.**
- Полный `Init`, receipt/items, callback state machine и строгие сверки. **Foundation готов;
  реальные terminal/ККТ test cases впереди.**
- Durable outbox, retry/dead-letter, ручное восстановление и алертинг. **Worker с lease,
  retry/dead-letter и alert готов; ручной replay UI остаётся.**
- Cancel/refund, чеки предоплаты/закрытия/возврата, сверка с личным кабинетом Т-Банка/ОФД.
  **Full/partial refund contract готов; DEMO-terminal/ОФД matrix остаётся.**
- Пройти официальные test cases, отдельно дубликат callback, timeout и падение downstream.

**DoD:** ни один повтор callback не дублирует заказ/бонус/выкуп; временная ошибка реально
повторяется; сумма UI=quote=Init=receipt=БД; возврат завершает деньги и чек.

### Этап 6. QA и hardening — 3–5 дней

- Playwright E2E: guest, TG, VK, existing customer, merge, bonus, checkout, success/fail,
  retry/refund.
- Unit/property/contract tests цены; integration tests БД и webhook; load/abuse tests.
- Убрать hydration mismatch; настроить ESLint ignore для чужих worktrees и нулевой baseline
  хотя бы для затронутого storefront/auth/payment scope. **Theme SSR/client mismatch закрыт
  15.07; worktrees исключены 16.07, затронутый site-scope проходит без errors; общий legacy
  warning baseline остаётся.**
- Security headers/CSP, dependency audit, accessibility, Core Web Vitals и реальные webviews.
- Наблюдаемость: payment success, callback lag, stuck orders, outbox retries, quote drift,
  auth/link failures; алерты без PII. **Клиентские CWV/render errors и Web↔Guide version
  drift закрыты foundation 16.07; payment/business dashboards остаются.**

**DoD:** CI зелёный; критический E2E повторяем на staging; нет P0/P1 дефектов.

### Этап 7. Soft launch и модерация — 1–3 дня + ожидание Т-Банка

- Staging acceptance владельцем; freeze цены/контента на время модерации.
- Открыть production ограниченному проценту/allowlist, затем 10% → 50% → 100%.
- Сверить первые оплаты, чеки, fulfillment и обращения вручную.
- Только после стабильного окна выключить maintenance для всех и отправить/завершить
  модерацию.

**Rollback:** kill switch нового checkout, сохранение guide/ЛК read-only, запрет новых `Init`,
но продолжение обработки уже принятых callback/outbox.

## 8. Матрица приёмки

### Цена

- Все фиксированные пакеты и boundary cases совпадают в Web/TG/VK до копейки.
- Персональный бонус виден до согласия на оплату и списывается один раз.
- Просроченный/подменённый quote отклоняется; старая цена не «прыгает» после `Init`.

### Клиент

- Существующий TG/VK subject открывает прежний `User`, `WbOrder` и bonus balance.
- Чужой Roblox nick/email не позволяет захватить аккаунт.
- Link требует обе свежие авторизации; повтор link/merge безопасен.
- Миграционная сверка сохраняет все 433 заказа и 4700 R$ бонуса.

### Guide/UX

- Гайд использует одну актуальную основу и разные корректные CTA для WB/SITE/BOT.
- Back/refresh/deep link восстанавливают draft; крупный шрифт и экранная клавиатура не
  перекрывают действие.
- Нет горизонтального скролла, hydration error и ложных обещаний.

### Деньги

- Сервер не доверяет сумме/pass из клиента; сумма везде в копейках и совпадает с receipt.
- Дубликат `Init`/callback не создаёт второй платёж или fulfillment.
- Неверная подпись, amount или terminal не меняют заказ и создают безопасный alert.
- Downstream 500 оставляет outbox для retry, а не переводит заказ в processing/success.
- Refund/cancel и все нужные чеки проверены end-to-end.

### Модерация и эксплуатация

- Реквизиты, контакты, оферта, ПД, возвраты и payment logos доступны без login.
- Юрист, ККТ/ОФД и Т-Банк письменно приняли соответствующие части.
- Backup/restore, runbook, alerts, support SLA и on-call владельца проверены.

## 9. Метрики после запуска

- quote → checkout → `Init` → `CONFIRMED` → fulfilled conversion;
- price drift (целевое значение `0`), duplicate callback effects (`0`);
- `CONFIRMED`, но не fulfilled за SLA; outbox retries/dead letters;
- доля существующих клиентов, успешно узнанных TG/VK; link/merge failures;
- drop-off по шагам guide и причинам gamepass validation;
- возвраты/chargeback/support contacts на 100 заказов;
- Web Vitals и JS errors по route/device/webview.

## 10. Launch gates: когда можно включить оплату и считать публичный запуск завершённым

Все пункты обязательны:

- [ ] Т-Банк письменно подтвердил категорию/MCC и подключил terminal.
- [ ] Юрпроверка модели Roblox, бренда, возраста, оферты, ПД и возвратов завершена.
- [ ] Первичная база ПД локализована в РФ; миграция/restore/reconciliation пройдены.
- [x] Одна pricing policy и quote работают одинаково в Web/TG/VK.
- [ ] TG/VK-login, link/merge и ЛК проходят E2E на существующих клиентах.
- [x] Канонический SITE-order создаётся без legacy `Product` FK.
- [ ] `Init`, receipt, callbacks, outbox, refund и ККТ прошли test matrix.
- [~] Публичные реквизиты/контакты/документы: юридические данные, email, телефон, часы
  поддержки и SLA заполнены; юридическая приёмка и финальные возвраты ещё не закрыты.
- [ ] Security, accessibility, mobile/webview, build и scoped lint gates зелёные.
- [ ] Есть monitoring, support/runbook, checkout kill switch и rollback drill.

## 11. Решения владельца для старта

Рекомендуемый пакет можно согласовать одним ответом либо изменить отдельные пункты:

1. **Цена:** сайт переходит на текущую ступенчатую политику TG/VK; бонус применяется после
   verified login. **Рекомендация: да.**
2. **Заказы:** расширяем `WbOrder` до канонического retail-order, legacy `Order` выводим.
   **Рекомендация: да.**
3. **Гость:** расчёт открыт всем; бонус — после login; покупка гостем возможна с verified
   email/телефоном и magic link. **Рекомендация: да.**
4. **Бренд:** сначала письменная юрпроверка; параллельно проверяем независимый «Кубикс» и
   два запасных имени. **Рекомендация: да.**
5. **Дизайн:** Pixel Trust как основное направление. **Рекомендация: да.**
6. **Отзывы:** до получения реальных подтверждённых отзывов блок скрыт.
   **Рекомендация: да.**
7. **Данные:** выбираем российский managed Postgres и мигрируем до запуска.
   **Рекомендация: обязательно.**
8. **Категория:** не интегрируем боевой terminal до письменного ответа Т-Банка.
   **Рекомендация: обязательно.**
9. **Email/password:** для клиентов — social login + magic link; пароль оставить только
   отдельному admin-контуру. **Рекомендация: да.**
10. **Входные данные владельца:** реквизиты, support phone/email/hours, налогообложение,
    ККТ/ОФД, политика возврата, реальные отзывы и контакт юриста/менеджера Т-Банка.
