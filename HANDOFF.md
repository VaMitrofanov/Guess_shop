# RobloxBank — Project Handoff

> Передавай этот файл в каждую новую сессию Claude. Он содержит всё, что нужно, чтобы быстро войти в контекст, не читая тысячи строк кода.

---

## Что это за проект

**RobloxBank** — сервис выкупа Robux (внутриигровая валюта Roblox) у российских пользователей. Клиент получил карту Wildberries, на ней написан 7-символьный активационный код. Он вводит код → создаёт геймпасс на Roblox → менеджер выкупает геймпасс → клиент получает деньги.

Три канала работают как единая экосистема:
- **Сайт** (`robloxbank.ru/guide?source=wb`) — точка входа / инструкция
- **TG бот** (`@RobloxBankBot`) — основной рабочий канал
- **VK бот** (`vk.me/club237309399`) — альтернативный канал для VK-аудитории

---

## Доступ к инфраструктуре

Claude (в рамках сессии) имеет доступ ко всему:

| Ресурс | Что это |
|--------|---------|
| **SSH RF** | Основной сервер (Москва, 89.110.94.117) — Next.js сайт + TG/VK боты |
| **SSH SG** | Singapore VPS — bridge сервер (Roblox API + TG Bot API прокси) |
| **Coolify token** | Панель управления деплоем, env vars, логи контейнеров |

Команды для CLI-работы в сессии:
```bash
# Подключение к серверам
! ssh root@89.110.94.117      # RF
! ssh root@<SG_IP>            # SG

# Coolify API
! curl -H "Authorization: Bearer $COOLIFY_TOKEN" https://coolify.robloxbank.ru/api/v1/...
```

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

## Известные баги — исправленные

### 1. `SUPPORT_URL` undefined → CRITICAL runtime crash
**Файл:** `bots/tg/handlers.ts`  
**Проблема:** переменная использовалась в 3 местах, но не была объявлена. `bots/` исключён из tsconfig → TypeScript не замечал.  
**Исправление:** добавлена константа в начале файла:
```typescript
const SUPPORT_URL = "https://t.me/RobloxBank_PA";
```
**Коммит:** `ffdda78`

---

### 2. Guide mode VK: код не линкуется (auth.ts)
**Файл:** `src/auth.ts`  
**Проблема:** при VK guide mode VKAuthButton передаёт `wb_code = "GDABC1234"` (9 символов). Проверка `wbCode.length === 7` не проходила → код оставался `RESERVED` без `userId`. Если VK бот не получал ref — код зависал навсегда.  
**Исправление:**
```typescript
const rawWbCode = (credentials.wb_code as string)?.trim().toUpperCase() ?? "";
const wbCode = rawWbCode.startsWith("GD") && rawWbCode.length === 9
  ? rawWbCode.slice(2)
  : rawWbCode;
const isGuideMode = rawWbCode.startsWith("GD") && rawWbCode.length === 9;
```
**Коммит:** `6ad4b3e`

---

### 3. Denomination всегда 0 в TG уведомлении (auth.ts)
**Файл:** `src/auth.ts`  
**Проблема:** попытка читать `(user as any).wbCodes?.[0]?.denomination` — user получен через `prisma.user.findUnique` без `include`. Поле всегда undefined. Уведомление показывало "Геймпасс: 0 R$".  
**Исправление:** отдельный `prisma.wbCode.findUnique({ where: { code: wbCode } })` перед update:
```typescript
wbCodeRecord = await (prisma as any).wbCode.findUnique({ where: { code: wbCode } });
const denomination = wbCodeRecord?.denomination ?? 0;
```
**Коммит:** `6ad4b3e`

---

### 4. Двойное уведомление (auth.ts + VK бот)
**Файл:** `src/auth.ts`  
**Проблема:** auth.ts слал неполную/пустую карточку + VK бот слал полную карточку. Два сообщения для одного события.  
**Исправление:** auth.ts теперь шлёт `📥 КОД АКТИВИРОВАН (сайт → VK)` — сигнал "лид захвачен, переходит в бот". VK бот шлёт `📦 ЗАКАЗ #XXXX` — сигнал "бот принял, ждём геймпасс". Разные события, разные заголовки.  
**Коммит:** `6ad4b3e`

