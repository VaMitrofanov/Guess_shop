# Roblox Bank

Сервис выкупа Robux у российских пользователей. Клиент покупает карту на Wildberries,
активирует 7-символьный код на сайте, попадает в Telegram- или VK-бота, создаёт геймпасс
в Roblox, менеджер его выкупает — клиент получает деньги. Цель — приучить клиента заказывать
повторно прямо в боте.

**Стек:** Next.js (App Router) · TypeScript · Prisma · Neon Postgres · Telegram/VK боты ·
Telegram Web App (админка).

## Документация

Полная документация — в [`docs/`](docs/README.md):

| Файл | О чём |
|------|-------|
| [architecture.md](docs/architecture.md) | Обзор системы, три канала как единая экосистема |
| [corridor-and-site.md](docs/corridor-and-site.md) | WB-гейт, сайт `/guide`, API коридора |
| [bots.md](docs/bots.md) | TG- и VK-боты: активация, приём геймпасса, прямые заказы |
| [twa-admin.md](docs/twa-admin.md) | Telegram Web App админка |
| [database.md](docs/database.md) | Модели Prisma и статусы заказов |
| [deploy.md](docs/deploy.md) | Как деплоится каждый сервис |
| [security.md](docs/security.md) | Модель угроз, известные риски |

## Локальный запуск

```bash
npm install            # + prisma generate (postinstall)
npm run dev            # сайт (Next.js)
npm run bot:tg         # TG-бот (отдельный терминал)
npm run bot:vk         # VK-бот
```

`.env.local` — переменные из `.env.example` + переменные ботов (см. [docs/deploy.md](docs/deploy.md)).

> Репозиторий публичный. Секреты, доступы к серверам и деплою намеренно **не** в репозитории —
> операционная информация ведётся локально вне git.
