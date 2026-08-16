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
> сборки Web, TG и VK: ручной `POST /api/v1/deploy?...&force=true` для любого из них
> создаёт **вторую параллельную сборку того же сервиса**, и на RF-хосте (2 vCPU / 4 GB)
> лишняя сборка может упасть на шаге
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

**29.07.2026 защита автоматизирована:** `deploy-web-and-guide.sh` по умолчанию больше не
делает POST для Web. Он находит webhook-запись точного `git rev-parse HEAD`, ждёт именно её
`finished`, затем запускает Guide. Если Web или Guide уже `queued`/`in_progress`, существующий
deployment переиспользуется, второй не создаётся даже в режиме `--force-web`. Если webhook
не появился за 120 секунд, скрипт падает без мутации; аварийный ручной Web deploy требует
явного `--force-web`.

Web-фичи, которые меняют Prisma-схему, требуют синхронного применения миграций на прод-БД.
Если образ обновился, а миграции не применились, TWA/API могут падать на новых колонках.
Для партнёрского режима `Антон` это диагностируется как `503 PARTNER_SCHEMA_NOT_READY`
от `/api/twa/partners/anton/tasks`.

Порядок для таких случаев: сначала read-only `npx prisma migrate status`, затем аудит SQL на
destructive changes/существующие таблицы, только после этого `npx prisma migrate deploy`.
После применения проверять `migrate status` и сам API. 2026-07-09 этот порядок использован для
трёх partner-миграций; прод-БД после этого показывает `Database schema is up to date`.

### WB DBS production shadow (12.08.2026)

Для `20260811_wb_dbs_delivery` порядок строгий: backup → `migrate status` → аудит additive
SQL → `migrate deploy` → Web/TG/VK. Один и тот же 32-byte `WB_DELIVERY_ENCRYPTION_KEY`
должен быть в Web и TG, но значение никогда не выводится. TG запускает только read-only
sync через `WB_DBS_SYNC_ENABLED=true`. Marketplace и Chat должны
получить отдельные scoped tokens до включения live mutations; legacy `WB_API_TOKEN` —
только временный fallback shadow-периода.

### WB DBS live-режим (16.08.2026)

Shadow закрыт: на первом реальном заказе `WB_CHAT_SEND_ENABLED=true` и
`WB_DBS_MUTATIONS_ENABLED=true` заведены **и на Web, и на TG** (Web обслуживает кнопки
админки и TWA, TG — worker и авто-гейт). Значения читаются в рантайме, поэтому после
правки env нужен redeploy сервиса, а не только рестарт контейнера.

| Флаг | Где | Что ломается при `false` |
|------|-----|--------------------------|
| `WB_CHAT_SEND_ENABLED` | Web + TG | Любая отправка в чат WB: запрос кода, гейт, свободное сообщение (409 `..._OFF`) |
| `WB_DBS_MUTATIONS_ENABLED` | Web + TG | `confirm` / `deliver` / `receive` (409 `..._OFF`) |
| `WB_DBS_AUTO_REPLY` | TG | Не задан ⇒ на первое сообщение покупателя никто не отвечает автоматически |
| `WB_DBS_AUTO_GATE` | TG | Не задан ⇒ ручной режим: код ловится сам, гейт выпускает оператор |

Оба флага не действуют на `isTest`-заказы — демо-сценарий работает в обход них, поэтому
зелёный демо-прогон **не доказывает**, что реальный заказ поедет. Проверять только на
реальной карточке или сверкой env.

После любого WB DBS release дождаться webhook-сборок Web/TG/VK, затем последовательно
пересобрать Guide и прогнать `smoke-site` + `node scripts/smoke-corridor.mjs`. Даже если
файлы гейта не менялись явно, общий release fingerprint Web/Guide обязан совпасть.
Дополнительные acceptance-гейты: anonymous `401` новых API, свежий `wb-dbs-sync`
heartbeat, `wb-dbs-statuses`/chat cursors без error и synthetic `isTest` flow без WB writes.

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

### ⚠️ `NEXT_PUBLIC_*` — build-time и обязаны совпадать на Web и Guide (28.07.2026)

Эти переменные запекаются в клиентский бандл на сборке. Из этого следует:

1. **Менять их — значит пересобирать.** Рестарт контейнера ничего не изменит: в статике
   останется старое значение.