---

### 5. Dead code `onSuccess` в WBGate
**Файл:** `src/app/guide/GuideClient.tsx`  
**Проблема:** `WBGate` принимал `onSuccess: (denomination, code) => void` но никогда не вызывал его. WBGate перенаправляет в бот через `window.location.href`. Фаза "instruction" открывалась только через `useEffect` session restore. `freshFromGate` всегда был `false`, анимация `InstructionRevealCurtain` никогда не срабатывала.  
**Исправление:** удалены `WBGateProps` интерфейс, `{ onSuccess }` из сигнатуры, пропс из JSX, стейт `freshFromGate`, ветка `InstructionRevealCurtain`, импорт.  
**Коммит:** `6ad4b3e`

---

### 6. Private gamepass не определялся
**Файл:** `bots/shared/roblox.ts`  
**Проблема:** геймпасс в закрытой игре → Roblox API возвращал данные, но пользователь не мог его выкупить. Бот не проверял приватность.  
**Исправление:** `checkGamePrivate()` через universes API + games API. Флаг `isGamePrivate` добавлен в `GamepassDetails`. Боты показывают ошибку `pass_private`.  
**Коммит:** в ранних фиксах

---

### 7. Провальная сессия VK бота при рестарте
**Файл:** `bots/vk/handlers.ts`  
**Проблема:** при рестарте бота in-memory `session Map` очищался. VK пользователь в состоянии `AWAITING_LINK` после рестарта получал "Код не найден" или ошибку.  
**Исправление:** `tryRestoreState()` ищет в DB `WbCode(userId, нет заказа)`, `WbOrder(AWAITING_GAMEPASS)`, `WbOrder(REJECTED)`. Аналогично в TG — восстанавливается при любом тексте.  
**Коммит:** в ранних фиксах

---

## Текущее состояние (2026-05-21 — после аудита)

### Что работает
- ✅ Полный поток Сайт → TG бот (код → геймпасс → выкуп → уведомление)
- ✅ Полный поток Сайт → VK бот (OAuth → code link → ref → геймпасс → выкуп)
- ✅ Прямой ввод кода в TG / VK чат
- ✅ Guide mode (GD-prefix) через оба бота
- ✅ Восстановление сессии: сайт (localStorage + URL param), TG (DB lookup), VK (DB lookup)
- ✅ Rejection flow: preset reasons + custom + user resubmit
- ✅ Review flow: AWAITING_REVIEW → фото → +100 R$ / отклонение с preset reasons
- ✅ Loyalty badges: повторный клиент / VIP (5+ заказов)
- ✅ Subscription gate (TG_CHANNEL_ID, опционально)
- ✅ Bridge для Roblox API + TG API через Singapore
- ✅ Admin hub: Orders, Stats, WB, System, Rates, AutoBuy
- ✅ TWA дашборд для WB-продавца (Wildberries API интеграция)
- ✅ Уведомления о поддержке: любой тупик → кнопка → alert в ADMIN_IDS
- ✅ validationSkipped: если Roblox недоступен — принять с предупреждением
- ✅ Denomination и passPrice в уведомлениях (auth.ts, TG provisional, VK provisional)
- ✅ Мониторинг серверов в System Hub: Hetzner (статус, €/мес) + VDSina (баланс ₽, алерт при < 500₽)

### Что не тестировалось в последнее время
- ⚠️ Tinkoff эквайринг (в коде есть, но WB флоу не использует)
- ⚠️ Telegram WebApp (TWA) для WB-продавца — это отдельная фича для хозяина бизнеса
- ⚠️ AutoBuy hub — backend есть, бизнес-логика авто-выкупа не ясна

