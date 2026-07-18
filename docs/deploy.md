# Деплой

> Секреты, IP-адреса серверов, Coolify-панель и UUID сервисов — в локальном `HANDOFF.md`
> (в `.gitignore`, не в публичном репо).

## Модель деплоя

Каждый сервис — отдельный Docker-контейнер в Coolify:

| Сервис | Что это | Dockerfile |
|--------|---------|-----------|
| Web | Next.js: сайт, все `/api/*`, TWA | `Dockerfile` |
| Guide | билд только гейта `/guide?source=wb` | `Dockerfile.guide` + `next.config.guide.ts` |
| TG-бот | Telegraf-процесс | `bots/tg` |
| VK-бот | vk-io-процесс | `bots/vk` |
| Bridge | HTTP-прокси к Roblox/Telegram | `bots/shared/bridge.ts` |

## Как деплоить

Coolify настроен на **автодеплой по push в `main`** (GitHub webhook). Достаточно:

```bash
git push origin main
```

Ручной re-deploy / статус — через Coolify UI или API (детали и токен — в `HANDOFF.md`).
Вручную вызывать API деплоя, вставлять записи в БД и т.п. **не нужно**.

> ⚠️ **Не запускать ручной force-deploy сразу после `git push`.** Webhook уже стартовал
> сборку: ручной `POST /api/v1/deploy?...&force=true` создаёт **вторую параллельную сборку
> того же сервиса**, и на RF-хосте (2 vCPU / 4 GB) вторая падает на шаге
> `Running TypeScript ...` с `exit 255` **без compile-ошибки**. Так упал деплой 17.07:
> webhook-сборка `709f8e82` (11:59:30 → 12:01:46) прошла, а ручная API-сборка того же
> коммита (11:59:54 → 12:05:21) — упала. Прод при этом не пострадал: упавшая сборка не
> заменяет работающий контейнер, но в истории остаётся пугающий `failed`.
>
> Правило: после push **ждать webhook-сборку** (`GET /api/v1/deployments` — очередь пуста
> и статус `finished`), ручной deploy — только для Guide или когда webhook не сработал.
> Диагностика записи деплоя: поля `is_webhook` / `is_api` / `force_rebuild` в
> `GET /api/v1/deployments/<deployment_uuid>` показывают, кто именно её запустил.
>
> Перед выводом «деплой упал» сверять **что реально запущено**, а не только статус записи:
> `docker ps` на RF показывает тег образа с полным SHA
> (`z10ws7m1q45h281zwedmhei4:<sha>`), а `last-modified` отданных `/_next/static/chunks/*.css`
> — время сборки.

Web-фичи, которые меняют Prisma-схему, требуют синхронного применения миграций на прод-БД.
Если образ обновился, а миграции не применились, TWA/API могут падать на новых колонках.
Для партнёрского режима `Антон` это диагностируется как `503 PARTNER_SCHEMA_NOT_READY`
от `/api/twa/partners/anton/tasks`.

Порядок для таких случаев: сначала read-only `npx prisma migrate status`, затем аудит SQL на
destructive changes/существующие таблицы, только после этого `npx prisma migrate deploy`.
После применения проверять `migrate status` и сам API. 2026-07-09 этот порядок использован для
трёх partner-миграций; прод-БД после этого показывает `Database schema is up to date`.

> ⚠️ Миграция `20260712_identity_quote_foundation` должна быть применена **до** деплоя Web,
> содержащего `src/auth.ts` с `UserIdentity`: иначе VK-вход fail-closed, а `/api/pricing/quote`
> отдаёт `503`. Она additive: создаёт identity/ledger/policy/quote-таблицы, backfill-ит только
> legacy идентификаторы и opening-строки ненулевых бонусов; перед применением всё равно нужен
> обычный `migrate status` и backup/reconciliation из master plan.

> ⚠️ Миграция `20260713_canonical_web_order_foundation` должна идти до Web-кода нового
> checkout/webhook. Она additive для исторических заказов и добавляет `SITE/WEB`,
> `PaymentAttempt`, `OrderEvent`, `OutboxMessage`. После migration оставить
> `SITE_ACQUIRING_ENABLED=false`: включение требует отдельной staging test matrix,
> согласованных ККТ-параметров и всех launch-gates master plan.

