# RobloxBank — Project Handoff

> **⚠️ У ТЕБЯ ЕСТЬ ПОЛНЫЙ ДОСТУП К СЕРВЕРАМ ПО SSH И К COOLIFY. ЧИТАЙ СЕКЦИЮ «ДОСТУП К ИНФРАСТРУКТУРЕ» НИЖЕ. НЕ СПРАШИВАЙ ПОЛЬЗОВАТЕЛЯ О ДОСТУПАХ — ОНИ ВСЕ ЗДЕСЬ.**

> Передавай этот файл в каждую новую сессию Claude. Он содержит всё, что нужно, чтобы быстро войти в контекст, не читая тысячи строк кода.

---

## Сессия 2026-06-22 — WB-инструкция: чистые скрины + CSS-выделения (задеплоено + проверено в проде ✅)

**Коммит `0052fee`** → push в main → `RobloxBankWeb` авто-деплой + **Guide force-deploy вручную** (см. грабли ниже). Прод проверен.

**Файлы:** `src/app/guide/WBInstructionV2.tsx`, ассеты `public/guide/wb-step{4-menu,5-regional,6-price}.png`.

**Суть:** скриншоты Roblox (шаги 4/5/6) — **чистые PNG**, а все выделения/подписи/живая цена — **CSS-слой** поверх (`.wbi-anno` / `.wbi-box` / `.wbi-tip` / `.wbi-price6`). Раньше рамки были «запечены» в JPG через PIL → криво. Позиции заданы инлайн-процентами в JSX, выверены реальным рендером Playwright.
- **Шаг 4:** общий план (левый рейл приложения + раскрытое ☰-меню Creator Hub). Ник обезличен → «Твой ник». Золотая рамка на `Monetization`, зелёная на `Passes`.
- **Шаг 5:** зелёная+`ВКЛЮЧИ` на `Item for sale`, жёлтая+`ВЫКЛЮЧИ` на `Managed pricing`; живая цена `{price}` в поле (top 57.1%).
- **Шаг 6:** зелёная рамка на поле + бейдж `СЮДА ВСТАВЬ ЦЕНУ` (с кареткой) + живая цена `{price}` (top 65.7%). `.wbi-price6` масштабируется через `cqw`.
- Ассеты переведены в **PNG** (резкость UI-текста), старые `.jpg` удалены. Исходники кропов: `~/Downloads/Screenshot 2026-06-22 at 00.56.42.png` (меню) и `… 00.10.13.png` (Sales).

**Верификация прода:** `https://robloxbank.ru/guide?source=wb&test=1&nom=1000` → 200; `/guide/wb-step{4,5,6}-*.png` → 200; старые jpg → 404; визуально шаги 4/5/6 верны (Playwright); цена 1429 при номинале 1000.

### ⚠️ Деплой-грабли (критично — проверено сегодня)
- `/guide` обслуживает **Guide-контейнер** (`RobloxBank-Guide`, UUID `ebac6llpah5n2x58rb64yn8j`, RF `89.110.94.117`). Прод проверять на **апексе** `robloxbank.ru`, НЕ на `www.` (могут обслуживаться разными контейнерами).
- **Авто-деплой Guide по push в main НЕ срабатывает** — push авто-деплоит только `RobloxBankWeb`. Guide триггерить вручную:
  ```bash
  curl -s -X POST "http://89.110.94.117:8000/api/v1/deploy?uuid=ebac6llpah5n2x58rb64yn8j&force=true" \
    -H "Authorization: Bearer $COOLIFY_TOKEN"
  # затем поллить статус до finished:
  curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" "http://89.110.94.117:8000/api/v1/deployments/<deployment_uuid>"
  ```
- Watch-paths Guide = `src/app/guide/**`, `public/guide/**`. `$COOLIFY_TOKEN` — в memory `reference_coolify_token.md` (не в файлах репо).
- Превью инструкции: `?source=wb&preview=1` (рабочие кнопки) или `?source=wb&test=1` (кнопки инертны, без бота/админ-алертов). `source=wb` обязателен (требование Traefik).

## Что это за проект

**RobloxBank** — сервис выкупа Robux (внутриигровая валюта Roblox) у российских пользователей. Клиент получил карту Wildberries, на ней написан 7-символьный активационный код. Он вводит код → создаёт геймпасс на Roblox → менеджер выкупает геймпасс → клиент получает деньги.