### Аудит 2026-05-21 — что исправлено
Проведён полный code audit. Найдено и закрыто:
- 🔴 **P0-A**: `review_ok` двойной бонус — обёрнут в `$transaction` с idempotency guard (`reviewBonusClaimed: false`)
- 🔴 **P0-B**: `review_ok` помечал ВСЕ коды юзера — теперь scope по `order.wbCode` конкретного заказа
- 🟠 **P1-A**: Guide mode терялся в VK-потоке — `is_guide_mode` добавлен в JWT, `wb-link` строит `GD{code}` ref
- 🟠 **P1-C**: CLAIMED+isUsed=false возвращал 409 без подсказки — отдельный error code `BOT_CLAIMED` с текстом "продолжай в боте"
- 🟠 **P1-D**: `tryRestoreState` восстанавливала стейл REJECTED заказы без ограничений — добавлен фильтр `updatedAt >= 30 days ago`
- 🟠 **P1-G**: `WbCode` не имела `updatedAt` — добавлено поле + миграция `20260521_add_wbcode_updated_at`
- 🟡 **P2-B**: Bridge без `VALIDATOR_KEY` молча работал — теперь `console.error` с *** SECURITY *** текстом
- 🟡 **P2-D**: `ADMIN_IDS` не проверялся при старте — добавлен startup warning в `bots/tg/bot.ts`
- 🟢 **P3-E**: Удалены все `[DB DEBUG]` console.log из `bots/shared/db.ts` (срабатывали на каждое сообщение)

### Что осталось (backlog после аудита)
- [ ] **P1-B**: `WBManagerBlock` в GuideClient всегда посылает `wb_` prefix вместо `wbg_` — не критично (юзеры в гайд-режиме уже активированы через WBGate)
- [ ] **P2-C**: `wb_code` в cookie без `HttpOnly` — XSS риск, требует серверного endpoint
- [ ] **P1-E**: GET `/api/wb-code` отдаёт denomination без auth — rate limiting + sessionId check
- [ ] **P1-F**: Двойное уведомление site→VK (auth.ts + VK бот) — два разных события, но может путать
- [ ] **P3-F**: `extractPassId` продублирован в TG и VK ботах — перенести в `bots/shared/`

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

## Последние коммиты (от новых к старым)

```
bc1c7df fix(critical): P0/P1 crash fixes from ultra-review audit
8cf1f83 feat(tg/admin): add REJECTED orders view to TG admin hub
429acf5 fix(bots): correct Roblox game privacy path in all instruction texts
6ad4b3e fix(auth,guide): VK guide-mode bugs + remove dead onSuccess gate prop
ffdda78 fix(bots): patch runtime crash, complete hand-holding funnel  
752bd5d polish(ux): Apple-level ecosystem UX — consistent tone, terminology
c33aa06 fix(bots): pass_private ctxKey for TG, add DB fallback for VK support handler
93d1785 feat(bots): support button sends admin alert with scenario context
```

---

*Обновляй этот файл после каждой значимой сессии.*

---

## Текущий деплой (2026-05-21)

| Сервис | Сервер | Commit | Статус |
|--------|--------|--------|--------|
| Next.js сайт | RF 89.110.94.117 | `bc1c7df` | ✅ |
| Guide (отдельный сервис) | RF 89.110.94.117 | `bc1c7df` | ✅ |
| VK бот | RF 89.110.94.117 | `bc1c7df` | ✅ |
| TG бот | SG 5.223.95.11 | `db56f8e` | ✅ |

**Auto-deploy сломан:** RF-сервер не может достучаться до `api.github.com` (Russian IP block). Coolify ставит `is_auto_deploy_enabled = true`, но вебхук не срабатывает (timeout на GitHub API). Деплой только вручную через Coolify UI или API.

**Coolify API доступ:** токен ID=16 создан через DB (SHA-256 хэш). Формат: `16|<raw_token>`. Вызов только с RF-сервера через `http://localhost:8000/api/v1/`. UUID TG-бота: `lyz78enntugna9em1biopinr`. Deploy endpoint: `POST /api/v1/deploy?uuid=lyz78enntugna9em1biopinr`.