> ⚠️ **Автодеплой НЕ покрывает Guide** — его деплоить вручную (Coolify UI/API) при
> изменениях в `src/app/guide/`, `src/app/layout.tsx`, `public/`, `VKAuthButton` и
> других файлах Guide-сборки. **Запускать ПОСЛЕ завершения Web-автодеплоя**: обе
> сборки идут на одном RF-сервере, параллельный запуск роняет Guide-билд без
> compile-ошибки (exit 255 после `npm ci` — так упала первая попытка 2026-07-06;
> ретрай после Web-сборки прошёл). 2026-07-09 после partner-миграций Guide был
> force-redeploy вручную, сборка завершилась успешно, TWA-партнёрский раздел проверен рабочим.
> После деплоя Web и/или Guide прогонять `node scripts/smoke-corridor.mjs` —
> проверяет гейт, чанки `/_next-guide`, vendor SDK, CSP-хосты VK (риск №16) и
> `/api/wb-code`; «страница 200» сама по себе ничего не гарантирует. С 16.07 обе сборки
> также отдают `X-RobloxBank-Guide-Release` — детерминированный fingerprint общих guide-
> исходников и assets. Smoke сравнивает SITE-ответ Web с WB-ответом Guide и падает, если
> контейнеры собраны из разных состояний. Это обнаружение рассинхрона, а не разрешение
> запускать две тяжёлые сборки параллельно: порядок Web → Guide остаётся обязательным.

Read-only smoke основной витрины:

```bash
npm run smoke:site                                      # production: 200 или штатный 503 root
npm run smoke:site -- --base=http://127.0.0.1:3000 --expect-public
npm run smoke:site -- --expect-maintenance
```

Он не пишет в БД: проверяет health и security headers, 404, robots/sitemap, SITE guide,
OpenGraph и корректный maintenance-ответ.

> ⚠️ **Dockerfile'ы ботов копируют исходники поимённо** (`COPY bots/tg/crons.ts …`), а не
> папкой. Новый `.ts`-файл в `bots/tg/` или `bots/vk/` **обязан быть добавлен в COPY-список**
> соответствующего Dockerfile — иначе образ соберётся зелёным (tsx резолвит импорты только в
> рантайме), а контейнер уйдёт в crash-loop с `MODULE_NOT_FOUND` на старте. Именно так TG-бот
> упал в проде 2026-07-04 (`auto-workers.ts` не попал в образ). `bots/shared/` копируется
> целиком — общий код туда добавлять безопасно.

## Env-переменные (имена, без значений)