Три канала работают как единая экосистема:
- **Сайт** (`robloxbank.ru/guide?source=wb`) — точка входа / инструкция
- **TG бот** (`@RobloxBankBot`) — основной рабочий канал
- **VK бот** (`vk.me/club237309399`) — альтернативный канал для VK-аудитории
- **TG канал** (`@Roblox_Bank_Tg`, ID: `-1003910127162`) — анонсы, акции, обновления
- **VK сообщество** (`vk.com/bankroblox`, ID: `237309399`) — стена для анонсов VK-аудитории

---

## Доступ к инфраструктуре

### Серверы

| Сервер | IP | Что на нём |
|--------|----|-----------|
| **RF (Москва)** | `89.110.94.117` | Coolify panel (`port 8000`), Next.js сайт, VK бот, Guide |
| **SG (Singapore)** | `5.223.95.11` | TG бот, Bridge сервер (`port 3000`) |

```bash
ssh root@89.110.94.117   # RF — Coolify, Web, VK bot
ssh root@5.223.95.11     # SG — TG bot, bridge
```

### Coolify

- Панель: `http://89.110.94.117:8000` (или `panel.robloxbank.ru`)
- API токен: создаётся в Coolify → Profile → API Tokens. Хранить в `$COOLIFY_TOKEN` (не в файлах!).
- Токен нужен с правами **Read + Write + Deploy**.

```bash
# Деплой любого сервиса (с локальной машины):
curl -s -X POST "http://89.110.94.117:8000/api/v1/deploy?uuid=<UUID>&force=true" \
  -H "Authorization: Bearer $COOLIFY_TOKEN"

# Статус деплоя:
curl -s "http://89.110.94.117:8000/api/v1/deployments/<deployment_uuid>" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" | jq '{status, commit_message}'
```

> **ВАЖНО:** Coolify настроен на **автодеплой по push в main**. Достаточно `git push origin main` — Coolify сам подхватывает изменения через GitHub webhook. **Не нужно** вручную вызывать API деплоя, вставлять записи в БД или что-либо ещё.

### UUID сервисов в Coolify

| Сервис | UUID | Сервер |
|--------|------|--------|
| RobloxBankWeb (сайт) | `z10ws7m1q45h281zwedmhei4` | RF |
| RobloxBank-Guide | `ebac6llpah5n2x58rb64yn8j` | RF |
| TG_bot | `lyz78enntugna9em1biopinr` | SG |
| VK_bot | `gmtpfqosgoz23vjyxyczuic9` | RF |

### Env vars (секреты)

Все секреты живут **только в Coolify** (env vars на каждом сервисе). В коде — никаких raw токенов.

| Переменная | Где | Что это |
|-----------|-----|---------|
| `TG_TOKEN` | TG_bot + VK_bot + RobloxBankWeb | Telegram bot token (`@RobloxBankBot`) |
| `VK_TOKEN` | VK_bot | VK community token |
| `DATABASE_URL` | Все сервисы | Neon Postgres (pooler) |
| `VALIDATOR_KEY` | TG_bot, VK_bot | Shared secret для bridge-сервера |
| `VALIDATOR_SOURCE_URL` | VK_bot | `http://5.223.95.11:3000` — bridge на SG |
| `ADMIN_IDS` | TG_bot | Telegram IDs через запятую |
| `WB_API_TOKEN` | TG_bot | Wildberries API токен |

**Ротация токенов:**
- TG токен: @BotFather → /mybots → выбрать бота → API Token → Revoke. После замены — обновить `TG_TOKEN` в Coolify на TG_bot **и** VK_bot (VK бот шлёт TG-уведомления).
- Coolify API токен: Coolify → Profile → API Tokens → удалить старый, создать новый. Только `$COOLIFY_TOKEN` в env, не в файлах.

---

## Стек

| Слой | Технология |
|------|-----------|
| Фронтенд | Next.js 16 (App Router), React 19, Tailwind 4, Framer Motion |
| Аутентификация | NextAuth v5 beta (CredentialsProvider: admin-login + vk-id) |
| БД | Neon Postgres + Prisma 7 (engineType=library, adapter=PrismaPg) |
| TG бот | Telegraf, запускается отдельным процессом (`bots/tg/bot.ts`) |
| VK бот | vk-io, запускается отдельным процессом (`bots/vk/bot.ts`) |
| Деплой | Coolify (каждый сервис — отдельный Docker-контейнер) |
| Bridge сервер | Singapore VPS — проксирует Roblox API и TG Bot API для обхода блокировок в России |

