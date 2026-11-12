# Переезд: база и TG-бот во Франкфурт (план от 13.11.2026)

**Статус:** подготовлено, ждёт окончания оплаченного месяца гонконгского сервера и команды
владельца. Выбран **вариант 1**: свой Postgres 17 в Coolify на франкфуртском сервере вместе с
TG-ботом (тариф Pro: 4 CPU / 4 ГБ / 40 ГБ, €9.95), Neon ($20/мес) — отключаем.

Адреса, пароли, ключи — только в `HANDOFF.md` (репозиторий публичный).

## Почему (замеры 13.11.2026, время TCP-соединения)

| Откуда → куда | Сингапур (Neon сейчас) | Франкфурт | Москва | Telegram API | Anthropic |
|---|---|---|---|---|---|
| РФ (сайт, ВК-бот) | 278 мс | 52 мс | 6 мс | недоступен | 403 |
| Гонконг (TG-бот) | 40 мс | 193 мс | 233 мс | 214 мс | 403 |

## Что было на гонконгском сервере (переезжает или отключается всё)

| Что | Как найти | Судьба |
|---|---|---|
| TG-бот (Coolify «TG_bot_HK») | приложение `gl6r24…` | → Франкфурт |
| Мост для сайта и ВК-бота: проверка Roblox и отправка в Telegram (`/tg-proxy`) — порт 3000 бота | у Web и VK `VALIDATOR_SOURCE_URL = http://<HK>:3000` | новый адрес `http://<FRA>:3000` у Web и VK |
| `neon-relay.service` (socat :5433) — запасной путь РФ → Neon | systemd на HK | не нужен; на РФ выключить `neon-route.timer` |
| Сервис браузерного выкупа (`ROBLOX_PURCHASE_SERVICE_URL = 172.17.0.1:9223`) | **на HK не запущен** — жил на SG (`/opt/roblox-buyout`, `roblox-purchase-service.service`), SG выключен | **уже не работает.** Решить с владельцем: поднять во Франкфурте (Chrome + cookie донора) или убрать env |

Также на РФ: `roblox-purchase-tunnel.service` (туннель к SG:9223) — мёртв, выключить вместе с
решением по сервису выкупа.

## Что подготовлено в коде (уже в main)

- `bots/shared/db-ssl.ts` — TLS к базе. Без `DATABASE_CA` поведение прежнее (Neon,
  `verify-full`). С `DATABASE_CA` (PEM корня CA Coolify) — проверка сертификата по нашему CA,
  `sslmode` убирается из строки (в node-postgres строка перебивает объект `ssl`). Подключено в
  `bots/shared/db.ts` (боты) и `src/lib/prisma.ts` (сайт). Тест `db-ssl.test.ts`.
- `scripts/db-move/transfer.sh` — `rehearsal | final | verify`: `pg_dump` (клиент postgres:17)
  из Neon → `pg_restore` в контейнер Coolify, сверка числа строк по всем таблицам и миграций
  Prisma, отказ при несовпадении сортировки. Дампы — `/root/db-move` (600), хранит 3 последних.

## О базе (13.11.2026)

Postgres 17.11 (Neon), 55 МБ, 46 таблиц, 18 enum, расширений нет (кроме plpgsql), одна
функция-триггер `wborder_sync_gamepass_id` (из миграций, переносится дампом), сортировка
**C.UTF-8**, часовой пояс GMT. Самые большие таблицы: WbMarketplaceOrder 14 МБ,
WbBuyerChatEvent 8 МБ, WbMarketplaceEvent 6.5 МБ. Код специфики Neon не использует (кроме
подстановки `-pooler` для `ep-…` хостов в `src/lib/prisma.ts` — к своему хосту не применяется).

## Шаг 1. Сервер (до окна, без простоя)

1. Владелец: Frankfurt · **Pro**, Ubuntu 24.04. IP и root-пароль → HANDOFF.
2. Вход по ключу, пароль выключить; `fail2ban`; ufw: 22, 80, 443, 3000 (мост — только с IP
   РФ), 5432 (база — только с IP РФ).
   **Внимание: Docker обходит ufw** для опубликованных портов — ограничение 5432/3000 ставить в
   цепочке `DOCKER-USER` (`iptables -I DOCKER-USER -p tcp --dport 5432 ! -s <RF_IP> -j DROP`),
   сохранить через `iptables-persistent`.
3. Coolify (на РФ): Servers → Add → ключ Coolify (как HK, см. HANDOFF) → Validate.
4. Проверки с нового сервера: `curl api.telegram.org`, Anthropic (`/v1/messages` → 200),
   `apis.roblox.com`, `feedbacks-api.wildberries.ru`; с РФ: TCP до `<FRA>:5432` (DPI на
   границе — если режет, запасной путь: autossh-туннель РФ → FRA, как бывший purchase-tunnel).

