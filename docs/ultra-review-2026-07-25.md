# Ultra-review 25.07.2026 — находки и план реализации фиксов

Сплошное ревью кодовой базы (355 файлов, ~67 500 строк: `src/`, `bots/`, `scripts/`,
`prisma/`) на баги, уязвимости, тупики и мёртвый код. Документ — **рабочий план**: каждая
находка имеет план фикса, критерий приёмки и карточку Trello.

> Проверки на момент ревью: `tsc --noEmit` ✅ · `jest` 260/260 ✅ ·
> `eslint` ❌ 1121 error / 346 warning · `smoke-corridor` ❌ 29/30 · `smoke:site` ✅

## Статус реализации на 26.07.2026

**Все 18 находок закрыты кодом и задеплоены.** Состояние гейтов после работы:
`tsc --noEmit` ✅ · `npm run bots:tsc` ✅ (новый гейт, 0 ошибок) · `jest` 311/311 ✅ ·
`jest --config jest.bots.config.js` 14/14 ✅ (новый) · `eslint` ✅ 0 error / 1140 warning
под потолком `--max-warnings` · `npm run build` ✅ · `smoke-corridor` ✅ 30/30.

Что осталось за владельцем (не код):

- **U3** — историческая сверка: 41 пользователь с расхождением журнала и баланса на
  ±100 R$ (суммарно 4100 R$). Это следы старого дефекта; отчёт даёт
  `node scripts/bonus-ledger-audit.mjs`. Компенсировать ли клиентам — решение владельца.
- **U7** — контракт-тест 3/3 зелёный, но боевой прогон на терминале Т‑Банка (два чека
  возврата 400 + 600 в ЛК и ОФД) ещё не делался.
- **U10** — включён только этап 1 (`Report-Only`). Enforce строгой CSP — после чистого
  отчёта на iPhone / Android / Telegram WebView / VK WebView.
- **U1** — вход в TWA проверен API-запросами; живой запуск мини-приложения с iPhone и
  MacBook за владельцем.

## Сводка