---

## Архитектура файлов

```
/
├── src/
│   ├── app/
│   │   ├── guide/GuideClient.tsx     ← весь UI коридора WB (2600 строк)
│   │   ├── api/wb-code/route.ts      ← резервирование/статус кода
│   │   ├── api/wb-link/route.ts      ← pre-claim при авторизации через сайт
│   │   └── api/twa/                  ← TWA (Telegram Web App) для WB-продавца
│   ├── auth.ts                       ← NextAuth config (admin + VK ID провайдеры)
│   ├── components/auth/VKAuthButton  ← кастомный VK OneTap виджет
│   └── lib/wb-session.ts             ← localStorage-сессия (denomination + code)
│
├── bots/
│   ├── shared/
│   │   ├── admin.ts                  ← карточки заказов/отзывов для TG-админов, CB constants
│   │   ├── db.ts                     ← Prisma-клиент для ботов (Pool=3)
│   │   ├── notify.ts                 ← tgSend / vkSend / tgSendPhoto
│   │   ├── roblox.ts                 ← валидация геймпасса (4 эндпоинта + bridge)
│   │   └── bridge.ts                 ← HTTP-сервер на Singapore VPS
│   ├── tg/
│   │   ├── handlers.ts               ← весь TG бот (1990 строк)
│   │   ├── session.ts                ← in-memory: pendingLink, pendingReview
│   │   └── admin/                    ← TG admin hub (orders, stats, WB, system, rates)
│   └── vk/
│       ├── handlers.ts               ← весь VK бот (1004 строки)
│       └── session.ts                ← in-memory VK сессии
│
└── prisma/schema.prisma              ← схема БД
```

**ВАЖНО:** `bots/` исключён из основного `tsconfig.json` (`"exclude": ["node_modules", "bots"]`). TypeScript **не проверяет** бот-файлы при `tsc --noEmit`. Ошибки в ботах видны только в рантайме. Всегда тестировать руками.

---

## Схема БД — ключевые таблицы

### WbCode
Физические коды на вкладышах WB-карточек.

| Поле | Значение |
|------|----------|
| `code` | 7 символов, уникальный |
| `denomination` | Номинал в R$ (300, 500, 800, 1000...) |
| `status` | `AVAILABLE → RESERVED → CLAIMED` |
| `sessionId` | Браузерная сессия при резервировании |
| `reservedUntil` | Время жизни резервации (+60 мин) |
| `isUsed` | false = provisional; true = заказ создан |
| `userId` | Привязывается при активации бота |
| `reviewBonusClaimed` | Бонус за отзыв уже начислен |

### WbOrder
Заявки на выкуп.

| Статус | Смысл |
|--------|-------|
| `AWAITING_GAMEPASS` | Provisional: код взят, ждём ссылку |
| `PENDING` | Ссылка принята, ждём менеджера |
| `IN_PROGRESS` | Менеджер работает |
| `COMPLETED` | Выплачено |
| `REJECTED` | Отклонено с причиной |

### User
- `tgId` — уникальный, Telegram numeric ID
- `vkId` — уникальный, VK numeric ID
- `balance` — бонусы (R$)
- `role` — `USER` / `ADMIN`

---

## Полный поток активации

### Сайт → TG (основной путь)