2. **Задавать надо на обоих сервисах.** Guide — отдельное приложение со своей сборкой; если
   значение разошлось, гейт и сайт будут вести себя по-разному при одинаковом фингерпринте.
3. **Неверное значение не видно ни по health, ни по рестарту.** 28.07 в проде на обоих
   сервисах стоял чужой `NEXT_PUBLIC_VK_APP_ID` — вход через VK был сломан для всех, а
   смоук оставался зелёным, потому что проверял только наличие бандла VK ID.
   Разбор — [security.md](security.md) риск №34.

Теперь `smoke-corridor` сверяет `VK app id в сборке гейта` с ожидаемым
(`EXPECTED_VK_APP_ID`, по умолчанию `54539012`) — то есть проверяет значение, реально
уехавшее в прод, а не то, что записано в панели.

### Смоук ждёт готовности Guide (28.07.2026)

Coolify отвечает `finished`, когда собрал и запустил контейнер, но Guide ещё несколько
секунд отдаёт страницу без чанков `/_next-guide`. Смоук, запускавшийся сразу следом, падал
ложными «чанки не найдены» и «нет VK ID»: 28.07 первый прогон дал `11/2`, повторный через
полминуты — чистые `31/31`.

Ложный красный после деплоя опаснее отсутствия проверки: к нему привыкают и перестают
читать. Теперь `deploy-web-and-guide.sh` перед смоуком ждёт, пока гейт реально начнёт
отдавать свои ассеты (до 150 с, шаг 5 с, плюс 3 с на прогрев воркеров). По таймауту смоук
запускается всё равно — его вердикт и будет ответом, скрипт не пропускает проверку молча.

Проверено на следующем же выкате: `31/31` с первого прогона.

### Web-сборка падает по памяти на RF-хосте (31.07.2026)

RF-хост — 3.9 ГБ RAM + 4 ГБ swap, и `next build` в контейнере в него не всегда влезает.
31.07 деплой Web упал сразу после `Creating an optimized production build`: BuildKit не
написал ошибки, Coolify показал только `DeploymentException`. Причина видна лишь в
системном журнале хоста:

```bash
ssh root@<RF> 'journalctl --since "-25 min" | grep -i oom'
# dockerd: failed to read oom_kill event ... span="[builder 7/7] RUN npm run build"
```

Такое уже было 13.07 (тогда упали Web и VK_bot на дисково-тяжёлых шагах). **Лечение —
повторный запуск того же деплоя**: 31.07 второй заход собрался штатно, смоук `32/0`.
Диск ни при чём (67 ГБ свободно) — проверять надо именно память. Прод при этом не
страдает: старый контейнер продолжает обслуживать трафик, пока новая сборка не удалась.

Если ретраи начнут падать подряд — поднимать swap или ограничивать heap сборки, а не
гонять деплой по кругу.

### Автодеплой по push может не сработать молча (31.07.2026)

31.07 коммит уехал в `main` на GitHub, но Coolify не создал ни одной записи деплоя за
120 с — `deploy-web-and-guide.sh` корректно отказался форсить сам и вывел инструкцию.
Прежде чем запускать `--force-web`, обязательно убедиться, что деплоя действительно нет:

```bash
git ls-remote origin main                      # коммит долетел до GitHub
curl -sS -H "Authorization: Bearer $COOLIFY_TOKEN" "$COOLIFY_URL/api/v1/deployments"
# [] — активных/очередных деплоев нет, значит webhook не сработал
```

Репозиторий и ветка в Coolify при этом были настроены верно, то есть вопрос к доставке
webhook на стороне GitHub (Settings → Webhooks → Recent Deliveries). Причина не выяснена —
если повторится, смотреть журнал доставок.

**01.08.2026 повторилось дважды подряд** (коммиты `5c12c26` и `489d519`): `git ls-remote`
показывал коммит в `origin/main`, `GET /api/v1/deployments` возвращал `[]`, скрипт корректно
отказывался форсить сам. Оба раза выкат прошёл через `--force-web` после этой проверки,
сборки Web и Guide завершились с первого раза, смоук `32 / 0`. То есть это уже не разовый
сбой: пока webhook не починен, **штатный путь выката — сначала проверка `ls-remote` +
пустой список деплоев, потом `--force-web`**, а не ожидание автодеплоя.

### Russian Trusted Root CA в Docker-образе (06.08.2026)