**Web:** `DATABASE_URL`, `AUTH_SECRET` (или `NEXTAUTH_SECRET`), `NEXTAUTH_URL`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_VK_APP_ID`, `TG_TOKEN`, `TG_CHAT_ID`, `ADMIN_IDS`,
`ADMIN_SECRET`, `WB_API_TOKEN`, `MAINTENANCE_MODE` (опц., см. ниже), `SITE_UNLOCK_SECRET`
(опц., байпас техработ), `NEXT_PUBLIC_VK_AUTH_ENABLED` (опц.; fail-closed, VK ID виден
только при точном `true` после живого acceptance); B2B «Антон»:
`ANTON_GOOGLE_SHEETS_SPREADSHEET_ID`,
`GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEETS_PROTECTED_EDITORS` (email владельца
таблицы для защиты выполненных строк, Этап 5.8). SITE-эквайринг (по умолчанию выключен):
`SITE_ACQUIRING_ENABLED`, `SITE_ACQUIRING_MODE`, `SITE_ACQUIRING_ALLOWLIST_USER_IDS`,
`SITE_ACQUIRING_ROLLOUT_PERCENT`, `TINKOFF_TERMINAL_KEY`, `TINKOFF_SECRET_KEY`, `TINKOFF_TAXATION`,
`TINKOFF_ITEM_TAX`, `TINKOFF_PAYMENT_METHOD`, `TINKOFF_PAYMENT_OBJECT`. Классификаторы чека
не имеют default: их значения подтверждают бухгалтер/ККТ-оператор. Legacy automation:
`LOCAL_BOT_URL`, `INTERNAL_WEBHOOK_SECRET`, `BOT_API_TOKEN`.

Checkout читает per-session runtime-состояние эквайринга из `GET /api/acquiring/status`.
Master flag разрешает только exact `true`; mode принимает только `off`, `allowlist`,
`percentage`, `on` и fail-closed в `off`. При любом ответе кроме `{ enabled: true }` UI не
активирует платёжный CTA; серверный `POST /api/orders/create` независимо повторяет auth и
eligibility. Allowlist — comma-separated internal `User.id`; percentage — целое `0..100`.
Сначала задаётся mode/allowlist при master `false`, затем один последовательный deploy;
master включается отдельным изменением только перед allowlist E2E.

`BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD` — опциональная **одноразовая** пара
только для `prisma db seed` на новом окружении. Обе задаются вместе, пароль — от 16 символов,
после первого входа меняется. Без пары seed не создаёт admin; значения нельзя добавлять в
`.env.example`, docs или commit.

`SEED_DEMO_CONTENT=true` разрешён только локально: он добавляет непроверенные демонстрационные
отзывы. В production его не задавать — реальные отзывы приходят только из проверяемого
операционного потока.

**TG-бот:** `DATABASE_URL`, `TG_TOKEN`, `TG_CHANNEL_ID` (опц., гейт подписки), `ADMIN_IDS`,
`NEXT_PUBLIC_APP_URL` (или server-only `WEB_BASE_URL`) для callback bot-assisted web-login,
`VALIDATOR_SOURCE_URL`, `VALIDATOR_KEY`, health-мониторинг (`HETZNER_API_TOKEN`, `VDSINA_*`).

**VK-бот:** `DATABASE_URL`, `VK_TOKEN`, `VK_GROUP_ID`, `ADMIN_IDS`, `VALIDATOR_SOURCE_URL`,
`VALIDATOR_KEY`, `TG_TOKEN` (уведомления менеджерам идут через Telegram).

`ADMIN_IDS` должен быть одинаково задан в Web и TG-контейнере: Web рассылает всем
администраторам подтверждения ручных TWA-выкупов, TG — ручных покупок и auto-worker.
Значение — список Telegram ID через запятую; cookie и токены в эти уведомления не входят.

TG-сервис также является единственным payment outbox worker. После deploy в логах обязательна
строка `[PaymentOutbox] Worker started`; `DATABASE_URL`, `TG_TOKEN` и `ADMIN_IDS` нужны ему для
claim/delivery/dead-letter alerts. Не запускай второй polling TG instance без отдельной проверки
atomic claim и Telegram polling topology.

**Bridge:** `VALIDATOR_KEY`, `VALIDATOR_PORT`.

## Browser transport выкупа

Репозиторий содержит инструменты для контролируемого browser-выкупа (`scripts/browser-buyout-
session.sh`, `scripts/browser-buyout-probe.mjs`, `scripts/browser-buy-gamepass.mjs`) и
single-flight host service `scripts/browser-purchase-service.mjs`. Chrome с постоянным
профилем живёт на изолированном SG-сервере; service слушает только адрес docker bridge и
защищён Bearer-токеном. TG-контейнер ходит к нему напрямую через bridge, Web/TWA на другом
хосте — через постоянный ограниченный SSH-туннель. Публичного listener нет. Точные хосты,
systemd-состояние и доступ — только в `HANDOFF.md`.

Для воспроизводимого запуска после `npm ci` `puppeteer-core` зафиксирован в production-
зависимостях проекта. Перед каждой покупкой service инъецирует текущую `.ROBLOSECURITY` из
`GlobalSettings` через CDP; логины и пароли не хранятся. Драйвер подключается только к уже
запущенному Chrome и подтверждает успех по ownership **и точной дельте баланса**, а не по
клику/тексту интерфейса. Очередь строго последовательная. Полный порядок действий и границы — в
[`roblox-plus-buyout-plan.md`](roblox-plus-buyout-plan.md).

Runtime env Web и TG: `ROBLOX_PURCHASE_SERVICE_URL`,
`ROBLOX_PURCHASE_SERVICE_TOKEN`. URL различается по хосту; token одинаковый и хранится только
в Coolify/host env. При недоступности service денежные пути fail-closed оставляют заказ в
очереди и предлагают ручной browser script.

**Single-egress invariant (P0, инцидент 17.07.2026):** наличие `/health` 200 доказывает
только доступность listener и CDP, но не валидность donor session. Production показал, что
cookie, использованная для authenticated preflight на RF, затем приходит в SG Chrome как
неавторизованная и становится 401. Все authenticated user/currency/product-info/ownership
операции с donor-cookie должны выполняться внутри одного persistent Chrome на SG и
сериализоваться с purchase. Direct Node/Web fetch и fallback с RF запрещены. До переноса
всех call sites и новой canary TWA/Web/partner/auto buyout считаются fail-closed; deploy order
и acceptance описаны в [`roblox-plus-buyout-plan.md`](roblox-plus-buyout-plan.md).

Исправление задеплоено 17.07: SG service имеет Bearer-auth `POST /session`,
`POST /gamepass-preflight` и `POST /purchase` под одним no-backlog single-flight lock;
Web/TWA/TG получают только нормализованные session/preflight данные. Безопасный порядок
релиза выполнен: (1) обновлён SG service с резервной копией; (2) проверены
`/health`, `/session` и `/gamepass-preflight` с невалидной тестовой строкой из SG, Web и TG;
(3) обновлены Web и TG; (4) сохранить новую funded cookie; (5) cheap canary и 3/3 реальных
последовательных заказа; (6) только затем отдельно включить auto-buyout. Rollback — выключить
денежные действия и использовать ручной script-only режим, но не возвращать direct RF fetch.

**Health в TWA/боте:** `TG_BOT_HEALTH_URL`, `VK_BOT_HEALTH_URL` — **обязательны** для
health-виджета: с 2026-07-03 захардкоженных IP-фолбэков нет (репо публичный, см.
[security.md](security.md), риск #4). Без env сервис показывается как «нет данных»
(ok:false). Значения — в `HANDOFF.md`.

## Режим техработ (скрытие витрины)

`src/proxy.ts` (Next 16 Proxy, бывший middleware) гейтит **только витринные страницы**
Web-контейнера: `/`, `/faq`, `/reviews`, `/checkout`, `/dashboard`, `/login`, `/register`,
`/payment`, `/legal`, `/privacy`, `/guarantees`, `/admin`. Коридор `/guide` (отдельный
контейнер, из Guide-сборки proxy вырезается в `Dockerfile.guide`), `/twa`, все `/api/*` и
статика **не затрагиваются** — боты, коридор и TWA работают в любом режиме. Внутри `/guide`
режим `source=site` открыт и показывает общий Navbar; `source=wb` остаётся закрытым WB-гейтом.

> SEO-роуты `/robots.txt`, `/sitemap.xml`, `/opengraph-image` (добавлены 2026-07-08) —
> НЕ в matcher, доступны всегда (это безопасно: витрину крауллер всё равно получает как 503).
> `/privacy` с 2026-07-08 — 308-редирект на `/legal/policy` (единая политика; старая
> VK-only копия удалена), внешние ссылки на `/privacy` продолжают работать.

- **Включить:** на Web в Coolify выставить `MAINTENANCE_MODE=on` (значение ровно `on`; всё
  прочее = выключено) и `SITE_UNLOCK_SECRET=<секрет>`, затем **Restart** (env читается при
  создании контейнера). Выключить — `MAINTENANCE_MODE=off` (или удалить) + Restart.
- Посетители получают rewrite на `/maintenance` (route handler `src/app/api/../maintenance`,
  сам отдаёт HTTP 503 + `Retry-After`; кастомный статус у `rewrite()` в проде игнорируется).
- **Байпас владельца** (два способа):
  1. NextAuth-сессия с `role: ADMIN`;
  2. открыть любую страницу с `?unlock=<SITE_UNLOCK_SECRET>` → ставится подписанная
     HMAC-cookie `site_unlock` (30 дней), редирект на чистый URL — дальше браузер ходит
     свободно. Без env `SITE_UNLOCK_SECRET` этот способ выключен.

> ⚠️ **Healthcheck обязан бить в негейтируемый путь.** Docker healthcheck Web-контейнера
> ходит в `/api/health` (ungated), **не** в `/`. Если healthcheck бьёт в `/`, то при
> `MAINTENANCE_MODE=on` он получает 503 → Docker метит контейнер `unhealthy` → Traefik
> выкидывает **весь** Web из ротации (включая `/twa` и `/api`), сайт падает целиком. Это
> ровно то, что случилось при первом включении 2026-07-03; фикс — `/api/health` в `Dockerfile`.

> **Управление через Coolify API:** base URL, token и UUID Web хранятся только в локальном
> `HANDOFF.md`. Env меняется через application env endpoint, затем нужен Restart без
> пересборки (env читается при создании контейнера).
> Поле `is_build_time` API отклоняет — не передавать. После Restart проверить:
> `docker exec robloxbank-web printenv MAINTENANCE_MODE` и `docker inspect … Health.Status`.

## Сеть и доступность из РФ (2026-07-04)

- **DNS:** `robloxbank.ru` — **прямой A** на RF-хост (точный IP только в `HANDOFF.md`,
  grey-cloud; NS всё ещё
  Cloudflare). Раньше запись была proxied и трафик шёл через `cloudflared`-туннель — но
  Cloudflare деградирован у российских розничных провайдеров (ТСПУ), сайт «работал только с
  VPN». Прямой A это чинит. **Переключение на прямой A делал владелец сам** (подтверждено
  06.07.2026) — инцидента доступа к Cloudflare не было, вопрос закрыт. `panel.robloxbank.ru`
  остаётся proxied (CF). Контейнер `cloudflared-new` на RF осиротел для трафика сайта
  (последняя активность туннеля 03.07) — оставлен работать для panel; трогать не нужно.
  Цепочка сейчас: клиент → Traefik (`coolify-proxy`, Let's Encrypt) → контейнер Web/Guide.
  Разделение Web/Guide по путям (`/_next-guide` → Guide) — на Traefik,
  см. `next.config.guide.ts`.
  ⚠️ Обратная сторона — IP источника публичен (docs/security.md #7).
- **Внешние скрипты self-hosted** (`public/vendor/`): `telegram-web-app.js` и
  `vkid-sdk-<ver>.js` отдаются со своего домена, а не с telegram.org / unpkg.com (оба за
  Cloudflare → без VPN у RU-юзеров не грузились). SDK больше не грузятся на каждой витринной
  странице: Telegram подключён только в `src/app/twa/layout.tsx`, VK ID — в
  `VKAuthButton`. Это устраняет побочный effect/hydration mismatch обычной витрины. При
  апдейте Bot API / VK ID SDK обновлять файл в `public/vendor/` и версию в пути.
- Мониторить доступность из РФ можно через check-host.net API (ru-ноды) — датацентровые ноды
  ≠ розничные провайдеры с ТСПУ, для реальной картины просить клиентов проверить без VPN.

## Заметки

- `ADMIN_IDS` — кому слать карточки заказов/отзывов (TG user IDs).
- `TG_CHAT_ID` — для уведомлений из `src/auth.ts` (Next.js, не боты).
  В `bots/shared/admin.ts`: `ADMIN_IDS ?? TG_CHAT_ID`.
- Ротация TG-токена: обновить `TG_TOKEN` и на Web, и на TG-боте, **и на VK-боте**
  (VK шлёт TG-уведомления).

## Локально

```bash
npm install
npm run dev            # сайт
npm run bot:tg         # TG-бот
npm run bot:vk         # VK-бот
npm run dev:reset-test # сброс тестового кода
```
