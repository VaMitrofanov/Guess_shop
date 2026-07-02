# Коридор и сайт (`/guide`)

Точка входа с Wildberries: `robloxbank.ru/guide?source=wb`. Отдельный контейнер (Guide)
обслуживает только этот путь.

## Фазы гейта — `GuideClient.tsx`

`intro → gate → instruction`. Стартовая фаза выбирается по props из `page.tsx`:

| Query | Смысл |
|-------|-------|
| `?source=wb` | WB-коридор (иначе — общая инструкция) |
| `&skip=1&code=XXXX` | открыть инструкцию напрямую (ссылка от бота; работает в Telegram WebView, где localStorage изолирован) |
| `&test=1` или `code=TESTDEV` | тихий QA-просмотр: без резерва/бота/БД/алертов, кнопки TG/VK **инертны** |
| `&preview=1` | как test, но кнопки **рабочие** («как будто код уже активирован») |
| `&nom=1000` | номинал для test/preview |

Восстановление сессии (`useEffect` при монтировании): `loadWBSession()` из localStorage →
`?code=` из URL → `GET /api/wb-code?code=` → если `claimed` показывает фазу instruction.
Таймаут 10 с на восстановление.

## WBGate — ввод кода

- Поле нормализует ввод: `[^a-zA-Z0-9] → ""`, upper-case, 7 символов.
- `validateAndPersist()` → `POST /api/wb-code` (резерв) → сохраняет сессию + cookie `wb_code`.
- Обе кнопки (TG/VK) вызываются с `guide=true`:
  - **TG:** редирект `t.me/RobloxBankBot?start=wbg_КОД_SESSIONID` (`wbg_` = guide-режим).
  - **VK:** показывает `VKAuthButton` с `wbCode = GD+КОД` (`GD` = guide-режим).
- Fallback-контакт менеджера `@RobloxBank_PA` на ошибках и внизу карточки.

> Замечание: в текущей вёрстке «чистый» `wb_`-префикс (не guide) с гейта не отправляется —
> обе кнопки всегда guide. Обработчик `wb_` в боте остаётся для прямых/старых ссылок.

## API коридора

### `POST /api/wb-code` — резерв кода
Атомарно в транзакции: находит код (case-insensitive), проверяет статус и возвращает
`denomination`. Логика:
- `isUsed && userId` → 409 «уже активирован».
- `CLAIMED && !isUsed` → 409 `BOT_CLAIMED` («продолжай в боте»).
- `RESERVED` тем же sessionId → продлевает бронь; другим sessionId → **перехватывает**
  (клиент держит физическую карту — он «выигрывает»).
- `AVAILABLE` → `RESERVED` на +60 мин.

### `GET /api/wb-code?code=` — статус
Возвращает `{ claimed, denomination, platform, orderStatus, robloxUsername }`. `claimed`
= есть `userId` или статус `CLAIMED`. Данные заказа — чтобы инструкция показала один
правильный канал и статус «заказ уже оформлен».

### `POST /api/wb-code/select-gamepass` — материализация заказа (one-tap с сайта)
Пользователь выбрал геймпасс в поиске по нику на шаге 9. Роут промотирует provisional-заказ
`AWAITING_GAMEPASS → PENDING` прямо здесь (не дожидаясь возврата в бота) и шлёт админ-карточку
«🌐 ONE-TAP С САЙТА». Идемпотентно (guard по статусу в транзакции → карточка ровно раз).
Серверная ре-валидация: цена ±2 R$ и `isActive`; если Roblox недоступен — принимает
(`validationSkipped`), как бот.

### `GET /api/roblox/gamepasses?query=` — поиск по нику/ID
`extractGamepassId()` парсит URL/чистый ID → прямой lookup; иначе `getUserGamepasses(nick)`.
Если пусто — доп. `getRobloxUser` чтобы отличить «нет такого юзера» от «есть, но нет
публичных геймпассов на продаже» (зеркалит ветвление бота).

### `GET /api/wb-link` — коридор сайт → VK
Читает `wb_code` из JWT-сессии (записан при VK-логине в `auth.ts`), линкует `userId`
к `WbCode` (если ещё не CLAIMED), редиректит в `vk.me/club237309399?ref=КОД` (или `GD+КОД`).

## Поток активации (сайт → TG)

```
1. /guide?source=wb → WBIntro → WBGate
2. Ввод 7-символьного кода → "Получить в Telegram"
3. POST /api/wb-code → RESERVED; редирект t.me/RobloxBankBot?start=wbg_КОД_SESSIONID
4. TG /start: upsert User → provisional TX (WbCode CLAIMED isUsed=false + WbOrder AWAITING_GAMEPASS)
   → админ-уведомление «НОВЫЙ КЛИЕНТ» → (опц.) гейт подписки → кнопка «ОТКРЫТЬ ИНСТРУКЦИЮ»
   ⭐ если на сайте уже выбран геймпасс (selectedGamepassId) → one-tap «✅ Да, выкупаем»
5. Клиент проходит 9 шагов, создаёт геймпасс на create.roblox.com
6. Вариант А (осн.): на сайте вводит ник → поиск → выбор → select-gamepass → one-tap в бот
   Вариант Б: пишет ник/ссылку/Asset ID прямо в бот
7. processGamepassSubmission: extractPassId → getGamepassDetails (4 эндпоинта) →
   проверки isActive / цена ±2 / не private. Roblox недоступен → validationSkipped
8. Финальная TX: WbCode.isUsed=true, WbOrder → PENDING, gamepassUrl сохранён
9. Клиент получает подтверждение; renderOrderCard → все ADMIN_IDS
10. Менеджер: ✅ ВЫКУПЛЕНО → COMPLETED → уведомление; ❌ ОШИБКА → причина → уведомление
```

**Сайт → VK** — аналогично, но через VK-логин (`auth.ts` создаёт provisional-заказ и шлёт
TG-уведомление «КОД АКТИВИРОВАН (сайт → VK)»), затем `vk.me/...?ref=КОД` →
`handleRefActivation`.

**Прямой ввод в бот (без сайта):** 7-символьный текст → тот же provisional-паттерн.