| ID | Находка | Приоритет | Зона | Trello | Статус |
|----|---------|-----------|------|--------|--------|
| U1 | Админ-токен TWA выдаётся по неподтверждённому Telegram ID | P0 | TWA/API | [JgBJhRVL](https://trello.com/c/JgBJhRVL) | ✅ закрыто 26.07 |
| U2 | Rate-limit обходится подделкой `cf-connecting-ip` | P0 | Инфра/API | [72H4yVEY](https://trello.com/c/72H4yVEY) | ✅ закрыто 26.07 |
| U3 | Бонус и скидка сгорают при неудачной оплате (web) | P1 | Сайт/БД | [laGKAWYG](https://trello.com/c/laGKAWYG) | ✅ закрыто 26.07 |
| U4 | Возврат бонуса в боте недостижим (DIR-заказы) | P1 | Боты | [laGKAWYG](https://trello.com/c/laGKAWYG) | ✅ закрыто 26.07 |
| U5 | Guide-контейнер отстаёт от Web в проде **сейчас** | P1 | WB-гейт | [668VINZj](https://trello.com/c/668VINZj) | ✅ закрыто 26.07 |
| U6 | IDOR в callback-кнопках ботов (`gpw_ok`/`gpw_no`/`uci`) | P1 | Боты | [3npacxfV](https://trello.com/c/3npacxfV) | ✅ закрыто 26.07 |
| U7 | Возврат остатка после частичного формирует неверный чек | P2 | Платежи/ККТ | [nWmm8zZJ](https://trello.com/c/nWmm8zZJ) | ✅ код 26.07, боевой ККТ-прогон ⏳ |
| U8 | VK-логин с занятым кодом «успешен» молча | P2 | Коридор | [Fy799eJ1](https://trello.com/c/Fy799eJ1) | ✅ закрыто 26.07 |
| U9 | IP согласия с офертой подделывается, две разные функции | P2 | Сайт/юр | [Fy799eJ1](https://trello.com/c/Fy799eJ1) | ✅ закрыто 26.07 |
| U10 | CSP допускает `unsafe-inline` + `unsafe-eval` | P2 | Сайт | [Fy799eJ1](https://trello.com/c/Fy799eJ1) | 🟡 этап 1 (Report-Only) 26.07 |
| U11 | `?date=` роняет `buyer-funnel` в 500 | P2 | TWA | [7hfT2VHR](https://trello.com/c/7hfT2VHR) | ✅ закрыто 26.07 |
| U12 | Нет ретенции: `PriceQuote`, `EmailActionToken`, `OrderEvent` | P2 | БД | [72H4yVEY](https://trello.com/c/72H4yVEY) | ✅ закрыто 26.07 |
| U13 | Legacy-слой `Order`/`Product` жив и открыт наружу | P2 | Сайт | [HJrJ00T2](https://trello.com/c/HJrJ00T2) | ✅ закрыто 26.07 |
| U14 | ~1180 строк мёртвого UI | P2 | Сайт/TWA | [HJrJ00T2](https://trello.com/c/HJrJ00T2) | ✅ закрыто 26.07 |
| U15 | Smoke охраняет неиспользуемый `vkid-sdk-2.6.5.js` | P2 | WB-гейт | [HJrJ00T2](https://trello.com/c/HJrJ00T2) | ✅ закрыто 26.07 |
| U16 | `eslint` непригоден как гейт (1121 ошибка) | P1 | Качество | [cONnonVd](https://trello.com/c/cONnonVd) | ✅ закрыто 26.07 |
| U17 | `bots/` вне `tsconfig` — 9000+ строк без проверки типов | P1 | Качество | [cONnonVd](https://trello.com/c/cONnonVd) | ✅ закрыто 26.07 |
| U18 | Полное сканирование `WbOrder` по `gamepassUrl contains` | P2 | БД | [7hfT2VHR](https://trello.com/c/7hfT2VHR) | ✅ закрыто 26.07 |

Уже принятые ранее риски, подтверждённые ревью (не новые): `sellerMatchesOrder` fail-open и
его отсутствие в `roblox-account/purchase` (риск №18), угон резерва кода ВБ по дизайну
(связан с риском №15).

Что проверено и **держит удар**: платёжное ядро (webhook, outbox, идемпотентность refund,
`Serializable`-транзакции, consume котировки), donor-cookie никогда не покидает SG
browser-service, admin-роуты закрыты ролью `ADMIN`, секреты в git не утекали.

---

## U1 — Админ-токен TWA выдаётся по неподтверждённому Telegram ID

**P0. Развивает риск №1 в `security.md`.**

`src/app/api/twa/auth/route.ts:25-31` — Path 2: если в теле нет `initData`, роут берёт
`userId` из тела как есть и, если он в `ADMIN_IDS`, подписывает полноценный 12-часовой JWT.
Telegram ID не секретны. За токеном — `payments/refund`, `roblox-account/purchase`, `drain`,
`purchase-batch`, `settings`, `partners/anton/tasks`: реальные деньги и робуксы.

Усугубляет: на роуте нет rate-limit; `extractTwaUser` (`src/lib/twa-auth.ts:75-80`) проверяет
только `role` в JWT и **не перепроверяет `isAdmin`**, поэтому удаление из `ADMIN_IDS` не
отзывает выданный токен до конца 12 часов.

### План

1. Снять решение по инструментированию: собрать `[twa-auth] hasInitData=` из логов Web за
   последние 30 дней. Если `hasInitData=true` во всех записях — переходим к шагу 2 без
   компромиссов.
2. Удалить Path 2 (строки 25–31) целиком. Роут отвечает 400 «No initData».
3. В `extractTwaUser` добавить `isAdmin(payload.sub)` после `verifyTwaToken` — членство
   проверяется на каждом запросе, а не только при выдаче.
4. Добавить в JWT claim `adminSetVersion` (hash от отсортированного `ADMIN_IDS`) и сверять
   его в `verifyTwaToken`: смена состава админов инвалидирует все старые токены немедленно.
5. Навесить на `POST /api/twa/auth` bucket `rateLimit(twa-auth:<ip>, 5, 1/60)` — после U2
   ключ станет честным.
6. Если какое-то целевое устройство реально не отдаёт `initData` — вместо Path 2 ввести
   `TWA_FALLBACK_SECRET`: клиент шлёт `HMAC(userId, secret)`, секрет живёт только в env
   TWA-бандла. Публичный `userId` не принимается ни при каких условиях.
7. Сократить TTL токена с 12 ч до 2 ч + тихое продление при активности.

### Приёмка

- `curl -X POST /api/twa/auth -d '{"userId":<любой admin id>}'` → **401/400**, токена нет.
- Открытие TWA на iPhone 14/15 Pro Max и MacBook 16" — вход работает.
- Удаление своего ID из `ADMIN_IDS` + redeploy → следующий же запрос старым токеном 401.
- Unit-тест: `verifyTwaToken` отклоняет валидно подписанный токен с чужим `sub`.

---

## U2 — Rate-limit обходится подделкой `cf-connecting-ip`

**P0. Развивает риск №2 в `security.md`.**

`src/lib/rate-limit.ts:79-90` безусловно доверяет `cf-connecting-ip`, затем
`true-client-ip`, затем `x-forwarded-for`. Комментарий описывает Cloudflare-туннель, но
после ухода на прямой A-record (риск №7) **трафик не проходит через Cloudflare**. Проверка
25.07: `dig robloxbank.ru A` возвращает адрес RF-хоста вне диапазонов Cloudflare (значение —
в `HANDOFF.md`), а `curl -I` по проду не содержит ни `cf-ray`, ни `server: cloudflare`.

Значит заголовок теперь полностью клиентский. Достаточно менять его в каждом запросе — и
исчезают все лимиты: `wb-code` (перебор/разведка кодов), `pricing/quote`, `orders/create`,
IP-ведро подбора пароля, `observability/client`, опрос статуса заказа.

Прямое следствие: неаутентифицированный `POST /api/pricing/quote` делает
`prisma.priceQuote.create` (`src/lib/price-quote.ts:91`) без ограничений → неограниченный
рост продовой БД (см. U12).

### План

1. Ввести env-флаг `TRUSTED_PROXY_MODE` = `direct` | `cloudflare`. Значение по умолчанию —
   `direct`.
2. Переписать `clientIp()`:
   - `direct`: берём **последний** (ближайший) hop из `x-forwarded-for`, добавленный
     Traefik, и игнорируем `cf-connecting-ip`/`true-client-ip` полностью;
   - `cloudflare`: текущее поведение, но только если исходный peer входит в список
     CF-диапазонов.
3. Добавить `src/lib/__tests__/rate-limit.test.ts`: подделанный `cf-connecting-ip` в режиме
   `direct` **не** влияет на ключ ведра.
4. Подтвердить на проде реальный client-IP через существующий лог `[wb-code] … ip=`.
5. Дополнительно (не блокирует): включить Cloudflare-прокси обратно (orange cloud) и WAF
   rate-limiting rules перед источником — это же закрывает риск №7 (публичный IP RF-хоста).
6. При выходе на >1 реплику Web — заменить in-memory Map на общий стор.

### Приёмка

- Скрипт: 30 запросов к `/api/wb-code` с разными `cf-connecting-ip` → 429 наступает по
  реальному IP, а не на 30-м.
- Лог `[wb-code] ip=` в проде показывает реальные клиентские адреса, а не адрес хоста.
- Unit-тесты зелёные.

---

## U3 + U4 — Бонус и скидка сгорают без компенсации

**P1. Деньги клиента.**

**Web (U3).** `src/lib/canonical-web-order.ts:143-180` внутри транзакции создания заказа
списывает `balance` и **обнуляет** `rubleDiscount`. Компенсации нет ни на одном из трёх
исходов: провал `Init` (`api/orders/create/route.ts:153-171`), `REJECTED`/`CANCELED` от банка
(`api/webhooks/tinkoff/route.ts:105-107`), брошенная оплата. `BonusLedger` пишется ровно в
двух местах и только с отрицательной дельтой; `balance: { increment }` во всём проекте
встречается один раз — бонус за отзыв (`bots/tg/handlers.ts:5059`).

**Боты (U4).** `bots/tg/handlers.ts:4476-4506` (`ucd:` — отмена прямого заказа покупателем)
пытается вернуть бонус, но считает его из строки `WbCode`, которой у DIR-заказов **никогда
не существует** (подтверждено комментарием `handlers.ts:2450`). `bonusApplied` всегда `0`,
ветка возврата недостижима. Скидка не возвращается по признанию комментария. Плюс
`updateData.balance = user.balance + x` — read-modify-write вместо `{ increment }`
(lost update при гонке), и запись в `BonusLedger` не делается.

### План

1. Ввести единую функцию `src/lib/bonus-ledger.ts`:
   `applyBonusDelta({ userId, deltaRobux, reason, referenceId, idempotencyKey }, tx)` —
   единственная точка изменения `balance`; всегда `{ increment }`, всегда запись в
   `BonusLedger`, всегда идемпотентный ключ.
2. Перевести на неё `canonical-web-order.ts` (списание), `ucd:` и все места в ботах.
3. Добавить компенсацию `WEB_ORDER_REDEMPTION_REVERSED` с ключом
   `web-order-bonus-revert:<quoteId>`:
   - в catch-ветке `orders/create` после `PAYMENT_INIT_FAILED`;
   - в webhook при переходе в `REJECTED`/`CANCELED`;
   - в новом cron: заказы `AWAITING_PAYMENT`/`PAYMENT_PENDING` старше 2 ч → `REJECTED` +
     возврат бонуса.
4. Возвращать `rubleDiscount`: сохранять фактически применённое значение в `WbOrder`
   (`discountAppliedKopecks`) вместо обнуления «в никуда», восстанавливать из него.
5. Починить `ucd:`: считать бонус как `order.amount − packValue` (из `directPrice`), а не из
   несуществующей строки `WbCode`; вернуть и бонус, и скидку через функцию из п.1.
6. Разовая сверка: SQL-отчёт «сумма `BonusLedger` по юзеру ≠ `User.balance`» → ручная
   компенсация пострадавшим за период с 12.07.

### Приёмка

- Unit: провал `Init` → `balance` и `rubleDiscount` вернулись, в `BonusLedger` две записи
  (−N и +N) с разными идемпотентными ключами.
- Unit: повторный вызов компенсации не создаёт вторую запись.
- Ручной прогон в боте: заказ с бонусом → «Отменить» → баланс восстановлен, в леджере видно.
- Сверка `SUM(deltaRobux) == balance` для всех пользователей.

---

## U5 — Guide-контейнер отстаёт от Web в проде

**P1. Карточка `668VINZj` уже открыта — здесь фактические данные на 25.07.**

```
https://robloxbank.ru/       → x-robloxbank-guide-release: b63be462d32e47d0
https://robloxbank.ru/guide  → x-robloxbank-guide-release: 4e4c3492f73709e6
локальный HEAD               → b63be462d32e47d0
node scripts/smoke-corridor.mjs → 29 ✅ / 1 ❌
```

Точка входа с Wildberries — основной канал привлечения — обслуживается более старым кодом,
чем сайт. Механизм детекта drift'а (`next-security.ts:60-69`) работает; не работает процесс
деплоя: auto-deploy Coolify покрывает Web и ботов, но **не Guide** — его нужно запускать
вручную, и об этом забывают.

### План

1. Немедленно: ручной redeploy Guide, затем `node scripts/smoke-corridor.mjs` → ожидаем 30/30.
2. Убрать ручной шаг: добавить Guide в тот же post-push webhook Coolify, что и Web, или
   завести один deploy-скрипт `scripts/deploy-web-and-guide.sh`, который дёргает оба UUID
   последовательно и сам гоняет smoke.
3. Сделать drift видимым без ручного запуска: cron-проверка раз в 15 минут сравнивает два
   заголовка и шлёт алерт в TG при расхождении (естественно ложится в карточку `jYOEHLjT`
   «Автоматически замечать поломку входа и активации»).
4. Внести в release-чеклист `docs/deploy.md` явный пункт: «Guide деплоится **после** Web,
   smoke-corridor обязателен, 30/30».

### Приёмка

- `smoke-corridor` 30/30 сразу после деплоя.
- Тестовый push с изменением в `src/app/guide/**` → оба контейнера обновились без ручных
  действий, фингерпринты совпали.
- Искусственный drift (задержать Guide) → алерт в TG в течение 15 минут.

---

## U6 — IDOR в callback-кнопках ботов

**P1.**

`bots/shared/gp-watch-confirm.ts:26,71` принимает `orderId` и **не проверяет владельца**.
Вызывается из `bots/tg/handlers.ts:3397,3420` (`gpw_ok:` / `gpw_no:`) и
`bots/vk/handlers.ts:818,834`. Через неофициальный MTProto-клиент
(`messages.getBotCallbackAnswer`) или VK-payload можно отправить произвольные `callback_data`.
Результат: чужой заказ переводится в `PENDING`, а *предположительный* ник записывается как
подтверждённый (`robloxUsername: order.probableNick`, комментарий «now confirmed by the
customer → authoritative») и уходит в очередь на реальный выкуп робуксов.

То же в `handlers.ts:4426-4444` (`uci:`) — отменяет любой `DirectIntent` по ID.

Показательно, что соседние ветки сделаны правильно: `user_resubmit:` (`4988-4994`) и `ucd:`
(`4474`) владельца проверяют. Это пропуск, а не решение. Эксплуатация требует знания CUID
(25 символов, не подбирается) — поэтому P1, а не P0.

### План

1. Изменить сигнатуры: `confirmGpWatch(orderId, actor)` / `declineGpWatch(orderId, actor)`,
   где `actor = { platform: "TG" | "VK", externalId: string }`.
2. Внутри — резолв `User` по `tgId`/`vkId` и жёсткая проверка `order.userId === user.id`;
   при несовпадении возвращать новый статус `"forbidden"` и логировать
   `[gp-watch] ownership violation` (это уже сигнал атаки).
3. Аналогично для `uci:` — сверять `intent.userId` с вызывающим.
4. Провести аудит **всех** 55 веток `bot.on("callback_query")`: любая, принимающая ID
   сущности, обязана проверять владельца. Вынести хелпер
   `assertOwnsOrder(ctx, orderId): Promise<Order | null>` и использовать везде.
5. Добавить в `bots/` тест-файл на хелпер (после U17, когда у ботов появится tsc/jest).

### Приёмка

- Ручной прогон: `gpw_ok:<чужой orderId>` → ответ «нет доступа», статус заказа не изменился,
  в логах запись о нарушении.
- Grep-ревью: ни одна ветка callback не читает сущность по ID без проверки владельца.

---

## U7 — Возврат остатка после частичного формирует неверный чек

**P2, но блокирует боевой ККТ-прогон. Относится к `nWmm8zZJ` и `DLxItXTq`.**

`src/app/api/twa/payments/refund/route.ts:73-78` передаёт `totalAmountKopecks: remaining`
(остаток), а `src/lib/tinkoff.ts:179` решает `partial = amountKopecks < totalAmountKopecks`.

Сценарий: платёж 1000 ₽ → возврат 400 ₽ (частичный, чек на 400 ✅) → возврат остатка 600 ₽,
где `600 === 600` → `partial = false` → `Receipt` **не передаётся** → банк формирует
закрывающий чек на **всю** исходную сумму 1000 ₽. Итого фискально возвращено 1400 ₽ при
фактических 1000 ₽.

При этом `payments-and-kkt.md:135` заявляет «частичный и затем остаток → 2 корректных чека —
contract/state ✅». Матрица даёт ложную уверенность перед проверкой Т‑Банка/ОФД.

### План

1. Передавать в `cancelCanonicalTinkoffPayment` **полную** сумму платежа
   (`attempt.amountKopecks`), а не остаток.
2. Признак полного возврата считать как
   `attempt.refundedAmountKopecks + amountKopecks === attempt.amountKopecks && attempt.refundedAmountKopecks === 0`
   — то есть «без чека» только когда это первый и сразу полный возврат.
3. Во всех остальных случаях передавать `Receipt` ровно на возвращаемую часть.
4. Добавить contract-тест на три сценария: полный сразу; частичный; остаток после
   частичного. Третий обязан содержать `Receipt` на 600.
5. Исправить формулировку в `payments-and-kkt.md:113` и снять ✅ со строки 135 матрицы до
   реального прогона на терминале.

### Приёмка

- Contract-тест 3/3.
- Прогон на тестовом терминале: в ЛК банка и ОФД два чека возврата на 400 и 600, сумма
  фискальных возвратов = 1000.

---

## U8, U9, U10 — сайт и коридор (к карточке `Fy799eJ1`)

### U8. VK-логин с занятым кодом «успешен» молча
`src/auth.ts:191-231`. `wbCode.update({ where: { code, status: { not: "CLAIMED" } } })`
бросает P2025, если код уже занят; исключение ловится и логируется (`:201`), но выполнение
продолжается: `provisionalOrder` берётся существующий (чужой), а в сессию всё равно
кладётся `wb_code` (`:296`). Пользователь уходит в коридор с ощущением успешной активации,
хотя заказ принадлежит другому аккаунту.

**План:** различать «код привязан к нам» и «код занят другим». При P2025 и
`wbCodeRecord.userId !== user.id` — не класть `wb_code` в сессию, показать экран «код уже
активирован в другом аккаунте» с кнопкой в поддержку, отправить админам сигнал (это же
индикатор ПВЗ-фрода, риск №15). Покрыть unit-тестом.

### U9. IP согласия с офертой подделывается и считается двумя разными функциями
`src/app/api/orders/create/route.ts:29-32` объявляет собственный `resolveClientIp`
(приоритет `x-forwarded-for`), тогда как весь остальной код использует `clientIp()`.
Значение уходит в `termsIpAddress` как юридическое доказательство согласия.

**План:** удалить `resolveClientIp`, использовать единый `clientIp()` после фикса U2.
Дополнительно писать в `ConsentEvidence` `userAgent` и `deploymentId` — IP сам по себе
слабое доказательство.

### U10. CSP допускает `unsafe-inline` + `unsafe-eval`
`next-security.ts:19`. На платёжном сайте это главный отсутствующий барьер против XSS.
В коде честно помечено как «later hardening step».

**План (поэтапно, чтобы не сломать VK ID/Telegram WebView):**
1. Включить `Report-Only`-политику с nonce параллельно текущей — собрать нарушения через
   существующий `/api/observability/client`.
2. Перевести инлайн-скрипт `src/app/twa/page.tsx:18` на nonce.
3. Убрать `unsafe-eval` (проверить, не нужен ли он Next-рантайму в dev-режиме).
4. Убрать `unsafe-inline` для `script-src`, оставив на `style-src` до перевода Tailwind.
5. Enforce только после чистого отчёта на iPhone/Android/Telegram WebView/VK WebView.

---

## U11 + U18 — TWA: устойчивость и БД

### U11. `?date=` роняет `buyer-funnel` в 500
`src/app/api/twa/buyer-funnel/route.ts:61,67`: при мусорном `date` получается `Invalid Date`,
и `from.toISOString()` бросает `RangeError` без обработчика. SQL-инъекции нет (падает до
интерполяции), но 400 подменяется 500.

**План:** валидировать `date` через zod (`/^\d{4}-\d{2}-\d{2}$/`) + проверку
`Number.isFinite(d.getTime())`, вернуть 400. Пройтись тем же чеком по остальным TWA-роутам,
принимающим `range`/`date`.

### U18. Полное сканирование `WbOrder`
`src/app/api/twa/roblox-account/purchase/route.ts:37,245,266` ищут заказы через
`gamepassUrl: { contains: '/<id>' }` списком `OR` — индекс неприменим, полное сканирование
на каждом поиске и перед каждой покупкой.

**План:** добавить в `WbOrder` поле `gamepassId String?` (заполняется при записи
`gamepassUrl`), индекс `@@index([gamepassId])`, миграцию с backfill через regexp из
существующих `gamepassUrl`. Все три запроса перевести на точное сравнение по `gamepassId`;
парсинг-постфильтр удалить как более ненужный.

---

## U12 — Нет ретенции данных

`PriceQuote`, `EmailActionToken`, `ConsentEvidence`, `OrderEvent` не чистятся. `deleteMany`
есть только для `TelegramWebLoginChallenge` (`src/lib/telegram-web-login.ts:25`). В связке с
U2 это вектор неограниченного роста продовой БД анонимными запросами.

**План:** cron `scripts/retention.mjs` (или шаг существующего TG-крона), раз в сутки:
`PriceQuote` со `status != CONSUMED` и `expiresAt < now − 7d` → удалить;
`EmailActionToken` с `expiresAt < now − 30d` → удалить;
`OrderEvent` старше 18 месяцев → архив/удаление по решению владельца.
`ConsentEvidence` **не трогаем** — это юридическое доказательство.
Отдельно: `PriceQuote` с `userId = null` (анонимные) невозможно потребить — не создавать их
вовсе, отдавать расчёт без записи в БД до логина.

---

## U13 + U14 + U15 — мёртвый код и тупики

### U13. Legacy-слой `Order`/`Product` жив и открыт наружу
Модели обслуживаются: `api/admin/products/**`, `api/admin/orders/[id]/fulfill`,
`api/bot/update-order`, `api/orders/webhook-to-automation`,
`admin/(protected)/products`. При этом `BOT_API_TOKEN` и `INTERNAL_WEBHOOK_SECRET` есть в
`.env.example`, но отсутствуют в реальном окружении — значит два роута навсегда возвращают
401. Чистая поверхность атаки с нулевой функцией.

**План:**
1. SQL-проверка нулевого production-остатка: `SELECT count(*) FROM "Order"`,
   `SELECT count(*) FROM "Product"` + дата последней записи.
2. Если ЛК (`src/app/dashboard/page.tsx:145`) всё ещё показывает исторические `Order` —
   сначала мигрировать их в `WbOrder(orderSource=LEGACY)` или согласовать с владельцем
   отключение исторической выдачи.
3. Удалить роуты `api/bot/update-order`, `api/orders/webhook-to-automation`,
   `api/admin/products/**`, страницу `admin/(protected)/products`, `api/admin/orders/[id]/fulfill`.
4. Отдельной миграцией удалить модели `Order`, `Product` и связанные FK.
5. Вычистить `BOT_API_TOKEN`, `INTERNAL_WEBHOOK_SECRET` из `.env.example`.
6. Обновить `architecture.md` (раздел «Переход от legacy checkout») — снять формулировку
   «остаются read-only/legacy».

### U14. ~1180 строк мёртвого UI
Ни одного входящего импорта:

| Файл | Строк |
|---|---|
| `src/components/ui/particle-text-effect.tsx` | 385 |
| `src/components/ui/instruction-reveal-curtain.tsx` | 200 |
| `src/components/ui/spotlight-card.tsx` | 192 |
| `src/components/ui/lamp.tsx` | 158 |
| `src/components/admin/order-list.tsx` | 155 |
| `src/app/twa/_components/Pressable.tsx` | 64 |
| `src/app/twa/_components/StatCard.tsx` | 18 |
| `src/components/ui/demo.tsx` + `particle-text-demo.tsx` | 16 |

**План:** удалить одним коммитом, проверить `npm run build` и визуальный смоук `/`, `/guide`,
`/twa`, `/admin`. `particle-text-effect` держится только за мёртвый `particle-text-demo` —
удалять парой.

### U15. Smoke охраняет неиспользуемый файл
`public/vendor/vkid-sdk-2.6.5.js` (170 КБ) не подключён нигде: `VKAuthButton.tsx:4`
импортирует npm-пакет `@vkid/sdk` **2.6.6**. Единственная ссылка — `scripts/smoke-corridor.mjs:125`,
который проверяет наличие файла и рапортует ✅. Ложный зелёный плюс расхождение версий с
задокументированной.

**План:** удалить файл; в `smoke-corridor.mjs` заменить проверку на реально используемый
`/vendor/telegram-web-app.js` и на присутствие бандла VK ID в статике Guide.

### Прочее к той же уборке
- `src/app/api/twa/debug/route.ts` — диагностика закрытого инцидента, гейт корректный
  (`ADMIN_SECRET` + `timingSafeEqual`), но роут пора удалить.
- `NmReportSchema` не используется (`src/lib/wb-api.ts:180`).
- `test_write.tmp` **закоммичен** в публичный репозиторий — удалить из индекса.
- `_write_test_ok`, `tsconfig.tsbuildinfo`, `.DS_Store` — добавить в `.gitignore`.

---

## U16 + U17 — вернуть работающие гейты качества

### U16. `eslint` непригоден как гейт
1121 error / 346 warning, практически всё — `@typescript-eslint/no-explicit-any`. В таком
виде линтер не может стоять в CI: новая настоящая ошибка утонет в шуме. Нет ни одной
ошибки другого класса — то есть кодовая база чистая, а правило просто не соответствует
принятому стилю (`(db as any).wbCode` — сознательное решение, `architecture.md:129`).

**План:**
1. Понизить `no-explicit-any` до `warn` в `eslint.config.mjs`.
2. Добавить `--max-warnings` порог по текущему числу и запретить его рост.
3. Починить единственную реальную находку: неиспользуемый `NmReportSchema`.
4. Включить `npm run lint` в pre-push и в release-чеклист `deploy.md`.
5. Отдельной задачей (P2) — типизировать WB-модели и убрать касты, после чего вернуть
   правило в `error`.

### U17. `bots/` вне проверки типов
`architecture.md:121` фиксирует: `bots/` исключён из `tsconfig.json`, `tsc --noEmit` их не
видит, ошибки всплывают только в рантайме. Это 9000+ строк самого нагруженного кода. Обе
находки U4 и U6 — ровно из этой зоны.

**План:**
1. Завести `bots/tsconfig.json`, наследующий корневой, с `strict: false` на старте.
2. Добавить `npm run bots:tsc` и прогнать; зафиксировать текущее число ошибок как baseline
   (памятка: 04.07 боты были чисты, регресс нужно измерить).
3. Включить `bots:tsc` в pre-push рядом с корневым `tsc`.
4. Постепенно поднять до `strict: true`.
5. Подключить jest к `bots/shared/**` — начать с `gp-watch-confirm` и хелпера владельца из U6.

---

## Порядок выполнения

**Волна 1 — до любых внешних действий (P0):** U1, U2. Пока они открыты, любая публичная
активация сайта увеличивает риск. U5 (redeploy Guide) делается сразу же — он занимает минуты.

**Волна 2 — деньги и данные клиента (P1):** U3+U4, U6, U16+U17. U16/U17 идут здесь
намеренно: без них нет защиты от повторения U4/U6.

**Волна 3 — перед боевым эквайрингом (P2, но блокирующие):** U7 (иначе ККТ-прогон
некорректен), U8, U9, U12.

**Волна 4 — гигиена:** U10 (поэтапно), U11, U13, U14, U15, U18.

## Связанные документы

- `security.md` — риски №1, №2, №7, №15, №18, №24, №25
- `payments-and-kkt.md` — refund и ККТ test matrix (правится по U7)
- `deploy.md` — release-чеклист (правится по U5, U16)
- `architecture.md` — legacy-переход (правится по U13), исключение `bots/` (U17)
- `trello-workflow.md` — формат карточек
