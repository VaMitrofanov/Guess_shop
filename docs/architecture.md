# Архитектура

## Стек

| Слой | Технология |
|------|-----------|
| Фронтенд | Next.js 16 (App Router), React 19, Tailwind 4, Framer Motion |
| Аутентификация (сайт) | NextAuth v5 (CredentialsProvider: admin-login + vk-id) |
| Аутентификация (TWA) | Telegram initData HMAC → собственный JWT (`src/lib/twa-auth.ts`) |
| БД | Neon Postgres + Prisma 7 (engineType=library, adapter=PrismaPg) |
| TG-бот | Telegraf, отдельный процесс (`bots/tg/bot.ts`) |
| VK-бот | vk-io, отдельный процесс (`bots/vk/bot.ts`) |
| Bridge | Небольшой HTTP-сервер (`bots/shared/bridge.ts`) — прокси к Roblox/Telegram API |
| Деплой | Coolify, каждый сервис — отдельный Docker-контейнер |

## Сервисы (контейнеры)

- **Web** — Next.js: сайт `/guide`, все `/api/*`, TWA-админка `/twa`.
- **Guide** — отдельный билд гейта (`Dockerfile.guide`, `next.config.guide.ts`), обслуживает только `/guide?source=wb`.
- **TG-бот** — Telegraf-процесс.
- **VK-бот** — vk-io-процесс. Уведомления менеджерам он шлёт **через Telegram** (у VK нет своего интерфейса для менеджеров) — см. `bots/shared/notify.ts`.
- **Bridge** — прокси для обхода блокировок. На текущий момент Roblox API отвечает
  и напрямую из РФ; `/tg-proxy` всё ещё используется VK-ботом для `api.telegram.org`.
  Перед изменениями перепроверяй доступность `curl`-ом.
- **Browser purchase-service (SG host, systemd)** — single-flight bridge к настоящему
  Chrome/Xvfb. TG обращается через SG docker bridge, Web/TWA — через ограниченный RF→SG
  SSH-туннель. Bearer-auth операции `/session`, `/gamepass-preflight` и `/purchase` используют
  один persistent browser context и общий no-backlog lock: donor cookie никогда не
  предъявляется Roblox из RF/Node. Service возвращает только нормализованные identity,
  balance, product/ownership и коды ошибок; покупку подтверждает только по ownership
  `false→true` и точной дельте баланса. Наружу порт не опубликован. Single-egress-фикс
  задеплоен 17.07; SG/Web/TG readiness подтверждён, денежный canary остаётся следующим gate.

## Единая экосистема каналов

Клиент может начать на сайте и продолжить в TG или VK — состояние живёт в БД, а не в памяти
процесса. Один код = один `WbOrder`, привязанный к одному `User`. Кросс-платформенные грабли
(VK-логин на сайте создаёт юзера без диалога → заказ привязан «не туда») устраняются
`UserIdentity`: после server-side проверки VK subject сначала находит прежний `User`, поэтому
его заказы и бонусы не теряются. Legacy `vkId`/`tgId` переходно сохраняются для ботов;
TG web-login и TG→current-account step-up merge реализованы через две свежие provider proofs;
VK link/unlink и recovery-console остаются следующими инкрементами. Цена прямого заказа в TG/VK/Web
считается одной чистой `retail-direct-v1` функцией; серверный `PriceQuote` хранит итог в
копейках и одноразово потребляется новым `WbOrder(SITE/WEB)`. `PaymentAttempt`, `OrderEvent`
и `OutboxMessage` образуют durable payment boundary; TG-сервис исполняет outbox с retry/dead-letter,
а refund имеет отдельный идемпотентный audit. Production Init закрыт kill-switch до внешних
launch-gates. ЛК читает `WbOrder` всех источников (legacy-таблица `Order` удалена 26.07),
bonus balance и предлагает TG link только внутри fresh-auth window.

## B2B-направление (TWA/server MVP)

Следующая продуктовая ветка — партнёрский выкуп сторонних геймпассов через тот же TWA.
Первый реальный кейс: партнёр **«Антон»** с Google-таблицей и отдельным бюджетом на выкуп.
На 2026-07-09 реализован ручной TWA/server MVP без Google Sheets sync/write-back:
режим `Антон` живёт внутри экрана «Аккаунт» (`Свои | Антон`), баланс партнёра ведётся
только в `USDT`, а R$-цена геймпасса конвертируется по курсу партнёра (`5.05 USDT / 1000 R$`
для текущего кейса). До Google Sheets строки можно вручную загрузить `.xlsx` файлом с
колонками `ГП/GP`, `Ник`, `Номинал`.

Важно: это **не продолжение `WbOrder`**, а отдельный bounded context поверх уже готового
buyout-движка (`search/resolve/purchase`, cookie-аккаунты, батчи, история покупок).
В коде контур живёт в `Partner`, `PartnerBuyoutTask`, `PartnerLedgerEntry`,
`src/lib/roblox-buyout.ts`, `BossrobuxScreen` и `GET/POST /api/twa/partners/anton/tasks`.
Покупка Антона пока использует общий donor-cookie `GlobalSettings.robloxCookie`; отдельный
cookie партнёра не добавлен.
Детали статуса, Sheets-контракта и rollout — в [b2b-saas.md](b2b-saas.md).

## Карта файлов