```
1. /guide?source=wb → WBIntro → WBGate (форма ввода кода)
2. Пользователь вводит 7-символьный код
3. Жмёт "Получить в Telegram":
   - POST /api/wb-code → код RESERVED (sessionId = getOrInitSessionId())
   - Редирект: t.me/RobloxBankBot?start=wbg_КОД_SESSIONID
4. TG бот /start:
   - upsert User по tgId
   - проверяет sessionId (перехватывает резерв если нужно)
   - гейт подписки (TG_CHANNEL_ID, опционально)
   - PROVISIONAL TRANSACTION:
       WbCode → CLAIMED, isUsed=false, userId=user.id
       WbOrder(status=AWAITING_GAMEPASS) создаётся
   - сообщает: цена геймпасса = ceil(denomination / 0.7) R$
   - даёт ссылку на инструкцию: /guide?source=wb&skip=1&code=КОД
5. Пользователь создаёт геймпасс на create.roblox.com
6. Отправляет URL или Asset ID в бот
7. Бот валидирует:
   - extractPassId() — парсит URL или чистый ID
   - checkSubscription() — повторная проверка подписки
   - getGamepassDetails() → 4 Roblox API эндпоинта последовательно
     (marketplace-items → catalog → economy → roproxy)
     + checkGamePrivate() для каждого
   - Если Roblox недоступен → принять с validationSkipped=true
   - Проверки: isActive, цена ≈ passPrice ±2 R$, isGamePrivate=false
8. ФИНАЛЬНАЯ ТРАНЗАКЦИЯ:
       WbCode.isUsed=true
       WbOrder.status=PENDING, gamepassUrl сохранён
9. Пользователь получает подтверждение + orderId
10. sendAdminOrderCard() → все ADMIN_IDS получают карточку в TG
11. Менеджер: ✅ ВЫКУПЛЕНО → COMPLETED → notifyUserCompleted()
    Или:      ❌ ОШИБКА → preset reason / custom → notifyUserRejected()
```

### Сайт → VK (альтернативный путь)

```
1. /guide?source=wb → WBGate
2. Жмёт "Получить ВКонтакте":
   - POST /api/wb-code → код RESERVED
   - setVkAuthCode("GD" + code) если guide mode, иначе code
   - setShowVkAuth(true) → рендерится VKAuthButton с wbCode prop
3. VKAuthButton (hidden OneTap + custom overlay):
   - VK OAuth handshake
   - LOGIN_SUCCESS: декодирует id_token → name, image
   - Разрешает wbCode: prop || ?code param || cookie wb_code
   - signIn("vk-id", { vk_id, name, image, wb_code })
4. auth.ts vk-id authorize():
   - rawWbCode из credentials.wb_code
   - Если "GD"+7chars → isGuideMode=true, strip prefix
   - upsert User по vkId
   - LINK: wbCode.findUnique(code) → wbCode.update(userId, CLAIMED, isUsed=false)
   - TG уведомление "📥 КОД АКТИВИРОВАН (сайт → VK)" с denomination
5. Редирект: vk.me/club237309399?ref=КОД (или GD+КОД)
6. VK бот handleRefActivation():
   - Те же шаги что TG (upsert user, provisional order, etc.)
   - Если GD-prefix → isGuideMode → отдельное приветствие с инструкцией
7. Дальше аналогично TG потоку
```

### Прямой ввод в бот (без сайта)

```
TG: пользователь пишет 7-символьный текст в чат
    → handleTextEntry() → те же шаги начиная с provisional transaction

VK: аналогично, handleText() → handleRefActivation()
```

---

## Восстановление сессии

### Сайт (GuideClient.tsx)
`useEffect` при монтировании:
1. `loadWBSession()` из localStorage (denomination + code)
2. `?code=` URL параметр (из ссылки от бота)
3. `GET /api/wb-code?code=КОД` → если `claimed=true` → показать фазу "instruction"

Сессия восстанавливается даже в Telegram WebView (изолированный localStorage → URL param).

### TG бот
При любом тексте: проверяет `WbOrder.status=AWAITING_GAMEPASS` для `tgId`.
Восстанавливает `pendingLink` if found.

### VK бот
`tryRestoreState()`: ищет `WbCode(userId, no order)` → `WbOrder(AWAITING_GAMEPASS)` → `WbOrder(REJECTED)`.

---

## Уведомления — кто что когда получает

### Пользователь

| Триггер | Сообщение |
|---------|-----------|
| Provisional order создан (TG) | Приветствие + цена геймпасса + инструкция |
| Provisional order создан (VK) | То же + guide mode ответвление |
| Геймпасс принят → PENDING | "Заявка принята, заказ #XXXX" |
| COMPLETED | "Выплачено! Заказ #XXXX на сумма R$" + CTA отзыв |
| REJECTED | Причина + кнопка "Исправить ссылку" (если resubmit) |
| review_ok | "+100 R$ начислено!" + CTA "Заказать ещё" |

### Администраторы (TG)