T-Bank (`securepay.tinkoff.ru`) перешёл на сертификаты, подписанные **Russian Trusted Root CA**
(Минцифры РФ). Этот CA отсутствует в стандартном Debian CA bundle (`ca-certificates`),
поэтому Node.js `fetch` и системный `curl` внутри контейнера не могут установить TLS-соединение
с API платёжного шлюза.

Сертификаты (Root + Sub CA) лежат в `certs/russian-trusted-ca.pem` и устанавливаются в
runner-стадии `Dockerfile`:

```dockerfile
COPY certs/russian-trusted-ca.pem /usr/local/share/ca-certificates/russian-trusted-ca.crt
RUN update-ca-certificates
```

Дополнительно установлен `NODE_EXTRA_CA_CERTS` для Node.js `fetch` (undici). Если T-Bank
вернётся на глобальный CA — сертификат можно убрать, лишних side-effect от его присутствия нет.

Root CA действует до 2032-02-27, Sub CA — до 2029-07-19.

**09.08.2026:** тот же CA обязателен в `bots/tg/Dockerfile`. TG — единственный
`GetState/Cancel` reconciliation worker; без `NODE_EXTRA_CA_CERTS` он находил stale
платежи, но оставлял их fail-closed с `fetch failed`. COPY/update-ca обязаны находиться
именно в финальной `runner` stage; Docker-контракт проверяет этот участок, а не только
наличие имени сертификата в файле.

### Один скрипт вместо ручного шага (26.07.2026, ultra-review U5)

Ручной шаг «не забудь Guide» регулярно забывался: 25.07 прод обслуживал точку входа с
Wildberries сборкой на несколько коммитов старше сайта, и видно это было только по смоуку.
Теперь есть:

```bash
scripts/deploy-web-and-guide.sh              # ждём webhook Web → Guide → smoke
scripts/deploy-web-and-guide.sh --guide-only # Web уже уехал автодеплоем
scripts/deploy-web-and-guide.sh --force-web  # только если webhook проверенно не сработал
```

Скрипт читает `COOLIFY_URL`, `COOLIFY_TOKEN`, `COOLIFY_WEB_UUID`, `COOLIFY_GUIDE_UUID` из
окружения/локального `.env` (секретов в репозитории нет), по умолчанию присоединяется к
webhook-deploy Web текущего commit, соблюдает порядок Web → Guide и сам гоняет
`smoke-corridor` в конце. `--guide-only` нужен, если Web уже принят до запуска скрипта.

Для постоянного контроля — лёгкий режим смоука под cron раз в 15 минут:

```bash
node scripts/smoke-corridor.mjs --drift-only --alert
```

Он проверяет только страницу гейта и совпадение `X-RobloxBank-Guide-Release` у Web и Guide
(8 проверок вместо 30) и шлёт алерт админам в TG при расхождении.

### Обязательный release-чеклист

1. `npm run lint` — с 26.07 это работающий гейт: 0 error, а рост числа warning
   ограничен `--max-warnings` (текущий потолок зафиксирован в скрипте).
2. `npx tsc --noEmit`
3. `npm run bots:tsc` — **новое**: до 26.07 код ботов вообще не проверялся типами.
4. `npm test` и `npm run test:bots`
5. `npm run build`
6. Миграции: аддитивные — **до** деплоя, разрушительные (`DROP TABLE`) — **после**.
7. Деплой Web → Guide (скрипт выше), затем `node scripts/smoke-corridor.mjs` → ожидаем 30/30.

Одной командой шаги 1–5: `npm run gates`.

Read-only smoke основной витрины:

```bash
npm run smoke:site                                      # production: 200 или штатный 503 root
npm run smoke:site -- --base=http://127.0.0.1:3000 --expect-public
npm run smoke:site -- --expect-maintenance
```

### Release email lifecycle (18.07.2026)

Migration `20260718_email_account_lifecycle` аддитивная, но новый Web обращается к новым
колонкам/таблицам. Порядок не менять:

1. fresh backup и checksum;
2. `npx prisma migrate status` и ручная сверка SQL;
3. `npx prisma migrate deploy`;
4. только затем push/deploy Web;
5. smoke `/login`, `/register`, `/forgot-password`, `/email/verified?status=invalid`, ЛК;
6. без SMTP проверить fail-closed copy; после SMTP — живые verify/reset и отзыв старой сессии.

