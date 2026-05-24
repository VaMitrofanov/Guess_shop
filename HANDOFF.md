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

### Сессия 2026-05-21 (вечер) — боевые баги по реальному кейсу

Реальный кейс: Мила Платонова (VK), код WKDQAE1, геймпасс ID `1850867407` ("Ква", 429 R$, игра "Obby 1").

- 🔴 **`ctx.vk` undefined** — `isVkSubscribed` падал с TypeError на каждом входящем сообщении с геймпассом. Бот вообще не доходил до проверки Roblox. Причина: vk-io не прокидывает VK instance в `ctx`. Фикс: `initVkHandlers(vk)` в `bot.ts`, `_vkApi` singleton в `handlers.ts`. **Коммит: `c9544d4`**
- 🔴 **Catalog asset вместо геймпасса** — Roblox числовые ID общие между catalog (одежда) и gamepasses. Endpoint 2 запрашивал `itemType: "Asset"` → находил clothing "Black and Gold Jacket" с тем же ID → возвращал его (`isActive: false`, `price: 5`). Фикс: `itemType: "GamePass"` в endpoint 2 + guard в `parseItem` (отвергать если `itemType != "GamePass"`). **Коммит: `45c3aae`**, деплой на Singapore вручную (файл скопирован в контейнер).
- 🟠 **`isGamePrivate` ложные срабатывания** — геймпасс в "dummy" приватной игре (Obby 1) всё равно продаётся в маркетплейсе (`isActive: true`). Бот блокировал его с ошибкой "закрытая игра". Новая логика: `isGamePrivate` блокирует только когда `!isActive`. Если `isActive: true` — принять независимо от статуса игры. **Коммит: `b2d4e98`**
- 🟡 **"ПОВТОРНЫЙ КЛИЕНТ" для первого заказа** — provisional order (`AWAITING_GAMEPASS`) создаётся до ввода геймпасса. `previousOrderCount` считал его → первый клиент получал бейдж "ПОВТОРНЫЙ". Фикс: исключить `AWAITING_GAMEPASS` из счётчика. **Коммит: `7165440`**

**⚠️ Coolify auto-deploy сломан для GitHub на RF** (Russian IP block). TG/VK боты обновляются вручную: `scp file root@server:/tmp/ && docker cp /tmp/file container:/app/path && docker restart container`. Последний задеплоенный код — коммит `7165440` (handlers.ts скопирован в оба контейнера напрямую).

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

## Сессия 2026-05-22/23 — PublicGameBlock + аудит анимаций

### Что сделано

**Сайт (GuideClient.tsx):**
- Добавлен `PublicGameBlock` — коллапсируемый блок "Игра должна быть Public" под шагом 02. Включает:
  - Новая code-анимация `AnimPublicBadge`: сетка Creations, курсор движется к карточке, значок Public подсвечивается и увеличивается, затем курсор отходит чтобы открыть badge
  - Скриншот `public-configure.jpg` с зелёным highlight-прямоугольником вокруг кнопки Public
  - Вложенный коллапс "Всё ещё не Public?" → slideshow из 3 скриншотов через Questionnaire
- Добавлены скриншоты в `public/guide/`: `public-badge.jpg`, `public-configure.jpg`, `public-settings.jpg`, `public-questionnaire.png`, `public-questionnaire-success.png`
- Исправлен TypeScript build: `scratch/` добавлен в `tsconfig.json` exclude

**Боты (pass_private ветка):**
- `bots/tg/handlers.ts`: в ветке `pass_private` добавлена пошаговая инструкция (Configure → Settings → Audience → Public), шаг через Questionnaire, кнопка "📖 Полная инструкция" со ссылкой на `/guide?source=wb&skip=1&code=...`
- `bots/vk/handlers.ts`: аналогично + ссылка на гайд текстом