| Триггер | Сообщение |
|---------|-----------|
| Provisional order (TG/VK) | `sendAdminOrderCard()` — с кнопками [✅ ВЫКУПЛЕНО] [❌ ОШИБКА] |
| auth.ts VK login with code | `📥 КОД АКТИВИРОВАН (сайт → VK)` с denomination |
| auth.ts VK login without code | `🆕 Новый пользователь` или `🔑 Вход` |
| Gamepass validation fail | Alert: тип ошибки + ссылка + юзер |
| Support button pressed | `🆘 ОБРАЩЕНИЕ В ПОДДЕРЖКУ` с контекстом |
| Review photo received | `sendAdminReviewCard()` — фото + [🎁 +100 R$] [❌ Отклонить] |

---

## Callback architecture (admin TG бот)

Все callback_data константы в `bots/shared/admin.ts`, объект `CB`.

**Лимит Telegram: 64 байта на callback_data.** CUID ≈ 25 символов.

Ключевые колбэки:
- `admin_ok:{orderId}` → COMPLETED
- `admin_reject_init:{orderId}` → показывает preset reasons
- `ord_rr:{orderId}:{key}` → применить preset причину
- `ord_rr_txt:{orderId}` → режим ввода своей причины
- `confirm_reject:{orderId}` / `cancel_reject:{orderId}` → safety confirmation
- `review_ok:{orderId}:{userId}` → +100 R$ бонус
- `review_no:{orderId}:{userId}` → показывает preset review rejection reasons
- `rr:{orderId}:{userId}:{key}` → применить preset причину отклонения отзыва
- `crn:{orderId}:{userId}` / `xrn:{orderId}:{userId}` → подтверждение отклонения отзыва
- `user_resubmit:{orderId}:{userId}` → пользователь исправляет ссылку (REJECTED → режим ожидания)
- `refresh_status` → обновить карточку статуса (TG пользователь)

---

## Валидация геймпасса (roblox.ts)

4 эндпоинта в порядке приоритета:
1. `apis.roblox.com/marketplace-items/v1/items/details` (POST, основной)
2. `catalog.roblox.com/v1/catalog/items/details` (POST)
3. `economy.roblox.com/v1/game-passes/{id}/details` (GET)
4. `apis.roproxy.com/game-passes/v1/game-passes/{id}/product-info` (GET, зеркало)

+ `checkGamePrivate()`: резолвит universeId → проверяет `isPlayable` / `playabilityStatus`.

**Bridge (`bots/shared/bridge.ts`):**
- Singapore сервер. `VALIDATOR_SOURCE_URL` → все запросы Roblox/TG идут через него.
- Endpoints: `GET /check-pass`, `POST /tg-proxy`
- Auth: `x-validator-key` header
- Причина: Roblox API и api.telegram.org заблокированы в России с DC IP.

---

## Env переменные — полный список

### Сайт (Next.js / Coolify)
```
DATABASE_URL              # Neon pooled endpoint
NEXTAUTH_URL              # https://robloxbank.ru
AUTH_SECRET               # или NEXTAUTH_SECRET (legacy)
NEXT_PUBLIC_APP_URL       # https://robloxbank.ru
NEXT_PUBLIC_VK_APP_ID     # 54539012 (VK ID приложение для OAuth)
TG_TOKEN                  # Токен TG бота (для уведомлений из auth.ts)
TG_CHAT_ID                # Telegram chat ID(s) через запятую
ADMIN_IDS                 # Comma-separated TG user IDs (если отдельно от TG_CHAT_ID)
ADMIN_SECRET              # Для внутренних API (регистрация)
TINKOFF_SECRET_KEY        # Эквайринг Tinkoff
WB_API_TOKEN              # WB API для TWA дашборда
LOCAL_BOT_URL             # X280 автоматизация (FastAPI)
INTERNAL_WEBHOOK_SECRET   # Токен для /api/bot/* вебхуков
BOT_API_TOKEN             # Токен бота для /api/bot/* вебхуков
```

### TG бот (отдельный Coolify сервис)
```
DATABASE_URL              # Тот же Neon (прямой endpoint, не pooled)
TG_TOKEN                  # Telegraf токен
TG_CHANNEL_ID             # Канал подписки (опционально)
ADMIN_IDS                 # TG user IDs через запятую
VALIDATOR_SOURCE_URL      # Singapore bridge URL
VALIDATOR_KEY             # Shared secret для bridge
HETZNER_API_TOKEN         # Hetzner Cloud API token (read-only) — для мониторинга сервера
VDSINA_EMAIL              # Email от cp.vdsina.ru — для проверки баланса
VDSINA_PASSWORD           # Пароль от cp.vdsina.ru
VDSINA_LOW_BALANCE        # Порог алерта в ₽ (default: 500)
```