Переменные SMTP и DNS acceptance описаны в `docs/email-setup.md`. Отсутствие SMTP не должно
ронять Web, но означает, что email recovery нельзя объявлять запущенным. Первый релиз
намеренно завершит legacy JWT без `sessionVersion`: это одноразовый безопасный logout для
старых web-сессий.

Он не пишет в БД: проверяет health и security headers, 404, robots/sitemap, SITE guide,
OpenGraph и корректный maintenance-ответ.

> ⚠️ **Dockerfile'ы ботов копируют исходники поимённо** (`COPY bots/tg/crons.ts …`), а не
> папкой. Новый `.ts`-файл в `bots/tg/` или `bots/vk/` **обязан быть добавлен в COPY-список**
> соответствующего Dockerfile — иначе образ соберётся зелёным (tsx резолвит импорты только в
> рантайме), а контейнер уйдёт в crash-loop с `MODULE_NOT_FOUND` на старте. Именно так TG-бот
> упал в проде 2026-07-04 (`auto-workers.ts` не попал в образ). `bots/shared/` копируется
> целиком — общий код туда добавлять безопасно.

Оба bot-образа копируют собственные `package-lock.json` и устанавливают зависимости через
`npm ci`; обновление bot `package.json` без соответствующего lockfile должно ломать сборку,
а не тихо собирать другой transitive graph.

## Env-переменные (имена, без значений)

Добавлены 26.07.2026 (ultra-review):

| Переменная | Где | Зачем |
|---|---|---|
| `TWA_LINK_SECRET` | Web + TG-бот (значения обязаны совпадать) | подпись токена запуска TWA в web_app-ссылке; без неё запасной вход отключён и админка открывается только там, где Telegram отдаёт `initData` (U1) |
| `TRUSTED_PROXY_MODE` | Web | `direct` (по умолчанию и в проде) или `cloudflare` — как определять IP клиента для лимитов (U2) |
| `CLOUDFLARE_IP_RANGES` | Web, опционально | переопределение списка CIDR Cloudflare для режима `cloudflare` |

Удалены как мёртвые: `BOT_API_TOKEN`, `INTERNAL_WEBHOOK_SECRET`, `LOCAL_BOT_URL` —
обслуживавшие их роуты удалены вместе с legacy-слоем магазина (U13); в рабочем окружении
их и не было, поэтому роуты всегда отвечали 401.