```
src/
  app/
    guide/GuideClient.tsx        роутер WB/SITE/BOT (intro / gate / shared instruction)
    guide/WBInstructionV2.tsx    единая 9-шаговая инструкция; channel-specific amount/CTA
    checkout/page.tsx            search-first: все пассы по нику → quote → оплата
    checkout/checkout.module.css rounded Violet/Frost UI checkout без legacy pixel-card
    guide/page.tsx               серверная обёртка гейта (query-флаги: skip/code/test/preview)
    api/wb-code/route.ts         резерв/статус кода (POST reserve, GET status)
    api/wb-code/select-gamepass  материализация заказа при выборе геймпасса на сайте (one-tap)
    api/wb-link/route.ts         линковка кода к юзеру после VK-логина (коридор → VK)
    api/roblox/gamepasses        поиск геймпассов по нику/ID (напрямую в Roblox)
    api/pricing/quote             короткая серверная котировка
    api/orders/create             quote → канонический SITE-order + payment attempt
    api/webhooks/tinkoff          strict callback state machine + durable event/outbox
    api/twa/**                   API TWA-админки (все под extractTwaUser)
    api/twa/partners/[slug]/tasks B2B server MVP: задачи/ledger/выкуп партнёра `anton`
  auth.ts                        NextAuth (admin + vk-id провайдеры)
  lib/
    gamepass-search-view.ts      sellable-filter, ranking и price-match результатов
    twa-auth.ts                  initData HMAC + JWT для TWA
    roblox.ts                    Roblox API для сайта (4 эндпоинта details)
    roblox-buyout.ts             shared resolve/purchase helper для retail и B2B
    retail-pricing.ts            web-facade общего TG/VK/Web price policy
    price-quote.ts               calculation + persistence краткой котировки
    canonical-web-order.ts       quote/gamepass invariants + atomic order foundation
    payment-notification.ts      разрешённые монотонные переходы платежа
    user-identity.ts             verified identity → канонический User без auto-merge
    pricing.ts, wb-api.ts        цены + WB API: finance v1 (P&L), sales-funnel v3,
                                 warehouse stocks v1; old operational statistics only for pulse

bots/
  shared/
    admin.ts            карточки заказов/отзывов для TG-админов, CB-константы
    roblox.ts           валидация геймпасса (богаче, чем lib/roblox: private/managed/age)
    notify.ts           tgSend / vkSend / tgSendPhoto
    gamepass-search.ts  поиск по нику (union: user_not_found / no_gamepasses / ok)
    bridge.ts           HTTP-прокси (Singapore)
    db.ts               Prisma-клиент для ботов (Pool=3)
  tg/
    handlers.ts         весь TG-бот (~5500 строк)
    crons.ts            напоминания (отзыв / сток кодов / ожидание ссылки)
    session.ts          in-memory: pendingLink, pendingRobloxNick, pendingReview, …
    admin/              TG admin hub (orders, stats, WB, system, rates)
  vk/
    handlers.ts         весь VK-бот (~3500 строк), паритет с TG
    session.ts          in-memory VK-сессии

prisma/schema.prisma    схема БД
```

> **`bots/` проверяется отдельным конфигом** (ultra-review U17, 26.07.2026). Код ботов
> по-прежнему исключён из корневого `tsconfig.json` (другой module/target), но теперь у него
> есть собственный гейт:
>
> ```bash
> npm run bots:tsc     # tsc --noEmit -p bots/tsconfig.json  → 0 ошибок на 26.07
> npm run test:bots    # jest --config jest.bots.config.js   → bots/**/__tests__
> ```
>
> Оба входят в release-чеклист (`docs/deploy.md`) и в `npm run gates`. До 26.07 эти 9000+
> строк — самый нагруженный код системы — не проверялись ничем, и обе находки ревью по
> бонусам (U4) и по чужим заказам (U6) пришли именно отсюда.

## Ключевые соглашения

- **Provisional order pattern.** Код берётся и заказ (`AWAITING_GAMEPASS`) создаётся **до**
  проверки подписки и **до** ввода геймпасса. Всегда есть `userId` + `platform` для
  любого активированного кода — контакт клиента не теряется, даже если он ушёл.
- **Prisma-касты.** `(db as any).wbCode` / `(db as any).wbOrder` — генератор Prisma иногда
  отстаёт по типам WB-моделей; боты кастуют в `any` для надёжности.
- **Callback_data 64 байта (Telegram).** CUID ≈ 25 символов, `orderId+userId` = 50+.
  Короткие ключи в `bots/shared/admin.ts` (`crn:`, `xrn:`, `rr:`). Считай длину при добавлении.
- **Робуксы.** `amount` в БД = **чистые** робуксы (что получает продавец).
  **Грязные** (номинал геймпасса) = `Math.ceil(amount / 0.7)` — Roblox забирает 30%.

## <a name="legacy"></a>Переход от legacy checkout

`/checkout`, `api/orders/create`, `api/orders/[id]` и T-Bank webhook переведены на
`WbOrder(SITE)`/quote/payment-attempt.

**Legacy-слой удалён 26.07.2026 (ultra-review U13).** Нулевой production-остаток
подтверждён (`SELECT count(*)` по `"Order"` и `"Product"` = 0), после чего удалены роуты
`api/bot/update-order`, `api/orders/webhook-to-automation`, `api/admin/products/**`,
`api/admin/orders/[id]/fulfill`, страница `admin/(protected)/products` и диагностический
`api/twa/debug`; модели `Order`/`Product` и enum `OrderStatus` сняты отдельной миграцией
`20260726_drop_legacy_shop` (применяется **после** выкатки кода). Два из этих роутов
всегда отвечали 401 — `BOT_API_TOKEN` и `INTERNAL_WEBHOOK_SECRET` в рабочем окружении
отсутствовали, то есть это была поверхность атаки с нулевой функцией.

Публичный сайт и Init по-прежнему выключены maintenance + `SITE_ACQUIRING_ENABLED=false`.