### VK бот (отдельный Coolify сервис)
```
DATABASE_URL              # Тот же Neon
VK_TOKEN                  # Community token (messages.send)
VK_GROUP_ID               # Числовой ID группы ВК
ADMIN_IDS                 # TG user IDs (уведомления идут в TG)
VALIDATOR_SOURCE_URL      # Singapore bridge URL
VALIDATOR_KEY             # Shared secret
TG_TOKEN                  # Для отправки уведомлений через bridge
```

### Bridge (Singapore сервис)
```
VALIDATOR_KEY             # Тот же ключ что в ботах
VALIDATOR_PORT            # Порт (default 3000)
```

---

## Важные соглашения кодовой базы

### Provisional order pattern
Код всегда берётся и заказ создаётся **до** проверки подписки и **до** ввода геймпасса. Это значит, что у нас всегда есть `userId` и `platform` для любого активированного кода. Контактные данные гарантированно сохраняются.

### Prisma casting
`(db as any).wbCode`, `(db as any).wbOrder` — потому что `WbCode` и `WbOrder` модели добавлены позже, генератор Prisma иногда отстаёт. `src/types/prisma-wb.d.ts` содержит типы, но боты используют `any` cast для надёжности.

### bots/ excluded from tsconfig
Любое изменение в бот-файлах НЕ проверяется `tsc --noEmit`. Проверяй руками или запускай `tsx` в режиме `--check`.

### ADMIN_IDS vs TG_CHAT_ID
- `ADMIN_IDS` — кому слать карточки заказов/отзывов (TG юзер IDs)
- `TG_CHAT_ID` — для уведомлений из `src/auth.ts` (NextJS side, не боты)
- В `bots/shared/admin.ts`: `ADMIN_IDS = process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID`

### Telegram callback_data лимит 64 байта
CUID ≈ 25 символов. `orderId + userId` в одном callback = 50+ символов. Поэтому:
- `confirm_rev_no:` → `crn:`
- `cancel_rev_no:` → `xrn:`
- `rev_reason:` → `rr:`
Всегда считать длину при добавлении новых колбэков.

### VK уведомления идут через TG
VK бот сам не имеет интерфейса для уведомлений менеджерам. Все admin карточки (provisional order, review) уходят через `bots/shared/admin.ts` → `tgSend()` → ADMIN_IDS в Telegram. Если нужен routing через bridge (Россия) — `VALIDATOR_SOURCE_URL` задан и `notify.ts` автоматически уходит через `/tg-proxy`.

---

## Что можно улучшить (backlog)

- ✅ ~~**Инструкция по публичности плейса**~~ — сделано в сессии 2026-05-22/23 (PublicGameBlock на сайте, pass_private в TG/VK ботах)
- [ ] **Web push уведомления** когда менеджер выкупил — пользователь не всегда смотрит в бот
- [ ] **Статус-страница** на сайте: `/status?code=КОД` — проверить свой заказ без бота
- [ ] **Webhook retry** для Tinkoff (сейчас если вебхук упал — статус не обновится)
- [ ] **Автоматический resubmit таймаут** — напомнить пользователю если REJECTED и он не реагировал 24ч
- [ ] **Rate limiting** на `/api/wb-code` — сейчас можно брутфорсить коды
- [ ] **TypeScript в ботах** — добавить бот-папки в tsconfig или создать отдельный `tsconfig.bots.json` и гонять его в CI
- [ ] **E2E тесты** — хотя бы минимальный хэппи-пасс (Playwright или Puppeteer)

---

## Как запускать локально

```bash
# 1. Зависимости
npm install

# 2. Сайт
npm run dev

# 3. TG бот (в отдельном терминале)
npm run bot:tg

# 4. VK бот
npm run bot:vk

# 5. Сбросить тестовый код (AVAILABLE)
npm run dev:reset-test
```

`.env.local` должен содержать все переменные из `.env.example` + бот-переменные.

---