**Web:** `DATABASE_URL`, `AUTH_SECRET` (или `NEXTAUTH_SECRET`), `NEXTAUTH_URL`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_VK_APP_ID`, `TG_TOKEN`, `TG_CHAT_ID`, `ADMIN_IDS`,
`ADMIN_BREAKGLASS_EMAILS` (опц., запасной вход владельца — см. ниже),
`ADMIN_SECRET`, `WB_API_TOKEN`, `MAINTENANCE_MODE` (опц., см. ниже), `SITE_UNLOCK_SECRET`
(опц., байпас техработ), `NEXT_PUBLIC_VK_AUTH_ENABLED` (опц.; fail-closed, VK ID виден
только при точном `true` после живого acceptance); B2B «Антон»:
`ANTON_GOOGLE_SHEETS_SPREADSHEET_ID`,
`GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEETS_PROTECTED_EDITORS` (email владельца
таблицы для защиты выполненных строк, Этап 5.8). SITE-эквайринг (по умолчанию выключен):
`SITE_ACQUIRING_ENABLED`, `SITE_ACQUIRING_MODE`, `SITE_ACQUIRING_ALLOWLIST_USER_IDS`,
`SITE_ACQUIRING_ROLLOUT_PERCENT`, `TINKOFF_TERMINAL_KEY`, `TINKOFF_SECRET_KEY`, `TINKOFF_TAXATION`,
`TINKOFF_ITEM_TAX`, `TINKOFF_PAYMENT_METHOD`, `TINKOFF_PAYMENT_OBJECT`; временная диагностика
поддержки — `TBANK_DIAGNOSTIC_JSON_LOGS` (включается только exact `true` на один controlled
E2E и сразу выключается). Классификаторы чека не имеют default: их значения подтверждают
бухгалтер/ККТ-оператор. Legacy automation:
`LOCAL_BOT_URL`, `INTERNAL_WEBHOOK_SECRET`, `BOT_API_TOKEN`.

Checkout читает per-session runtime-состояние эквайринга из `GET /api/acquiring/status`.
Master flag разрешает только exact `true`; mode принимает только `off`, `allowlist`,
`percentage`, `on` и fail-closed в `off`. При любом ответе кроме `{ enabled: true }` UI не
активирует платёжный CTA; серверный `POST /api/orders/create` независимо повторяет auth и
eligibility. Allowlist — comma-separated internal `User.id`; percentage — целое `0..100`.
Сначала задаётся mode/allowlist при master `false`, затем один последовательный deploy;
master включается отдельным изменением только перед allowlist E2E.

При `TBANK_DIAGNOSTIC_JSON_LOGS=true` канонический `Init` пишет в stderr одну JSON-строку;
email, provider Token, PaymentURL и bearer query `token` в ней маскируются. Флаг всё равно
разрешён только на controlled E2E. Запись `event=tbank.init.exchange` сохраняет URL, headers,
структуру request и HTTP response без чувствительных значений. После controlled E2E
переменную удалить/переключить в `false` и перезапустить Web.

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
Для payment reconciliation worker обязательны те же `TINKOFF_TERMINAL_KEY` и
`TINKOFF_SECRET_KEY`, что у Web; без них sweep fail-closed и не меняет заказ/льготы.

**VK-бот:** `DATABASE_URL`, `VK_TOKEN`, `VK_GROUP_ID`, `ADMIN_IDS`, `VALIDATOR_SOURCE_URL`,
`VALIDATOR_KEY`, `TG_TOKEN` (уведомления менеджерам идут через Telegram).

`ADMIN_IDS` должен быть одинаково задан в Web и TG-контейнере: Web рассылает всем
администраторам подтверждения ручных TWA-выкупов, TG — ручных покупок и auto-worker.
Значение — список Telegram ID через запятую; cookie и токены в эти уведомления не входят.

TG-сервис также является единственным payment outbox/reconciliation worker. После deploy в логах обязательна
строка `[PaymentOutbox] Worker started`; `DATABASE_URL`, `TG_TOKEN` и `ADMIN_IDS` нужны ему для
claim/delivery/dead-letter alerts, а T‑Bank credentials — для `GetState`/`Cancel`. Не запускай второй polling TG instance без отдельной проверки
atomic claim и Telegram polling topology.

Миграция `20260728_wave2_launch_readiness` применена к production 28.07 после проверенного
custom-format backup. С неё TG-worker пишет `ServiceHeartbeat` до и после
каждого outbox batch. Основной **независимый** watchdog запускается в VK-контейнере
(`VK_WORKER_WATCHDOG_ENABLED=true`). Сначала он отправляет тревогу через SG Telegram bridge;
если Telegram не подтвердил доставку, вызывает защищённый `POST /api/internal/worker-alert`
на Web. Web отправляет email только подтверждённым владельцам, чья TG-identity входит в
`ADMIN_IDS`; endpoint сверяет `VALIDATOR_KEY` constant-time, адреса и ключ не логирует.
Web-вариант через `src/instrumentation.ts` остаётся fallback, но в RF production должен быть
`WORKER_WATCHDOG_ENABLED=false`: controlled drill показал `fetch failed` до Telegram при
корректном stale detection. `/api/health/workers` возвращает 200 только при heartbeat моложе
5 минут и отсутствии `PENDING` старше 10 минут. Его не подставлять вместо `/api/health` в
Docker liveness. Web и VK должны иметь одинаковый `VALIDATOR_KEY`; VK и TG — одинаковые
`TG_TOKEN`, `ADMIN_IDS`, `VALIDATOR_SOURCE_URL`, `VALIDATOR_KEY`. Для email fallback в Web
должен быть настроен SMTP, а хотя бы у одного администратора — подтверждённый email.
Production acceptance 28.07: controlled stop заморозил heartbeat, после пяти минут VK
перевёл его в `STALE`, Web/SMTP подтвердил доставку и сохранил ненулевой `lastAlertAt`;
владелец подтвердил письмо скриншотом. После запуска TG heartbeat стал fresh, watchdog —
`HEALTHY`, recovery доставлен, просроченный backlog остался 0.

Hybrid checkout ботов требует отдельный `BOT_PAYMENT_API_SECRET` не короче 32 символов,
одинаковый на Web, TG и VK. TG/VK вызывают `WEB_BASE_URL/api/internal/bot-payments`; Web
единственный хранит `MANUAL_TRANSFER_BANK/RECIPIENT/PHONE/CONFIG_VERSION`. Значения
реквизитов запрещено выводить через Coolify API в лог/отчёт. После изменения secret нужно
перезапустить все три сервиса: несовпадение fail-closed даёт 401 и не потребляет intent.
Production smoke проверяет 401 без подписи и отсутствие реквизитов в публичных ответах;
живой create допускается только как неоплаченная сессия владельца и не включает списание.

Конфигурация ставится без копирования значений в терминальный вывод:

```bash
npm run rollout:bot-payments
```

Скрипт требует Coolify API URL/token и UUID Web/TG/VK, а также четыре
`MANUAL_TRANSFER_*` значения в окружении оператора. Он повторно использует уже установленный
Web secret либо генерирует новый, атомарными bulk-upsert синхронизирует Web/TG/VK, копирует
T‑Bank credentials только из Web в TG для reconciliation-worker и затем сравнивает значения
read-after-write. В stdout попадают только названия ключей и короткий fingerprint secret.
Явный `BOT_PAYMENT_API_SECRET` в окружении означает осознанную ротацию: все три сервиса нужно
после неё передеплоить вместе.

Поэтапное включение выполняется отдельными командами и с окном наблюдения между ними:

```bash
npm run rollout:site -- allowlist
npm run rollout:site -- 10 --confirm-real-money
npm run rollout:site -- 50 --confirm-real-money
npm run rollout:site -- on --confirm-real-money
```

Скрипт требует `COOLIFY_API_URL`, `COOLIFY_TOKEN`, `COOLIFY_WEB_APP_UUID`; проверяет
допустимый предыдущий этап, Web health, worker readiness и факт ротации T-Bank secret после
известного cutoff, обновляет env, инициирует deploy и сверяет публичный status. `off`
разрешён из любого состояния как аварийный rollback. Значения инфраструктуры хранятся
только в `HANDOFF.md`/env.
Три rollout-переменные обновляются одним `PATCH .../envs/bulk`: это upsert, совместимый с
production Coolify 4.0 beta, и он не создаёт дубли ключей при повторном запуске этапа.
После deploy скрипт ждёт `finished` именно у возвращённого `deployment_uuid`, а не принимает
старый ещё работающий healthy-контейнер за завершение новой сборки. Только потом проверяются
`running:healthy`, публичный acquiring status и worker readiness.
Если новый deployment завершается `failed/cancelled`, оркестратор до выхода автоматически
возвращает предыдущие master/mode/percentage в Coolify. Неудачный этап поэтому не может
«включиться позже» от случайного следующего redeploy.
После `finished` публичные status/readiness получают до 60 секунд на переключение proxy.
Если приёмка всё равно не проходит, env возвращаются и выполняется отслеживаемый
restart-only, поэтому откатывается не только конфигурация Coolify, но и runtime-контейнер.

Исключение `--accept-existing-secret-risk` разрешено только после явного решения владельца,
которому сообщён риск отсутствия ротации. Оно не изображает старый Password новым: скрипт
печатает `SECURITY EXCEPTION`, а факт принятия риска фиксируется в закрытом handoff. Обычный
запуск без флага по-прежнему fail-closed.

**Bridge:** `VALIDATOR_KEY`, `VALIDATOR_PORT`.
Launch publisher использует `VALIDATOR_SOURCE_URL` + `VALIDATOR_KEY` для Telegram, если они
заданы: прямой `api.telegram.org` из RF/operator transport может быть недоступен. Публикация
считается успешной только после `ok` bridge и ответа VK API.

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

- `ADMIN_IDS` — **единственный список админов** (TG user IDs). С этапа A1 (28.07.2026) из
  него выводится и доступ в веб-админку `/admin`, а не только рассылка карточек и вход в TWA.
  Роль вычисляется на каждом запросе, поэтому снятие ID действует сразу после рестарта Web —
  правки в БД не нужны и не помогут.
- `ADMIN_BREAKGLASS_EMAILS` — запасной вход владельца, если Telegram недоступен: адреса через
  запятую. Работает **только вместе** с `role = "ADMIN"` у той же записи в БД; нужны оба
  условия. ⚠️ Если переменная не задана, а у админа нет проверенной TG-личности из
  `ADMIN_IDS`, он в `/admin` не попадёт — задавать **до** деплоя A1.
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
