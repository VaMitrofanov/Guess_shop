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

## Единая экосистема каналов

Клиент может начать на сайте и продолжить в TG или VK — состояние живёт в БД, а не в памяти
процесса. Один код = один `WbOrder`, привязанный к одному `User`. Кросс-платформенные грабли
(VK-логин на сайте создаёт юзера без диалога → заказ привязан «не туда») решаются
перепривязкой заказа в TWA (`rebind-order`).

## Карта файлов

```
src/
  app/
    guide/GuideClient.tsx        роутер фаз коридора (intro / gate / instruction)
    guide/WBInstructionV2.tsx    9-шаговая WB-инструкция + поиск по нику
    guide/page.tsx               серверная обёртка гейта (query-флаги: skip/code/test/preview)
    api/wb-code/route.ts         резерв/статус кода (POST reserve, GET status)
    api/wb-code/select-gamepass  материализация заказа при выборе геймпасса на сайте (one-tap)
    api/wb-link/route.ts         линковка кода к юзеру после VK-логина (коридор → VK)
    api/roblox/gamepasses        поиск геймпассов по нику/ID (напрямую в Roblox)
    api/twa/**                   API TWA-админки (все под extractTwaUser)
  auth.ts                        NextAuth (admin + vk-id провайдеры)
  lib/
    twa-auth.ts                  initData HMAC + JWT для TWA
    roblox.ts                    Roblox API для сайта (4 эндпоинта details)
    pricing.ts, wb-api.ts        цены + Wildberries API (для TWA-аналитики)

bots/
  shared/
    admin.ts            карточки заказов/отзывов для TG-админов, CB-константы
    roblox.ts           валидация геймпасса (богаче, чем lib/roblox: private/managed/age)
    notify.ts           tgSend / vkSend / tgSendPhoto
    gamepass-search.ts  поиск по нику (union: user_not_found / no_gamepasses / ok)
    bridge.ts           HTTP-прокси (Singapore)
    db.ts               Prisma-клиент для ботов (Pool=3)
  tg/
    handlers.ts         весь TG-бот (~4700 строк)
    crons.ts            напоминания (отзыв / сток кодов / ожидание ссылки)
    session.ts          in-memory: pendingLink, pendingRobloxNick, pendingReview, …
    admin/              TG admin hub (orders, stats, WB, system, rates)
  vk/
    handlers.ts         весь VK-бот (~2900 строк), паритет с TG
    session.ts          in-memory VK-сессии

prisma/schema.prisma    схема БД
```

> **ВАЖНО:** `bots/` исключён из корневого `tsconfig.json`. `tsc --noEmit` **не проверяет**
> бот-файлы — ошибки в ботах видны только в рантайме. Тестируй руками.

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

## <a name="legacy"></a>Legacy-подсистема (вне текущего воркфлоу)

В коде живёт исходная модель «прямая продажа через сайт» из `PLAN.md`:
`/checkout`, `/payment/status`, `api/orders/create`, `api/orders/[id]`,
`api/orders/webhook-to-automation`, `api/webhooks/tinkoff`, `lib/tinkoff.ts`,
`api/admin/*` (CRUD товаров/FAQ/отзывов), `src/components/admin/*`, `hooks/usePricing`.

Сайт `robloxbank.ru` пока не запущен, эта ветка не участвует в WB-коридоре. Решение —
за владельцем: либо доудалить (если робуксы продаются только через коридор + прямые заказы
в ботах), либо изолировать и задокументировать как «будущий функционал». Пока оставлена.