**Аудит и фикс анимаций (коммит `aa00ed4`):**
- `Anim01`: курсор теперь виден на всех 4 кадрах (был скрыт во время загрузки); правильные позиции
- `Anim02`: курсор движется к карточке игры на f=1 (был freeze 3.4с); модалка появляется через AnimatePresence fade вместо резкого pop-in
- `AnimPublicBadge`: 5 кадров → 4 (убран дублирующий f=4 = 2.6с freeze); курсор уходит на f=3 чтобы открыть badge
- `Anim04Price`: цена набирается посимвольно (f=3: первые 2 цифры, f=4: полностью); toggle-контент скрывается через AnimatePresence вместо flash
- `Anim05WB`: URL всегда `roblox.com/game-pass/...` (был mismatch с `create.roblox.com`); 4 позиции курсора; курсор виден на f=3
- `Anim06WB`: сообщения менеджера (f=3, f=4) появляются через `motion.div` с slide+fade
- `Anim05ID`: контекстное меню scale+fade через AnimatePresence

**Инфраструктура:**
- Обнаружен реальный IP сервера RF: `89.110.94.117` (не `77.222.43.19`)
- Создан новый Coolify API токен ID=18 (предыдущий ID=16 был нечитаем из DB)
- Coolify deploy требует `force=true` из-за Russian IP block на api.github.com

---

## Текущий деплой (2026-05-24, вечер)

| Сервис | Сервер | Commit | Статус |
|--------|--------|--------|--------|
| Next.js сайт | RF `89.110.94.117` | `7ee10e9` | ✅ running:healthy |
| Guide микросервис | RF `89.110.94.117` | `4c3bd4c` | ✅ running:healthy |
| VK бот | RF `89.110.94.117` | `3e485a3` | ✅ running |
| TG бот | SG `5.223.95.11` | `c6e5b90` | ✅ running |

---

## Сессия 2026-05-24 — Прямые заказы + Review Reminders

### Контекст задачи

⚠️ **ГЛАВНОЕ ПРАВИЛО: существующий WB-флоу не трогаем и не ломаем.**
Весь код пути WB-карточка → геймпасс → выкуп → уведомление остаётся в точности как есть.
Прямые заказы — **чисто аддитивное расширение**: новые команды, новые поля, новая ветка в text handler. Ни одна строка существующей логики не переписывается.

Вводится два изменения:
1. **Прямой заказ** — пользователь может купить Robux в боте **без WB-карточки**. Полезно для повторных клиентов, которые уже знают процесс. Воронка: review_ok бонус → 30-дневный дедлайн → CTA "купить напрямую".
2. **Review bonus reminders** — бонус 100 R$ сгорает через 30 дней. Бот шлёт напоминания раз в неделю (дни 7, 14, 21) и финальное за 3 дня до конца (день 27).

---

### Схема БД — изменения

#### WbOrder — новое поле
```prisma
isDirectOrder Boolean @default(false)
```
Синтетический WB-код вида `DIR-XXXXXXXX` (8 заглавных alphanum) генерируется при создании прямого заказа и сохраняется в существующем поле `wbCode`. Это позволяет не делать `wbCode` nullable и не трогать ни одну существующую логику поиска заказов.

**Почему синтетический код, а не nullable wbCode:**
- `wbCode @unique` используется в ~15 местах (gamepass handler, user_resubmit callback, order cards)
- `findFirst({ where: { wbCode: "DIR-..." } })` работает так же
- Реальные WB коды — ровно 7 алфанум. `DIR-` + 8 символов = 12 символов → не пересечётся никогда

#### User — новые поля
```prisma
reviewBonusGrantedAt  DateTime?
reviewReminderLevel   Int       @default(0)
```
- `reviewBonusGrantedAt` — когда был начислен бонус (устанавливается при `review_ok`)
- `reviewReminderLevel` — какие напоминания уже отправлены (0=нет, 1=день7, 2=день14, 3=день21, 4=день27)

Миграция: `20260524_direct_orders_review_reminders`

---

### Прямой заказ — полный диалог

Точки входа — кнопка "💎 Купить напрямую" в четырёх местах:
- бонусное сообщение (review_ok)
- welcome для повторных клиентов (idle path)
- "нет активных заявок" fallback
- уведомление COMPLETED для 2+ заказа