**DB состояние (на момент аудита):** 3 COMPLETED / 2 REJECTED заказа, 995 AVAILABLE кодов, 9 TG-пользователей.  
**4 зависших RESERVED кода** (`1FS0SNA`, `66PXO05`, `UITRVG1`, `QP7HC6J`) — нет фонового cleanup job, истёкли TTL. Нужно либо cron-задача, либо авто-релиз в `/api/wb-code` при истёкшем `reservedUntil`.

---

## Ultra-review 2026-05-21 — полные находки

### Что исправлено в этой сессии (коммит bc1c7df)

| Файл | Серьёзность | Проблема | Исправление |
|------|------------|---------|------------|
| `notify.ts` tgSend | **P1** | `fetch` к bridge без try/catch — сетевая ошибка = unhandled rejection | Обёрнуто в try/catch, warn в лог, возвращает `{}` |
| `notify.ts` vkSend | **P1** | Нет try/catch — ошибка VK API падала наружу | try/catch + warn в лог |
| `handlers.ts` admin_ok | **P1** | `order` после `findUnique` может быть `null` — `order.userId` краш | Null guard + try/catch вокруг всего блока |
| `hub-orders.ts` confirmBatchFulfill | **P1** | Нет try/catch — DB ошибка = нет answerCbQuery, бесконечный спиннер | try/catch + fallback answerCbQuery |
| `wb-code/route.ts` | **P0** | Проверка `length < 7` — коды длиннее 7 символов проходили валидацию | `length !== 7` + alphanumeric regex |
| `hub-orders.ts` кнопка | **P2** | Лейбл "Отклонённые (N)" показывал сегодняшний счётчик, а вью показывал все заказы за всё время | Убрали счётчик из лейбла |

### Открытые находки (backlog)

**P1 — Next.js сайт**
- `VKAuthButton.tsx:137-143`: `wb_code` из `?code=` URL-параметра — атакующий может подменить чужой код, подставив его в ссылку. Fix: доверять только `wbCodeProp` (prop) или cookie, не query param.
- `auth.ts:141-145` + `wb-link/route.ts:37-41`: нет проверки `status` перед `update` CLAIMED кода — второй логин может перезаписать `userId` активированного кода. Fix: `where: { status: { not: "CLAIMED" } }`.
- `GuideClient.tsx:1760`: cookie `wb_code` без флага `Secure` — на HTTP-соединении уходит открытым текстом. Fix: добавить `; Secure`.

**P1 — TG бот**
- `handlers.ts:2624-2626`: `answerCbQuery` может не вызваться при throw в `ord_rr` ветке (performAdminReject вызывается до answerCbQuery). Fix: вызывать answerCbQuery перед performAdminReject или в finally.

**P2 — Next.js сайт**
- `wb-code/route.ts:60-65`: живая резервация переносится на любую сессию, знающую код (намеренный UX-выбор, но риск угона). Рассмотреть grace period / rate limiting.
- `GuideClient.tsx / wb-code/route.ts`: BOT_CLAIMED возвращает 409, но сайт не переключает фазу на "instruction" — пользователь застревает на форме. Fix: вернуть `ok: true` с флагом `botClaimed: true`, перейти в фазу instruction.
- `WBGate` не передаёт `onSuccess` callback в `GuideClient` — после успешного ввода кода родитель не узнаёт denomination/code. Fix: `onSuccess(denomination, code)` callback prop.
- `roblox.ts:258`: `strictOnUnavailable: false` на первичных эндпоинтах — таймаут/503 принимается как "validation skipped", а не как ошибка недоступности.

**P3**
- `admin/index.ts:341-343`: `nmID` в `wb_ue:{id}` парсится но не передаётся в `showUnitEconHub` — мёртвый код.
- `vk/handlers.ts:529`: spinner-сообщение никогда не удаляется при ошибке.
- `wb-code/route.ts:11`: `sessionId` не валидируется — можно перебирать коды с однобайтными sId.