## Шаг 2. Postgres в Coolify (до окна)

New Resource → Database → PostgreSQL, сервер Франкфурт:
- **Image: `postgres:17`** (Debian; в alpine нет локали C.UTF-8);
- **Initdb args: `--locale=C.UTF-8 --encoding=UTF8`** — сортировка как у Neon;
- user `rb`, db `robloxbank`, длинный пароль → HANDOFF;
- `postgres_conf`: `shared_buffers=256MB`, `effective_cache_size=1GB`, `work_mem=8MB`,
  `max_connections=60`, `statement_timeout` не ставить (боты задают свой);
- лимит памяти контейнера 1 ГБ;
- **SSL: включить** (verify-full), **Public: да, порт 5432** (доступ режет DOCKER-USER);
- CA для клиентов: `/data/coolify/ssl/` на сервере (корневой `coolify-ca.crt`) → env
  `DATABASE_CA` у Web и VK (PEM, переносы как `\n`).

Бэкапы (Coolify → S3 Storage): Cloudflare R2 (бесплатно до 10 ГБ), bucket `robloxbank-db`,
endpoint `https://<account>.r2.cloudflarestorage.com`, region `auto`. Расписания на базе:
каждый час (хранить 48) и раз в сутки (хранить 14). Уведомления Coolify → Telegram: бот
@RobloxBankBot, беседа админов, тема «📊 Сводки» — на провал бэкапа и падение базы.

Репетиция: `DB_MOVE_ENV=/root/db-move.env bash scripts/db-move/transfer.sh rehearsal`
(SOURCE_URL — прямой адрес Neon, НЕ `-pooler`). Ожидаемо: ~1 мин, «✅ все 46 таблиц совпали».
Проверить подключение сайта: временно из контейнера Web `node -e` с новым URL + `DATABASE_CA`.

## Шаг 3. TG-бот на Франкфурте (до окна — подготовить, не запускать)

Клонировать приложение TG-бота на сервер Франкфурта (Coolify: Clone / смена Destination),
перенести все переменные (40 шт., список — `environment_variables` приложения; среди них
`PA_*`, `ANTHROPIC_API_KEY`, `WB_*`, `VALIDATOR_KEY`). `DATABASE_URL` — внутренний адрес
контейнера Postgres (без TLS, та же docker-сеть Coolify). **Не запускать, пока работает HK** —
два polling одного бота = 409.

## Шаг 4. Окно переезда (~15 мин, ночь МСК)

1. Предупредить беседу админов. Остановить TG-бот на HK и VK-бот (Coolify → Stop).
   Сайт оставить (окно короткое; заказы с сайта за эти минуты уйдут в старую базу — см. п. 6).
2. `transfer.sh final` → «✅ все 46 таблиц совпали».
3. Env: Web и VK — `DATABASE_URL=postgresql://rb:<pwd>@<FRA>:5432/robloxbank`,
   `DATABASE_CA=<PEM>`, `VALIDATOR_SOURCE_URL=http://<FRA>:3000`. Restart Web и VK (env
   рантайма, сборка не нужна). Запустить TG-бот на Франкфурте.
4. Проверка: `/api/health`, `/admin`, TWA (список заказов), бот `/start`, `/digest` в беседе,
   ассистент «сколько выкупили сегодня» (ИИ должен ответить — Anthropic доступен),
   логи `[WbDbsSync]`, `[pa-desk]`, `[vk-labels]`, отправка уведомления с сайта в Telegram (мост).
5. РФ: `systemctl disable --now neon-route.timer && bash /root/neon-route.sh off`.
6. Сверить, не было ли записей в Neon после `final` (заказы с сайта в окне):
   `select max("createdAt") from "WbOrder"` на обеих базах; если были — перенести руками.
7. Neon: не удалять 7 дней (откат). Потом удалить проект — экономия ~$20/мес.
8. Гонконг: выключить после 1–2 суток спокойной работы.

**Откат (в первые часы):** вернуть `DATABASE_URL` Neon у Web/VK, убрать `DATABASE_CA`, вернуть
`VALIDATOR_SOURCE_URL` на HK, остановить TG на FRA и запустить на HK. Записи, сделанные во
франкфуртской базе после переключения, перенести обратно (`pg_dump --data-only` по таблицам).

## После переезда

- Раз в неделю — проверка бэкапа: восстановить последний во временную базу и сверить строки
  (`transfer.sh verify` против неё).
- Уведомление в беседу при диске > 80 %.
- `bots/shared/db.ts`: убрать Neon-keepalive `SELECT 1` раз в 4 мин (больше не нужен).