```
ШАГ 1: клик кнопки "💎 Купить напрямую"
Бот: 💎 Прямой заказ Robux
     Введи количество Robux (от 100 до 10 000):

ШАГ 2: пользователь пишет число (например 500)

  Если есть бонус 100 R$:
  Бот: ✅ Подтверди заказ
       💎 Запрос:          500 R$
       🎁 Твой бонус:     +100 R$
       ━━━━━━━━━━━━━━━━
       📦 Итого получишь:  600 R$
       📌 Цена геймпасса:  858 R$
       [✅ Подтвердить]  [❌ Отмена]

  Без бонуса:
  Бот: ✅ Подтверди заказ
       📦 Получишь:       500 R$
       📌 Цена геймпасса: 715 R$
       [✅ Подтвердить]  [❌ Отмена]

ШАГ 3: нажимает "✅ Подтвердить"
  → WbOrder создан: status=AWAITING_PAYMENT, isDirectOrder=true
  → wbCode = "DIR-XXXXXXXX" (синтетический, не связан с WbCode таблицей)
  → Бот шлёт уведомление администратору
  Бот: 📋 Заказ #A1B2C3 оформлен!
       Менеджер пришлёт реквизиты в течение нескольких минут.
       Ожидай сообщения 👇

─────────────────────── СТОРОНА АДМИНИСТРАТОРА ──────────────────────

Бот → администратор:
  🔷 ПРЯМОЙ ЗАКАЗ #A1B2C3
  ━━━━━━━━━━━━━━━━━━
  👤 @username (ID: 12345678)
  💎 Сумма: 600 R$  (+100 R$ бонус учтён)
  📅 24.05.26 15:32 МСК
  [💳 Отправить реквизиты]  [❌ Отменить заказ]

Клик "💳 Отправить реквизиты":
  Бот → администратор: Введи реквизиты для пользователя:
  Администратор пишет, например:
    Сбербанк: 4276 1234 5678 9012 / Сумма: 2100 руб. / Иван И.
  → WbOrder.status = PAYMENT_PENDING
  → WbOrder.paymentDetails = текст реквизитов
  → pendingPaymentScreenshot.set(userId, orderId)

─────────────────────── ОБРАТНО К ПОЛЬЗОВАТЕЛЮ ──────────────────────

ШАГ 4: реквизиты приходят пользователю:
  Бот: 💳 Реквизиты для оплаты заказа #A1B2C3:
       [текст который написал менеджер]
       Переведи деньги и пришли скриншот сюда (фото, не файл) 👇

ШАГ 5: пользователь отправляет фото скриншота оплаты
  Бот → пользователь: ✅ Скриншот получен! Менеджер проверит — обычно до 15 минут.
  Бот → администратор: [фото] + "💳 Скриншот оплаты / Заказ #A1B2C3"
    [✅ Оплата принята]  [❌ Отклонить]

ШАГ 6А: администратор "✅ Оплата принята"
  → WbOrder.status = AWAITING_GAMEPASS
  → pendingLink.set(userId, { wbCode: "DIR-...", denomination: 600 })
  Бот → пользователь:
    ✅ Оплата подтверждена!
    Теперь создай геймпасс:
    📌 Цена геймпасса: 858 R$
    Пришли ссылку сюда 👇
    [📖 Инструкция]  [💬 Нужна помощь?]
  → СТАНДАРТНЫЙ FLOW без изменений

ШАГ 6Б: администратор "❌ Отклонить"
  → WbOrder.status = PAYMENT_PENDING (остаётся)
  → pendingPaymentScreenshot.set(userId, orderId) восстанавливается
  Бот → пользователь:
    ❌ Не смогли подтвердить оплату.
    Реквизиты те же — пришли скриншот ещё раз.
```

---

### Схема БД — финальные изменения

```prisma
enum WbOrderStatus {
  AWAITING_PAYMENT    // NEW: прямой заказ, ждём реквизитов
  PAYMENT_PENDING     // NEW: реквизиты отправлены, ждём скриншот
  AWAITING_GAMEPASS
  PENDING
  IN_PROGRESS
  COMPLETED
  REJECTED
}

model WbOrder {
  // ... все существующие поля без изменений ...
  isDirectOrder   Boolean  @default(false)  // NEW
  paymentDetails  String?                   // NEW
}

model User {
  // ... все существующие поля без изменений ...
  reviewBonusGrantedAt  DateTime?           // NEW
  reviewReminderLevel   Int  @default(0)    // NEW: 0-4
}
```

