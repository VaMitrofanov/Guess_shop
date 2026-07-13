# RobloxBank — документация

Сервис выкупа Robux у российских пользователей. Клиент покупает карту на Wildberries,
на вкладыше — 7-символьный код. Он активирует код на сайте, попадает в Telegram- или
VK-бота, создаёт геймпасс в Roblox, менеджер его выкупает — клиент получает деньги.
Ключевая бизнес-цель: приучить клиента заказывать **повторно прямо в боте**, а не через WB.

> **Секреты, доступы к серверам и деплою** намеренно НЕ в этом репозитории (он публичный).
> Операционная информация — в локальном `HANDOFF.md` (в `.gitignore`).

## Карта документации

| Файл | О чём |
|------|-------|
| [architecture.md](architecture.md) | Обзор системы, стек, три канала как единая экосистема, поток данных |
| [b2b-saas.md](b2b-saas.md) | Партнёрское/B2B-направление: TWA/server MVP `Антон`, USDT-ledger, ручной XLSX import, rollout Sheets/batch |
| [corridor-and-site.md](corridor-and-site.md) | WB-гейт, сайт `/guide`, API коридора, восстановление сессии |
| [site-acquiring-master-plan.md](site-acquiring-master-plan.md) | Ультра-ревью `robloxbank.ru`, P0-блокеры эквайринга, единые цена/identity/orders, дизайн и поэтапный launch plan |
| [design-rework-concept.html](design-rework-concept.html) | Интерактивный визуальный концепт глобального реворка главной и mobile-first WB guide |
| [bots.md](bots.md) | TG- и VK-боты: активация, приём геймпасса, прямые заказы, поддержка, отзывы |
| [twa-admin.md](twa-admin.md) | Telegram Web App админка: аутентификация, заказы, выкуп, аккаунт |
| [twa-design-redesign-plan.md](twa-design-redesign-plan.md) | План глубокого редизайна TWA: навигация, единый поиск, compact cards/history, прибыль DIRECT/AVITO и слив |
| [database.md](database.md) | Модели Prisma и статусы заказов/кодов |
| [payments-and-kkt.md](payments-and-kkt.md) | Эквайринг, outbox worker, refund и ККТ test matrix |
| [deploy.md](deploy.md) | Как деплоится каждый сервис (без секретов) |
| [security.md](security.md) | Модель угроз, известные риски, что проверять перед прод-изменениями |
| [trello-workflow.md](trello-workflow.md) | Правила работы с Trello: понятные карточки, техническая расшифровка и статусы |

## Три канала — единая экосистема

- **Сайт** `robloxbank.ru/guide?source=wb` — точка входа с WB, инструкция.
- **TG-бот** `@RobloxBankBot` — основной рабочий канал.
- **VK-бот** `vk.me/club237309399` — альтернатива для VK-аудитории (воркфлоу идентичен TG).
- **TWA** — админка внутри Telegram для менеджера (заказы, выкуп, аналитика).

Публичный корень `robloxbank.ru` пока закрыт maintenance-режимом; рабочая точка входа —
WB-гайд. Новый checkout использует канонический `WbOrder`/quote/payment-attempt; outbox
worker, refund и локальная ККТ contract matrix готовы, но боевой payment E2E ещё не выполнен; kill-switch
(`SITE_ACQUIRING_ENABLED=false`) выключен, поэтому он не готов к деньгам и не участвует в
текущем воркфлоу —
см. [architecture.md](architecture.md#legacy) и
[master plan эквайринга](site-acquiring-master-plan.md).

## Локальный запуск

```bash
npm install            # + prisma generate (postinstall)
npm run dev            # сайт (Next.js)
npm run bot:tg         # TG-бот (отдельный терминал)
npm run bot:vk         # VK-бот
npm run dev:reset-test # сбросить тестовый код в AVAILABLE
```

`.env.local` должен содержать переменные из `.env.example` + переменные ботов
(см. [deploy.md](deploy.md)).