---

## Известные баги — исправленные (сессия 2026-05-21)

### 8. review_ok двойной бонус + все коды юзера
**Файл:** `bots/tg/handlers.ts` (callback `review_ok:`)  
**Проблема 1:** два admin-а нажимали кнопку одновременно → два `user.update({ balance: increment(100) })` → +200 R$ вместо +100.  
**Проблема 2:** `wbCode.updateMany({ where: { userId, reviewBonusClaimed: false } })` — помечал ВСЕ незаявленные коды пользователя, а не только код конкретного заказа.  
**Исправление:** обёрнуто в `$transaction` с условием `{ code: order.wbCode, reviewBonusClaimed: false }`. Если `count === 0` — бонус уже начислен, возвращаем early с `answerCbQuery`.

---

### 9. Guide mode терялся в VK-потоке (site → VK)
**Файлы:** `src/auth.ts`, `src/app/api/wb-link/route.ts`  
**Проблема:** `auth.ts` сохранял в JWT только `wb_code` (7 символов, без `GD` префикса). `wb-link` строил редирект `?ref={7-char}`. VK бот получал обычный ref, `isGuideMode = false`, инструкция гайд-режима никогда не отправлялась.  
**Исправление:** добавлен `is_guide_mode` флаг в JWT и session. `wb-link` строит `?ref=GD{code}` когда `is_guide_mode === true`.

---

### 10. `tryRestoreState` поднимала стейл заказы без временного ограничения
**Файл:** `bots/vk/handlers.ts`  
**Проблема:** пользователь с REJECTED заказом полугодовой давности при следующем сообщении получал предложение "исправить ссылку" — на геймпасс, которого уже нет.  
**Исправление:** добавлен фильтр `updatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }`.

---

### 11. CLAIMED код возвращал 409 без объяснения
**Файл:** `src/app/api/wb-code/route.ts`  
**Проблема:** после provisional activation в боте (CLAIMED + isUsed=false), если пользователь возвращался на сайт и вводил тот же код — получал "Этот код уже был активирован ранее." без подсказки что делать.  
**Исправление:** отдельная ветка с `code: "BOT_CLAIMED"` и текстом "Код уже активирован — продолжай в боте (Telegram или ВКонтакте)."

---

### 12. Debug console.log в production
**Файл:** `bots/shared/db.ts`  
**Проблема:** 3 строки `[DB DEBUG]` срабатывали на КАЖДОЕ входящее сообщение, засоряя логи в Coolify.  
**Исправление:** удалены, оставлен только `console.error` при реальных сбоях.

---

### 13. Bridge без VALIDATOR_KEY молча работал
**Файл:** `bots/shared/bridge.ts`  
**Проблема:** при отсутствии `VALIDATOR_KEY` сервер стартовал без защиты, логировал только `warn`. Любой знающий IP мог слать Telegram-сообщения или запрашивать геймпассы.  
**Исправление:** уровень изменён на `console.error` с явным `*** SECURITY ***` текстом.

---

### 14. ADMIN_IDS не проверялся при старте TG бота
**Файл:** `bots/tg/bot.ts`  
**Проблема:** при пустом `ADMIN_IDS` любой Telegram-пользователь мог нажать кнопки заказов в пересланных сообщениях.  
**Исправление:** startup `console.error` с `*** SECURITY ***` если оба переменных (`ADMIN_IDS`, `TG_CHAT_ID`) не заданы.

---

### 15. `WbCode` не имела поля `updatedAt`
**Файл:** `prisma/schema.prisma`  
**Проблема:** нет audit trail для переходов AVAILABLE → RESERVED → CLAIMED. Поиск по `updatedAt` в `tryRestoreState` был невозможен.  
**Исправление:** добавлено `updatedAt DateTime @updatedAt` + миграция `20260521_add_wbcode_updated_at`.