Миграция: `20260524_direct_orders_review_reminders`

---

### CB-константы (64-байтный лимит)

| Константа | Значение | Байт |
|-----------|---------|------|
| `startDirect` | `"start_direct"` | 12 |
| `confirmDirect` | `"confirm_direct"` | 14 |
| `cancelDirect` | `"cancel_direct"` | 13 |
| `sendPaymentDetails(orderId)` | `spd:{orderId}` | 29 |
| `paymentOk(orderId, userId)` | `pay_ok:{orderId}:{userId}` | 59 ✅ |
| `paymentNo(orderId, userId)` | `pay_no:{orderId}:{userId}` | 59 ✅ |

---

### Новые session Maps (session.ts)

```typescript
pendingDirectAmount      Map<number, true>
  // пользователь в режиме ввода суммы

pendingDirectOrder       Map<number, { amount: number; passPrice: number; totalAmount: number }>
  // пользователь видит confirmation, ещё не нажал подтвердить

pendingPaymentDetails    Map<number, string>
  // admin вводит реквизиты; значение = orderId

pendingPaymentScreenshot Map<number, string>
  // tgId (number) → orderId; пользователь должен прислать фото оплаты
```

---

### Review Bonus Reminders — тексты (Вариант А, утверждён)

**При начислении (review_ok):**
```
🎁 +100 R$ зачислено на счёт

Действуют до [дата +30 дней].

Используй на прямой заказ — без карточки WB.
Бонус добавится к покупке автоматически.

[💰 Купить напрямую]  → callback start_direct
```

**Еженедельно (дни 7, 14, 21):**
```
🔔 Напоминание о бонусе

У тебя 100 R$ — действуют до [дата].
Потрать на прямой заказ Robux.

[💰 Купить со скидкой]  → callback start_direct
```

**Финальное (день 27, за 3 дня):**
```
⏳ Бонус сгорает через 3 дня ([дата])

100 R$ на счёте. Используй сейчас.

[💰 Использовать сейчас]  → callback start_direct
```

Cron: `setInterval(1 час)` в bot.ts → query User(reviewBonusGrantedAt≠null, balance>0, level<4) → по дням отправляем уровень → после 30 дней: balance=0, grant=null.

---

### Guard в gamepass $transaction

В `registerText` → gamepass handler, перед блоком `tx.wbCode.updateMany`:
```typescript
if (!state.wbCode.startsWith("DIR-")) {
  // existing wbCode claim logic — не меняется, только оборачивается
}
```

---

### Файлы к изменению

| Файл | Изменение |
|------|-----------|
| `prisma/schema.prisma` | enum + 4 поля |
| `prisma/migrations/...` | SQL миграция |
| `bots/tg/session.ts` | 4 новых Map |
| `bots/shared/admin.ts` | 6 CB-констант + `sendAdminDirectOrderCard` + `sendAdminPaymentCard` |
| `bots/tg/handlers.ts` | entry кнопки ×4, start_direct, amount input, confirm/cancel, admin payment details, registerPhoto, pay_ok/pay_no, guard, review_ok текст |
| `bots/tg/bot.ts` | hourly cron |
| `bots/tg/admin/hub-orders.ts` | метка "🔷 ПРЯМОЙ" |

### Что НЕ меняется — ПОЛНЫЙ СПИСОК (freeze)

