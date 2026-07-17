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
| [tbank-precheck-2026-07-17.md](tbank-precheck-2026-07-17.md) | Предрелизный аудит публичной ссылки для Т‑Банка 17.07: фактические тесты, найденные блокеры и план закрытия |
| [design-rework-concept.html](design-rework-concept.html) | Интерактивный визуальный концепт глобального реворка главной и mobile-first WB guide |
| [twa-ux-v3-concept.html](twa-ux-v3-concept.html) | Визуальный концепт TWA v3: два варианта Главной, умная выдача и foreground bottom sheet |
| [bots.md](bots.md) | TG- и VK-боты: активация, приём геймпасса, прямые заказы, поддержка, отзывы |
| [twa-admin.md](twa-admin.md) | Telegram Web App админка: аутентификация, заказы, выкуп, аккаунт |
| [twa-design-redesign-plan.md](twa-design-redesign-plan.md) | Контракт редизайна TWA: навигация, поиск, compact cards/history, прибыль и Premium Calm для Аккаунта/Заказов |
| [database.md](database.md) | Модели Prisma и статусы заказов/кодов |
| [payments-and-kkt.md](payments-and-kkt.md) | Эквайринг, outbox worker, refund и ККТ test matrix |
| [deploy.md](deploy.md) | Как деплоится каждый сервис (без секретов) |
| [security.md](security.md) | Модель угроз, известные риски, что проверять перед прод-изменениями |
| [trello-workflow.md](trello-workflow.md) | Правила работы с Trello: понятные карточки, техническая расшифровка и статусы |
| [roblox-plus-buyout-plan.md](roblox-plus-buyout-plan.md) | Транспорт выкупа ГП: почему серверный fetch не проходит chef, браузерный скрипт покупки и его гарды; Roblox Plus 10–20% — классификация и пачка |

## Три канала — единая экосистема

- **Сайт** `robloxbank.ru/guide?source=wb` — точка входа с WB, инструкция.
- **TG-бот** `@RobloxBankBot` — основной рабочий канал.
- **VK-бот** `vk.me/club237309399` — альтернатива для VK-аудитории (воркфлоу идентичен TG).
- **TWA** — админка внутри Telegram для менеджера (заказы, выкуп, аналитика).

Публичный корень `robloxbank.ru` открыт 17.07 для предварительного просмотра Т‑Банком;
WB-гайд остаётся отдельной рабочей точкой входа. Новый checkout использует канонический
`WbOrder`/quote/payment-attempt; outbox worker, refund и локальная ККТ contract matrix
готовы, но боевой payment E2E ещё не выполнен. Acquiring fail-closed: значение
`SITE_ACQUIRING_ENABLED=true` не установлено, поэтому сайт не может создать `Init` и
принять деньги —
см. [architecture.md](architecture.md#legacy) и
[master plan эквайринга](site-acquiring-master-plan.md).

С 16.07 публичный shell имеет custom 404/error recovery, корректные SEO/noindex-границы,
PII-safe Core Web Vitals/client-error telemetry и read-only `npm run smoke:site`. Web и
отдельный Guide-контейнер после rollout `b6b699f` отдают общий source fingerprint
`20183b40b8783d9c`; corridor-smoke `29/29`. Quick-fix batch для банковской ссылки добавил
runtime payment-disabled state, платёжные логотипы, registration consent, mobile legal fix
и актуальный public copy; VK ID скрыт fail-closed до живого acceptance. Corridor-smoke
автоматически обнаруживает будущий drift. Это закрывает storefront hardening, но не заменяет реальные
TG/VK/iPhone/Android acceptance, реквизиты, ККТ/payment E2E и soft launch.

Личный кабинет и все три поверхности входа используют общий Violet/Frost shell. Email-вход
нормализует адрес, Telegram login/link идёт через одноразовый bot-assisted challenge с
серверной HMAC-проверкой, а VK identity проверяется сервером. Email-сценарий ЛК принят на
production; живой Telegram/VK acceptance остаётся обязательным перед включением оплаты.

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
