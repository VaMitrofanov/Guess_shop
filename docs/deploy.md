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
`ADMIN_SECRET`, `WB_API_TOKEN`, `MAINTENANCE_MODE` (опц., см. ниже), `SITE_UNLOCK_SECRET`
(опц., байпас техработ). (Legacy: `TINKOFF_SECRET_KEY`, `LOCAL_BOT_URL`,
`INTERNAL_WEBHOOK_SECRET`, `BOT_API_TOKEN`.)

**TG-бот:** `DATABASE_URL`, `TG_TOKEN`, `TG_CHANNEL_ID` (опц., гейт подписки), `ADMIN_IDS`,
`VALIDATOR_SOURCE_URL`, `VALIDATOR_KEY`, health-мониторинг (`HETZNER_API_TOKEN`, `VDSINA_*`).

**VK-бот:** `DATABASE_URL`, `VK_TOKEN`, `VK_GROUP_ID`, `ADMIN_IDS`, `VALIDATOR_SOURCE_URL`,
`VALIDATOR_KEY`, `TG_TOKEN` (уведомления менеджерам идут через Telegram).

**Bridge:** `VALIDATOR_KEY`, `VALIDATOR_PORT`.

**Опционально (health в TWA/боте):** `TG_BOT_HEALTH_URL`, `VK_BOT_HEALTH_URL` — если не заданы,
код падает на захардкоженные IP-фолбэки (рекомендуется задать env, см. [security.md](security.md)).

## Режим техработ (скрытие витрины)

`src/proxy.ts` (Next 16 Proxy, бывший middleware) гейтит **только витринные страницы**
Web-контейнера: `/`, `/faq`, `/reviews`, `/checkout`, `/dashboard`, `/login`, `/register`,
`/payment`, `/legal`, `/privacy`, `/guarantees`, `/admin`. Коридор `/guide` (отдельный
контейнер, из Guide-сборки proxy вырезается в `Dockerfile.guide`), `/twa`, все `/api/*` и
статика **не затрагиваются** — боты, коридор и TWA работают в любом режиме.

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

> **Управление через Coolify API** (токен — в разделе Coolify выше; UUID Web —
> `z10ws7m1q45h281zwedmhei4`):
> ```bash
> B=http://89.110.94.117:8000/api/v1; A=z10ws7m1q45h281zwedmhei4
> # выставить/поменять env:
> curl -s -X POST  -H "Authorization: Bearer $COOLIFY_TOKEN" -H 'Content-Type: application/json' \
>   "$B/applications/$A/envs" -d '{"key":"MAINTENANCE_MODE","value":"on","is_preview":false}'
> curl -s -X PATCH -H "Authorization: Bearer $COOLIFY_TOKEN" -H 'Content-Type: application/json' \
>   "$B/applications/$A/envs" -d '{"key":"MAINTENANCE_MODE","value":"off","is_preview":false}'
> # применить (Restart — быстро, без пересборки; env читается при создании контейнера):
> curl -s -X POST  -H "Authorization: Bearer $COOLIFY_TOKEN" "$B/applications/$A/restart"
> ```
> Поле `is_build_time` API отклоняет — не передавать. После Restart проверить:
> `docker exec robloxbank-web printenv MAINTENANCE_MODE` и `docker inspect … Health.Status`.

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