**WB-флоу заморожен. Ни одна из этих вещей не редактируется:**
- `/start wbg_CODE_SESSION` → provisional transaction → subscription gate → gamepass prompt
- `handleWbCodeTextEntry` — прямой ввод кода в чат
- Gamepass validation (`getGamepassDetails`, `checkGamePrivate`, все 4 Roblox endpoints)
- `$transaction` claim + order create (кроме нового `if (!isDirect)` guard'а — добавляется, не переписывается)
- `admin_ok` / `admin_reject` callbacks и весь rejection flow
- `user_resubmit` callback
- `notifyUserCompleted` / `notifyUserRejected`
- VK бот — без изменений
- Сайт — без изменений
- Все существующие WbOrder и WbCode записи в БД — без изменений

**⚠️ Обязательный порядок деплоя:**
```bash
# 1. Запушить коммиты
git push origin main

# 2. Тригернуть деплой с ЛОКАЛЬНОЙ машины (force=true — SG/RF не достают до api.github.com)
curl -s -X POST "http://89.110.94.117:8000/api/v1/deploy?uuid=<UUID>&force=true" \
  -H "Authorization: Bearer $COOLIFY_TOKEN"

# ⚠️ Для сайта — uuid=z10ws7m1q45h281zwedmhei4 (НЕ ebac6llp — это Guide без домена)
```

**Проверка статуса:**
```bash
curl -s "http://89.110.94.117:8000/api/v1/deployments/<deployment_uuid>" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" | jq '{status, commit_message}'
# status: "finished" + правильный commit_message = успех
```

**Диагностика TG бота (деплоится на SG, не на RF!):**
```bash
# Контейнер ищи на SG, не на RF:
ssh root@5.223.95.11 "docker ps --format '{{.Names}}\t{{.Status}}' | grep lyz78"
ssh root@5.223.95.11 "docker logs <container_name> 2>&1 | tail -20"
```

**Известная проблема с env в Coolify:** при добавлении env var через Dashboard возможно создание plaintext-дубля (без шифрования) — тогда деплои начнут падать с `DecryptException`. Лечение:
```bash
ssh root@89.110.94.117
docker exec coolify-db psql -U coolify -d coolify -c \
  "SELECT id, key, CASE WHEN value LIKE 'eyJp%' THEN 'encrypted' ELSE 'PLAINTEXT' END FROM environment_variables WHERE resourceable_id=<app_id>;"
# Удалить строку с PLAINTEXT: DELETE FROM environment_variables WHERE id=<id>;
```

**DB состояние (на момент аудита, 2026-05-21):** 3 COMPLETED / 2 REJECTED заказа, 995 AVAILABLE кодов, 9 TG-пользователей.  
**4 зависших RESERVED кода** (`1FS0SNA`, `66PXO05`, `UITRVG1`, `QP7HC6J`) — нет фонового cleanup job, истёкли TTL.

---

## Сессия 2026-05-23 (продолжение) — полный аудит читаемости текста

### Что сделано

**GuideClient.tsx — два коммита:**

**`d979bec` — WBManagerBlock text fixes (начало сессии):**
- Оформление заказа: `text-[10px]/60` → `text-xs/70`
- ТЫ ПОЛУЧИШЬ / ЦЕНА ПАССА: `text-[8px]` → `text-[11px]`, opacity +20%
- Telegram кнопка: `text-[11px]` → `text-xs`
- Подписи кнопок: `text-[10px] zinc-600` → `text-xs zinc-400`
- Время обработки: `text-[10px]` → `text-xs`

**`d5712de` — полный проход по всему файлу (34 правки):**

Удалены все `text-[8px]` и `text-[9px]` из className (было 20+ вхождений), все `text-[10px]` без исключений по смысловым элементам. Полный список замен:

| Место | Было | Стало |
|-------|------|-------|
| PlatformSwitcher лейбл | `text-[9px] zinc-500` | `text-[11px] zinc-400` |
| StepsGrid номера шагов | `text-[9px] /40` | `text-[11px] /50` |
| StepsGrid mobile-бейдж | `text-[9px] zinc-600` | `text-xs zinc-400` |
| "Открыть Creator Hub" кнопка | `text-[10px]` | `text-xs` |
| StandardDoneBlock "ГОТОВО!" | `text-[10px]` | `text-xs` |
| StandardDoneBlock CTA | `text-[10px]` | `text-xs` |
| WBStaticHeader "НОМИНАЛ" | `text-[8px] /60` | `text-[11px] /70` |
| WBStaticHeader "Новый код" | `text-[10px]` | `text-xs` |
| WBGate trust-badges | `zinc-600` | `zinc-400` |
| WBGate "Возникли трудности?" | `text-[10px] zinc-500` | `text-xs zinc-400` |
| WBGate "@RobloxBank_PA" | `text-[12px]` | `text-sm` |
| FormulaCalculator заголовки | `text-[10px] /60` | `text-xs /70` |
| FormulaCalculator field labels | `text-[10px] zinc-500` | `text-xs zinc-400` |
| FormulaCalculator "нажми…" | `text-[10px] zinc-600` | `text-xs zinc-500` |
| FormulaCalculator "скопировано" | `text-[10px]` | `text-xs` |
| Hero WILDBERRIES чип | `text-[9px] /80` | `text-[11px] /90` |
| Все section-лейблы (TUTORIAL, FAQ, PRICE TABLE, ЧАСТЫЕ ОШИБКИ, ПОШАГОВАЯ ИНСТРУКЦИЯ) | `text-[10px] /60` | `text-xs /70` |
| "ЧТО ПОНАДОБИТСЯ" + чекбокс-числа | `text-[9px]` / `text-[8px]` | `text-[11px]` / `text-[10px]` |
| ФОРМУЛА бейдж в таблице цен | `text-[9px]` | `text-[11px]` |
| OFFICIAL / READY? лейблы FAQ | `text-[9px]` | `text-[11px]` |
| WBIntro "Пропустить →" | `text-[9px] zinc-600` | `text-[11px] zinc-400` |
| WBIntro "Восстановление…" | `text-[10px] /50` | `text-xs /60` |
| TIP badges | `text-[9px]` | `text-[10px]` |
| PublicGameBlock подпись | `text-xs zinc-600` | `text-xs zinc-500` |

**Оставлено намеренно:**
- `text-zinc-600` только на иконках (ChevronRight, ExternalLink) и формульных операторах `÷ 0.7 =` (большой размер компенсирует контраст)
- TIP badges и числа в иконках-чекбоксах на `text-[10px]` — минимальный читаемый для декоративных элементов
- Все размеры внутри `style={{ ... }}` (inline-стили анимационных компонентов) — там 7–9px намеренно, это имитация Roblox UI

**`055cc89` — WBGate targeted text pass (продолжение сессии 2026-05-23):**

Второй прицельный проход по экрану ввода кода — самые мелкие элементы:

| Место | Было | Стало |
|-------|------|-------|
| WBStaticHeader WILDBERRIES / ROBLOXBANK | `text-[11px]` | `text-xs` |
| "WILDBERRIES × ROBLOXBANK" eyebrow | `font-pixel text-[11px] /60` | `font-pixel text-sm /80` |
| H1 заголовок WBGate | `text-xl sm:text-2xl` | `text-2xl sm:text-3xl` |
| Main subtext | `text-zinc-400` | `text-zinc-300` |
| "КОД С КАРТОЧКИ" label | `font-pixel text-[11px] /70` | `font-pixel text-sm /85` |
| Helper text под инпутом | `text-xs` | `text-sm` |
| Счётчик "0/7" | `text-xs` | `text-sm` |
| Mode toggle buttons (×2) | `text-xs md:text-sm` | `text-sm` |
| Explainer text | `text-xs` | `text-sm` |
| TG-кнопки (все варианты) | `text-[12px] md:text-sm` | `text-sm` |
| VK-кнопки (все варианты) | `text-[12px] md:text-sm` | `text-sm` |
| "Переходи в мессенджер…" (guide mode) | `text-xs md:text-sm` | `text-sm` |
| "Геймпасс уже создан?" (ready mode) | `text-xs md:text-sm` | `text-sm` |
| VK auth text (×2) | `text-xs text-[#5599ff]` | `text-sm text-[#5599ff]` |
| "Код одноразовый · Хранить не нужно" | `text-xs` | `text-sm` |

### Деплой
```bash
curl -s -X POST "http://89.110.94.117:8000/api/v1/deploy?uuid=z10ws7m1q45h281zwedmhei4&force=true" \
  -H "Authorization: Bearer $COOLIFY_TOKEN"
# deployment_uuid: pabfk98x3sdsgxmjmxft3zpi — status: finished ✅
```

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

---

## Сессия 2026-05-23–24 — UX-аудит + ротация токенов

### UX-аудит (GuideClient.tsx, коммиты `2d0b8ea`, `169de13`, `7ee10e9`)

**Полный проход по UX (11 фиксов, `2d0b8ea`):**
- `Anim04Price`: интервал 1400→2400ms (убрана быстрая мелькалка)
- `Anim06WB`: интервал 1800→1600ms
- `PlatformSwitcher`: spring stiffness 400→300, damping 30→28 (меньше overshoot)
- Step detail text: `text-zinc-400` → `text-zinc-300` (WCAG AA контраст)
- Bullet icons: `w-2 h-2` → `w-3 h-3`
- `FormulaCalculator` disabled state: добавлена `opacity-50`
- WBGate error: анимированное появление через `AnimatePresence` + иконка AlertTriangle + ссылка на поддержку
- Price table: `overflow-x-auto` + `min-w-[320px]` для горизонтального скролла на mobile
- Hero stats grid: `grid-cols-4` → `grid-cols-2 md:grid-cols-4`
- FAQ: `focus-visible:outline` для keyboard navigation
- WBManagerBlock description: `text-zinc-400` → `text-zinc-300`

**Mobile-аудит (6 фиксов, `169de13`):**
- Убран `autoFocus` на WBGate input (угонял клавиатуру при открытии)
- WBGate outer padding: `py-16` → `py-8 sm:py-16` (short screens)
- WBGate card: `p-10 lg:p-14` → `p-6 sm:p-10 lg:p-14`
- Trust badges: `flex-wrap` + `gap-y-2`
- Hero H1: `text-6xl md:text-7xl` → `text-5xl sm:text-6xl md:text-7xl`
- FormulaCalculator static row: `flex-wrap`

**Ultrareview fixes (`7ee10e9`):**
- `HANDOFF.md`: raw Coolify токен заменён на `$COOLIFY_TOKEN`
- `bots/tg/handlers.ts`: `privgame` reasonMap — убрана inline-инструкция (противоречила fixInstructions)
- `GuideClient.tsx`: `aria-label` + `aria-current` на slideshow nav dots

### Безопасность — ротация токенов (2026-05-24)

**Обнаружены и исправлены утечки:**

| Что | Где было | Статус |
|-----|---------|--------|
| Coolify API token `18\|891afd...` | `HANDOFF.md` (в git-истории) | Токен отозван. В истории остался — угрозы нет. |
| TG bot token `AAENlm8...` | `test_tg.js` (в git-истории) | Токен отозван, файл удалён (`3e485a3`). |
| `NEON_API_KEY` plaintext | Coolify DB, env var ID=135 | Удалён (был дублём encrypted ID=136). Вызывал `DecryptException` при деплое. |

**Новые токены** (хранятся только в Coolify env vars):
- TG токен: `@RobloxBankBot` → обновлён в TG_bot и VK_bot
- Coolify API токен: создать новый в Profile → API Tokens (нужны права Read+Write+Deploy)

**Важно:** VK бот тоже использует `TG_TOKEN` для отправки admin-уведомлений. При ротации TG токена — обновлять **оба** сервиса: `TG_bot` и `VK_bot`.

### Архитектурное открытие: TG бот на отдельном сервере

TG бот (`lyz78enntugna9em1biopinr`) деплоится на **SG сервер** (`5.223.95.11`), а не на RF. Это было неочевидно — в Coolify Dashboard сервис выглядит как обычное приложение. При отладке контейнеры искать на SG:

```bash
ssh root@5.223.95.11 "docker ps | grep lyz78"
ssh root@5.223.95.11 "docker logs <container> 2>&1 | tail -20"
```

### Текущее состояние workflow (2026-05-24)

| Компонент | Статус | Проверено |
|-----------|--------|-----------|
| `robloxbank.ru` | 200 OK | ✅ |
| `robloxbank.ru/guide?source=wb` | 200 OK | ✅ |
| `@RobloxBankBot` (Telegram API) | ok, токен валиден | ✅ |
| TG бот (`[TG] Bot started ✅`) | running, polling | ✅ SG |
| VK бот (`[VK] Bot started ✅`) | running | ✅ RF |
| Bridge (`0.0.0.0:3000`) | listening | ✅ SG |
| Neon DB (TCP `5432`) | reachable | ✅ |

---

## Сессия 2026-05-24 (вечер) — Прямые заказы: деплой + bugfix-волна

### Что задеплоено

Три коммита в рамках прямых заказов и review reminders:

| Коммит | Содержимое |
|--------|-----------|
| `dccedeb` | Прямые заказы v1: новые поля схемы, handlers.ts, crons.ts, admin/hub-orders.ts |
| `70b27d6` | 5 багов из ревью регистрации фото и колбэков |
| `c6e5b90` | 2 UX-улучшения: бейдж лояльности + кнопка статуса с реквизитами |

TG бот перезапускался на `c6e5b90` и вышел чисто:
```
🚀 DEPLOY_VERSION: 4.0 - LOYALTY_HARD_SYNC
[ReviewReminder] Cron started ✅
[TG] Bot started ✅ (polling)
[Bridge] Validation server listening on 0.0.0.0:3000
```

---

### Что добавлено в прямые заказы

Полная схема потока — в разделе "Сессия 2026-05-24" выше.

**Новые файлы:**
- `bots/tg/crons.ts` — hourly review reminder cron (дни 7/14/21/27, expire day 30)

**Изменённые файлы:**
- `bots/tg/handlers.ts` — прямой заказ end-to-end (startDirect → amount → confirm → adminCard → payDetails → screenshot → ok/no → gamepass)
- `bots/tg/session.ts` — 4 новых Map: `pendingDirectAmount`, `pendingDirectOrder`, `pendingPaymentDetails`, `pendingPaymentScreenshot`
- `bots/shared/admin.ts` — 6 новых CB + `sendAdminDirectOrderCard` + `sendAdminPaymentCard`
- `bots/tg/admin/hub-orders.ts` — статусы AWAITING_PAYMENT и PAYMENT_PENDING в dashboard
- `bots/tg/bot.ts` — `startReviewReminderCron(bot)` после launch
- `bots/tg/Dockerfile` — COPY `bots/tg/crons.ts`

---

### Баги закрыты (70b27d6 + c6e5b90)

| # | Серьёзность | Проблема | Файл |
|---|------------|---------|------|
| A | **HIGH** | `registerPhoto`: нет DB recovery при перезапуске бота когда пользователь в `PAYMENT_PENDING`. Фото летело в review fallback → "нет выполненных заказов" → тупик | handlers.ts |
| B | **MEDIUM** | `registerPhoto` review DB fallback не фильтровал `isDirectOrder: false` — мог совпасть с direct-заказом и испортить review_ok | handlers.ts |
| C | **LOW-MEDIUM** | `user_resubmit` callback: старые кнопки в чате несут `DIR-XXXXXXXX` в callback_data → попадало в pendingLink/gamepass flow | handlers.ts |
| D | **LOW** | `review_hint` не фильтровал `isDirectOrder: false` → мог поставить `pendingReview` на direct-заказ | handlers.ts |
| UX | — | `sendAdminPaymentCard` не показывал сумму заказа. Менеджер не знал, сколько должны перевести | admin.ts |
| UX | — | Сообщение с реквизитами пользователю шло без единой кнопки. После оплаты некуда нажать | handlers.ts |
| UX | — | `sendAdminDirectOrderCard` не показывал информацию о лояльности (кол-во завершённых заказов) | admin.ts |

---

### Текущее состояние прямых заказов

- ✅ WB-флоу без изменений (regressions нет)
- ✅ Прямой заказ: полный цикл AWAITING_PAYMENT → PAYMENT_PENDING → AWAITING_GAMEPASS → PENDING → COMPLETED
- ✅ DB recovery после перезапуска бота для всех in-memory Maps
- ✅ Review bonus reminders cron (hourly)
- ✅ Loyalty badge в admin-карточке прямого заказа
- ✅ Кнопка "📊 Проверить статус" в сообщении с реквизитами

### Открытые задачи (backlog, некритично)

- [ ] **P1-B** (site): `WBManagerBlock` всегда посылает `wb_` prefix вместо `wbg_` 
- [ ] **P2-C** (site): `wb_code` cookie без `HttpOnly`
- [ ] **P1-E** (site): GET `/api/wb-code` без auth
- [ ] **P1-TG**: `answerCbQuery` может не вызваться при throw в `ord_rr` ветке
- [ ] **P2** (site): `VKAuthButton` доверяет `?code=` URL-параметру (spoofing)
