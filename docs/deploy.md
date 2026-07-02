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

## Env-переменные (имена, без значений)

**Web:** `DATABASE_URL`, `AUTH_SECRET` (или `NEXTAUTH_SECRET`), `NEXTAUTH_URL`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_VK_APP_ID`, `TG_TOKEN`, `TG_CHAT_ID`, `ADMIN_IDS`,
`ADMIN_SECRET`, `WB_API_TOKEN`. (Legacy: `TINKOFF_SECRET_KEY`, `LOCAL_BOT_URL`,
`INTERNAL_WEBHOOK_SECRET`, `BOT_API_TOKEN`.)

**TG-бот:** `DATABASE_URL`, `TG_TOKEN`, `TG_CHANNEL_ID` (опц., гейт подписки), `ADMIN_IDS`,
`VALIDATOR_SOURCE_URL`, `VALIDATOR_KEY`, health-мониторинг (`HETZNER_API_TOKEN`, `VDSINA_*`).

**VK-бот:** `DATABASE_URL`, `VK_TOKEN`, `VK_GROUP_ID`, `ADMIN_IDS`, `VALIDATOR_SOURCE_URL`,
`VALIDATOR_KEY`, `TG_TOKEN` (уведомления менеджерам идут через Telegram).

**Bridge:** `VALIDATOR_KEY`, `VALIDATOR_PORT`.

**Опционально (health в TWA/боте):** `TG_BOT_HEALTH_URL`, `VK_BOT_HEALTH_URL` — если не заданы,
код падает на захардкоженные IP-фолбэки (рекомендуется задать env, см. [security.md](security.md)).

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
