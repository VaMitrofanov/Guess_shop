# RobloxBank — Project Handoff

> **⚠️ У ТЕБЯ ЕСТЬ ПОЛНЫЙ ДОСТУП К СЕРВЕРАМ ПО SSH И К COOLIFY. ЧИТАЙ СЕКЦИЮ «ДОСТУП К ИНФРАСТРУКТУРЕ» НИЖЕ. НЕ СПРАШИВАЙ ПОЛЬЗОВАТЕЛЯ О ДОСТУПАХ — ОНИ ВСЕ ЗДЕСЬ.**

> Передавай этот файл в каждую новую сессию Claude. Он содержит всё, что нужно, чтобы быстро войти в контекст, не читая тысячи строк кода.

---

## Сессия 2026-06-23 (вечер) — Меню покупателя (TG+VK) + чистка велкома + TWA-заметки по заказу (✅ ЗАДЕПЛОЕНО)

> «Большой промт с фиксами» после ручного прогона `TEST300`, в две волны. Коммиты: `60ecc21` (TG меню+велком), `8b0a4ba` (VK зеркало), `e070296` (TWA заметки+кнопки). Деплои: TG_bot, VK_bot, RobloxBankWeb — все finished. tsc: web `--noEmit` 0 ошибок; боты `bots/tsconfig.json` — 0 новых.

### 1. Велком после активации кода — ОДНА кнопка «инструкция», без мусора (`registerStart`, `:~496`)
- Человек только ввёл код на сайте → он ничего не понимает, ему нужна **только инструкция**. Убраны кнопки «найти по нику / мой заказ / купить напрямую» и абзацы про уведомления/прямой выкуп. Осталось: greet + «код активирован · номинал → геймпасс» + 1 строка CTA + 1 URL-кнопка «📖 ОТКРЫТЬ ИНСТРУКЦИЮ». Весь остальной функционал переехал в `/menu`.

### 2. Меню покупателя / мини-профиль (`buildBuyerMenu`, `/menu`, callback `CB.buyerMenu="menu"`)
- Лоялти-хаб: тир (🌱/💛/👑 по `getCustomerStatus.orderCount`), 🛍 кол-во заказов, 🎁 бонусный баланс (`User.balance`), 📦 статус последнего заказа (`STATUS_LABEL`) + кнопки: 📦 Мой заказ (`refreshStatus`) · 💎 Купить напрямую (`startDirect`) · 📖 Инструкция (личная ссылка с кодом если есть WB-заказ) · 💬 Поддержка. Fail-open. Цель — приучить покупателя к боту для будущих прямых заказов.
- Доступ: команда `/menu` (добавлена первой в `setMyCommands`), кнопка «👤 В моё меню» во **всех** ветках `buildStatusMessage` (раньше из статуса был тупик), и кнопка «👤 Открыть моё меню» в подтверждении «геймпасс принят» (`processGamepassSubmission`).

### Тест-коды
- Сброшены в AVAILABLE (`npm run dev:reset-test`): `TEST300` 300→**429**, `TESTDEV`/`TEST500` 500→**715**, `TEST700` 700→**1000**. (NB: старая заметка «500→714» неточна — формула `Math.ceil(denom/0.7)` даёт 715.)

### 3. VK — зеркало велкома + меню (✅ ЗАДЕПЛОЕНО, `8b0a4ba`, VK_bot deploy `yt1gabq57xygxaxz9brhiw8t`)
- Велком после активации (`handleRefActivation`) → одна url-кнопка «📖 ОТКРЫТЬ ИНСТРУКЦИЮ».
- `sendVkBuyerMenu` (payload `command:"menu"`) — VK-аналог `buildBuyerMenu` (plain-text, без HTML). Кнопка «👤 В моё меню» во всех ветках VK-статуса (`handleIdleMessage` «статус»), в подтверждении «заявка принята» и в IDLE-велкоме возвращающегося. VK без слэш-команд → меню достижимо только кнопками. `VK_STATUS_LABEL` добавлен.

### 4. TWA-админка — заметки по заказу + быстрые кнопки (✅ ЗАДЕПЛОЕНО, `e070296`, web deploy `z7b9xmx7p3oxpsdwbmyk71mh`)
- **`WbOrder.adminNote String?`** — миграция `20260623_add_wborder_admin_note` (additive/nullable, применена к Neon через `prisma migrate deploy`). Заметка только для админов (вся TWA за `extractTwaUser`), клиенту не видна.
- `OrdersScreen.tsx`: компонент `NotesEditor` (autosave on blur + кнопка «Сохранить»), карточка с заметкой подсвечена жёлтым. POST-экшен `set-note` (статус не трогает → counts не сбрасываются), оптимистичный патч `saveNote`.
- Кнопки рядом с «В работу»: **↩︎ Вернуть в «Новые»** (POST `untake`, IN_PROGRESS→PENDING, оптимистичный путь в `runAction`); **🔗 Открыть геймпасс / 📋 Ссылка / 📋 Ник** (`QuickTools`, чистый клиент). Все 4 запрошены пользователем.
- Прод-проверка: `tsc --noEmit` (web) и `bots/tsconfig.json` (боты) — 0 новых ошибок.

### Осталось / возможный follow-up
- Заметка `adminNote` показана только в TWA-карточке. В чат-карточку TG-бота (`renderOrderCard`) не выводится — по запросу можно добавить read-only строку.

---

## Сессия 2026-06-23 — Репозиционирование бота в текстах + упрощение инструкции (9 шагов) + авто-возврат с сайта

> Большой промт пользователя со списком фиксов к апдейту `47d529f`. Всё локально проверено (`tsc` чисто, боты бандлятся, инструкция отрендерена Playwright). Деплой — этой сессией.

### 1. Боты — тексты под новую роль «инструкция + уведомления» (`bots/tg/handlers.ts`, `bots/vk/handlers.ts`)
- **Все точки велкома переписаны** (TG: активация `:512`, возврат `:244`, recovery `:996`, ввод кода `:1985`, пост-подписка `:3389`; VK: `:607`, `:642`, `:1014`, `:2080`). Новая рамка: «📖 Вот твоя персональная инструкция — заказ оформляется ТАМ по нику Roblox; 🔔 здесь, в боте, придут уведомления о заказе». Поиск по нику в боте — вторичная кнопка-fallback «🔎 Уже создал — найти по нику».
- **Ник Roblox в карточке заказа** (TG `buildStatusMessage`, VK статус): строка `🎮 Roblox: <ник>` из `WbOrder.robloxUsername` — видно, куда придут робуксы.
- **`/help` (TG)**: теперь ищет последний заказ юзера → личная ссылка `?source=wb&skip=1&code=КОД` (а не generic-гейт ввода кода). Убраны строки команд `/status`/`/direct` из текста — только кнопки.
- **Правило ссылок (память `feedback_instruction_links`):** личная ссылка с кодом везде, где есть код/заказ; generic `?source=wb` (ввод кода на сайте) — ТОЛЬКО в cold-start велкоме (юзер впервые написал боту без кода). Проаудичено — все generic-ссылки в no-code контекстах.

### 2. Сайт — «Вернуться в TG/ВК» + авто-возврат (`src/app/guide/WBInstructionV2.tsx`)
- Кнопка канала переименована: **«Вернуться в Telegram» / «Вернуться в ВКонтакте»** (понятно, что на сайте делать больше нечего).
- **Авто-редирект** в бота через 1.8 c после оформления заказа (`orderPlaced`): TG → deep link, VK → `vk.me/club237309399?ref=КОД` (повторный OAuth не нужен). + подсказка «↩︎ Возвращаем в …» и кнопка-fallback. Новая константа `VK_RETURN_HREF`, проп `label` у `VKAuthButton`.

### 3. Инструкция упрощена: 10 → 9 шагов (Roblox: плейсы публичны по умолчанию)
- **Удалён старый шаг 3 (Public/Questionnaire)** — отдельный шаг «сделай игру Public» больше не нужен. Перенумеровано, кросс-ссылки на шаги поправлены. Hero: «Всего 9 шагов».
- **Шаг 2** — без упоминаний Public; новый скрин `public/guide/wb-step2-place.png` (ник заменён на нейтральный «My Place», CSS-обводка «НАЖМИ» на карточке плейса).
- **Новый шаг 3 «Открой раздел Passes»** — зацикленное видео `public/guide/wb-step3-passesnav.mp4` (+poster): дашборд → ☰ → Monetization → Passes → страница. Нарезано из `~/Downloads/ScreenRecording_06-23-2026 02-45-55_1.MP4` (HEVC→H.264 560px; `crop` убрал белый iOS-чром; ник скрыт drawbox'ами).
- **Убран гейт верификации** (`chkPublic`/`verified`) — поиск по нику доступен сразу, без чекбокса «плейс публичный».
- **Шаг 8 (поиск по нику) выделен как ФИНИШ/оформление заказа**: `pulse cls="wbi-key wbi-finish"`, зелёный бейдж «🏁 ФИНИШ — ОФОРМЛЯЕМ ЗАКАЗ» + зелёное свечение карточки. Текст объясняет: дальше всё в боте (TG/ВК) — он сам выкупит пасс, там статус/уведомления/бонусы.
- **Легаси-копия всей старой инструкции:** `src/app/guide/WBInstructionV2.legacy.tsx` (на случай отката). Старые ассеты (wb-step2-public.jpg, wb-step3-menu.jpg, wb-step3-answers.mp4, wb-step4-menu.png…) не удалены.
- Память: `project_instruction_simplified`, `feedback_instruction_links`.

### 4. Поддержка — «живой человек», не пассивное «менеджер уже в курсе»
- **TG пост-подписочный велком (`bots/tg/handlers.ts:3389`, chat_member join):** поддержки тут НЕТ совсем — ни кнопки, ни ссылки, ни текста (требование пользователя: все ответы в инструкции). Только 📖 инструкция + 🔎 поиск по нику.
- **TG саппорт-флоу (callback `supportBtn`, `:2338-2348`):** было «🤝 Менеджер уже в курсе… Тебе ответят» → стало «💬 Поддержка — это <b>живой человек</b> в отдельном чате <b>@RobloxBank_PA</b> (не бот). Напиши туда сам — поможем 👇». `notifySupportShown` (алерт админам) сохранён.
- **VK зеркально (`bots/vk/handlers.ts`):** модель VK иная — поддержка **в том же чате** (бот ставится на паузу `pauseSupport`, менеджер пишет в VK-диалог) + TG-альтернатива. Механику не трогал; формулировки `triggerSupport` (`:101`) и NL-триггера (`:564`) переписаны на «с тобой общается <b>живой человек (не бот)</b> — менеджер ответит прямо здесь». Пост-подписочного велкома в VK нет (нет события входа в канал — TG-only).

### Деплой этой сессии (✅ ВСЁ ЗАДЕПЛОЕНО)
- **Web** (`RobloxBankWeb`) — авто по push. **Guide-контейнер** (`ebac6llpah5n2x58rb64yn8j`) — вручную (watch-paths `src/app/guide/**`,`public/guide/**`). **Оба бота** (TG `lyz78enntugna9em1biopinr`, VK `gmtpfqosgoz23vjyxyczuic9`) — передеплой под новые тексты.
- Коммиты: `d04c868` (инструкция+боты+сайт), `0424b27` (TG саппорт=живой человек), `2b14eb7` (VK зеркало саппорта), `4339e15` (TG: убрал поддержку с велкома). Все 4 контейнера пересобраны, прод проверен Playwright (9 шагов, видео грузится, 0 ошибок консоли).
- Тест-коды сброшены в AVAILABLE для повторного прогона (`npm run dev:reset-test`): TESTDEV 500, TEST300 300→429, TEST500 500→714, TEST700 700→1000.

---

## Сессия 2026-06-22 (ночь) — Заказ оформляется НА САЙТЕ + бот = уведомления/прямой выкуп (✅ ЗАДЕПЛОЕНО, коммит `47d529f`)

> Весь предыдущий локальный задел (one-tap, 10-шаговая инструкция, фикс VK-фото) **выкачен в прод этой сессией**. Все 4 контейнера собраны из `47d529f` (Web/Guide/TG_bot/VK_bot).

### Главное изменение потока
Раньше: сайт лишь записывал `selectedGamepassId`, заказ «материализовал» бот по one-tap. **Теперь сайт сам оформляет заказ.**
- **`POST /api/wb-code/select-gamepass`** стал ОФОРМИТЕЛЕМ: ревалидирует пасс (`getGamepassDetails`: on-sale + цена; плейс уже Public, т.к. поиск идёт `accessFilter=Public`), атомарно (updateMany со статус-гардом, идемпотентно) промоутит `WbOrder` `AWAITING_GAMEPASS→PENDING` (+`isUsed`, `selectedGamepassId`, `robloxNick`, `gamepassUrl`, `robloxUsername=nick`) и **сразу шлёт админ-карточку** с маркером **🌐 ONE-TAP С САЙТА**.
- Веб-карточка: новый `src/lib/admin-card.ts` (`sendWebOrderCard`) через `sendTelegramMessage` (бридж ставит `parse_mode:HTML`); кнопки `admin_ok:`/`admin_reject_init:`/TWA — их обрабатывает существующий TG-бот.
- `GET /api/wb-code` теперь отдаёт `platform` + `orderStatus`.

### Боты
- **one-tap status-aware** (`offerPreselectedGamepass`/`vkOfferPreselectedGamepass`): заказ уже `PENDING` → «✅ Заказ оформлен, слежу за статусом» (+ кнопки статус/напрямую); ещё `AWAITING_GAMEPASS` → старый one-tap как **fallback**.
- **Тупики устранены:** открыть бота по deep-link после оформления на сайте больше НЕ упирается в «код уже активирован ранее» — показывается статус заказа (TG `registerStart` + VK `handleRefActivation`, ветка `isUsed&&userId` → проверка владельца + PENDING).
- **Тёплый велком** + блок «что умею» (📖 инструкция / 📊 статус / 💎 напрямую) во всех точках входа (TG: активация/активный заказ/IDLE/recovery; VK: refActivation/restore/IDLE).
- **TG профиль программно при старте** (`setupBotProfile` в `bot.ts`): `setMyDescription` + `setMyShortDescription` + `setMyCommands` (`/status`, `/direct`, `/help`). Добавлены команды `/direct` (direct-флоу) и `/help`. Хелпер `startDirectFlow` вынесен из колбэка.
- Маркер 🌐 в карточках, оформленных ботом (fallback): TG `renderOrderCard` (через `wbCode.selectedGamepassId`), VK `sendAdminOrderCard(viaWebOneTap)`.

### Инструкция (`WBInstructionV2.tsx`)
- CTA внизу — **одна кнопка по каналу** (`channel` из GET wb-code: TG-ссылка / VKAuthButton; оба — если канал неизвестен).
- Блок 💎 «купить напрямую» вынесен заметно (шаг 10 `.wbi-directnote` + CTA `.wbi-directcta`), состояние «Заказ оформлен» (`orderPlaced`).

### Проверено в проде (этой сессией)
- ✅ Все 4 контейнера = коммит `47d529f`.
- ✅ Web API: `gamepasses?query=` отдаёт `userExists`; `select-gamepass` (битый body → 400); `wb-code` (нет кода → 404).
- ✅ Инструкция (Playwright, апекс, `?source=wb&test=1`): 10 шагов (бейджи 1–10), гейт Public блокирует/разблокирует инпут, поиск по нику → ветка `user_not_found`, блок «напрямую» в шаге 10 и CTA, 0 ошибок консоли.
- ✅ VK re-auth безопасен: `auth.ts` link-апдейт с гардом `status:{not:"CLAIMED"}` → у оформленного кода (CLAIMED) это no-op, `isUsed` не сбрасывается, дубль-заказа нет.
- ⏳ **Осталось проверить вручную (нужен реальный тап в боте / прод-токен):** профиль TG-бота (описание + меню команд), живой bot-флоу: велком → выбор на сайте → админ-карточка 🌐 → `✅ ВЫКУПЛЕНО` закрывает заказ → бот «уже оформлен». Дамп прод-`TG_TOKEN` через SSH заблокирован классификатором — проверяй открыв бота.

### Замечание (исправлено по факту кода)
Старая заметка «`robloxNick` сидит в `WbOrder.robloxUsername`» была неверна. Теперь оформитель на сайте **реально** пишет `robloxUsername=nick`. Бот в своём пайплайне по-прежнему пишет `validatedCreator` из Roblox.
NB: фикс «VK-фото отзыва зависает» (секция «вечер» ниже) тоже вошёл в `47d529f` и **задеплоен** — статус «🟡 ЛОКАЛЬНО» там устарел.

### Тестирование (как у покупателя)
- Постоянные тест-коды (`scripts/reset-test-code.mjs`, формат валиден — 7 симв.): `TESTDEV` 500, **`TEST300` 300→геймпасс 429 R$**, `TEST500` 500→714, `TEST700` 700→1000. Сброшены в `AVAILABLE`.
- **Скрипт допилен:** теперь reset ещё удаляет старый `WbOrder` тест-кодов и чистит `selectedGamepassId`/`robloxNick` (иначе повторный прогон цеплял мусор). Запуск: `npm run dev:reset-test`. (Правка `reset-test-code.mjs` **НЕ закоммичена** — лежит локально.)
- Решение пользователя: тест-коды **оставить `isTest=true`**. Проверено грепом — `isTest` влияет ТОЛЬКО на исключение из статистики (TWA dashboard/codes/system, low-code cron, admin wb-codes list); сам сценарий, велком, инструкция, гейт подписки, создание заказа, **админ-карточка** и видимость заказа в дашборде — идентичны боевым (создаваемый `WbOrder` НЕ помечается `isTest`). Т.е. для теста флоу/админки всё уже «как у покупателя».
- Ссылка-инструкция работает и по AVAILABLE-коду: `GuideClient.tsx:2910` показывает инструкцию, если в URL есть `code` и GET вернул `denomination` (timing-race ветка). Проверено Playwright: `?source=wb&skip=1&code=TEST300` → инструкция, 10 шагов, 429.
- Жёсткое условие шага 9: геймпасс должен быть **ровно цена кода ±2 R$** (TEST300→429), публичный плейс, On sale — иначе ветка «есть пассы, но не за 429».

### ⏭️ Следующая сессия (запланировано пользователем)
Пользователь сам прогонит полный покупательский путь с другого ТГ-аккаунта через `TEST300` и **через пару часов даст БОЛЬШОЙ промт со списком фиксов**. Жди его — это основная задача следующей сессии. Перед фиксами перечитай этот блок + `project_corridor_flow` (память обновлена под «заказ оформляется на сайте»).

---

## Сессия 2026-06-22 (вечер) — Ручное начисление бонусов + фикс «VK-фото отзыва зависает»

### 1. Ручное начисление бонусов за отзыв (✅ СДЕЛАНО В ПРОДЕ, через Neon)
Коды `E258Z47` (Наталия Труженникова, vk `132053114`) и `WORYQBK` (Sonya Kazakova, vk `789435359`): у обоих заказ COMPLETED, но фото отзыва в VK «зависло» → бонус не начислился. Начислил вручную **+100 R$ каждому**, атомарно+идемпотентно (как `review_ok`): `WbCode.reviewBonusClaimed=true`, `User.balance += 100`, `reviewBonusGrantedAt=now`. Обоим ушло сообщение **от VK-бота** с кнопкой «💎 Купить напрямую» (требование пользователя: гнать таких в прямые заказы).
- Новые скрипты в `scripts/` (одноразовые, идемпотентные, читают `.env`):
  - `node scripts/credit-review-bonus.mjs <CODE> [<CODE>…] [--dry-run]` — повторяет логику `review_ok` + шлёт VK/TG-уведомление от бота с CTA «Купить напрямую».
  - `node scripts/inspect-review-codes.mjs <CODE>…` — read-only: код + юзер (balance/bonus) + заказы.

### 2. Фикс «VK-фото отзыва зависает» (🟡 ЛОКАЛЬНО, НЕ ЗАДЕПЛОЕНО, НЕ ЗАКОММИЧЕНО) — `bots/vk/handlers.ts`
**Причины (почему фото не принималось):**
1. **Главная:** 30-мин support-пауза (`isSupportPaused`) **молча роняла любое фото** (`return` без ответа). Триггерится кнопкой «Нужна помощь?» ИЛИ словом из `SUPPORT_WORDS` («помощь/помоги/оператор…»), в т.ч. подписью к фото.
2. `extractPhotoUrl` → undefined → юзер в цикле «отправь ещё раз».
3. В VK `AWAITING_REVIEW` **никогда не армится** после COMPLETED (VK-бот — отдельный процесс, событие завершения в TG-процессе, in-memory state не прокинуть). Поэтому review-фото всегда определяется через БД (последний COMPLETED + `WbCode reviewBonusClaimed:false`). NB: `setState(parseInt(user.vkId), …)` в `tg/handlers.ts:3192` для VK фактически no-op.

**Что сделано (локально):**
- `messageHasPhoto(ctx)` — детект фото и из сырого payload / fwd / reply (не только vk-io `hasAttachments`).
- `hasPendingProofPhoto(vkUserId)` — есть ли незакрытый отзыв (COMPLETED+неполученный бонус) или оплата direct-заказа (PAYMENT_PENDING). Fail-safe → false.
- Support-пауза и natural-language support-триггер: **пропускают eligible proof-фото** в review/payment-пайплайн; чужие скрины (менеджеру) по-прежнему молчат.
- `!url`-ветка `handleReviewScreenshot`: если юзер eligible — «получили, менеджер проверит» + алерт админам с VK ID (вместо тупика «отправь ещё раз»).
- Память: `project_vk_review_photo_hang`.

### Осталось / следующая сессия
- **Доделать логику на сайте** + **чуть изменить воркфлоу ботов** (по словам пользователя; детали обсудим). При переделке учитывать ограничение из п.2.3 (cross-process state).
- Деплой VK-бота (с этим фиксом) — по команде пользователя.

---

## Сессия 2026-06-22 — Поиск по нику на сайте + one-tap в бота + 9-шаговая инструкция (🟡 ЛОКАЛЬНО, НЕ ЗАДЕПЛОЕНО, НЕ ЗАКОММИЧЕНО)

> **СТАТУС: всё проверено на localhost (порт dev-сервера обычно `3099`), но в прод НЕ выкачено и в git НЕ закоммичено.** По указанию пользователя оставлено локально. Когда дашь «деплой» — выкатывать **web (авто по push) + Guide-контейнер (вручную, см. грабли) + оба бота (TG+VK — передеплой, чтобы подхватили one-tap)**.

### Главное открытие: Roblox API доступен НАПРЯМУЮ с RF
Проверено curl'ом с `root@89.110.94.117` и через прод-контейнер сайта: `users/games/apis.roblox.com/thumbnails/multiget-playability-status` и даже `apis.roblox.com/.../places/{id}/universe` отвечают **200 за ~0.3–1.5с**. Это **отменяет** старую причину Singapore-моста («Roblox заблокирован в РФ с DC-IP»). Поэтому поиск геймпассов на сайте сделан **напрямую** (`src/lib/roblox.ts`, без моста). Перепроверяй curl'ом — доступность может меняться.

### Что сделано (1 файл фронта + 2 API + 1 миграция + 2 бота)
**Поток для пользователя теперь:** код → бот собирает контакты (provisional order) → бот шлёт на сайт-инструкцию (кнопка, привязана к коду) → на сайте пользователь **ищет геймпасс по нику прямо на странице** и выбирает его → бот предлагает **выкуп в один тап**.

1. **Сайт — `src/app/guide/WBInstructionV2.tsx`** (вся WB-инструкция, ~600 строк, scoped CSS `wbi-`):
   - **Инструкция теперь 10 шагов** (было 8): `1` Creator Hub · `2` найди игру · `3` сделай Public · `4` открой раздел Passes · `5` нажми Create Pass · `6` заполни форму пасса · `7` **открой пасс → ☰ → Sales** (навигация по видео) · `8` впиши цену и сохрани (Sales) · `9` найди по нику · `10` зачем нужен бот.
   - **Шаг 8 — живой поиск по нику + гейт верификации:** инпут ника → `GET /api/roblox/gamepasses?query=` → 5 веток (нет юзера / нет пассов / не та цена / совпало → карточки выбора / привязан). Поиск **разблокируется только после галочки «плейс Public»** (1 чек-бокс). Managed pricing понижен до напоминания (по умолчанию off у новых пассов).
   - **One-tap handoff:** при выборе пасса на сайте → `POST /api/wb-code/select-gamepass` пишет `selectedGamepassId`+`robloxNick` в `WbCode`. (В test-режиме запись пропускается.)
   - **Скрины Roblox из видео/фото:** нарезаны ffmpeg (см. ниже), обводки — CSS-слой (`.wbi-anno`/`.wbi-box`/`.wbi-tip`), живая цена `.wbi-price6` поверх примера. Ассеты: `public/guide/wb-step5-createbtn.png` (кнопка Create Pass), `wb-step5-create.png` (форма), `wb-step7-menu.png` (боковое меню → Sales), `wb-step6-sales.png` (вкладка Sales). Исходник навигации — видео `~/Downloads/ScreenRecording_06-22-2026 07-14-30_1.MP4`. **Скрины держать близко к оригиналу телефонного скрина (не тесный кроп) — предпочтение пользователя.** Позиции обводок выверять рендером Playwright.
   - Старые ассеты `wb-step6-price.png`, `wb-step5-regional.png` больше не используются (можно удалить).

2. **API:**
   - `POST /api/wb-code/select-gamepass` `{code,gamepassId,nick}` — пишет выбор в `WbCode` (advisory: бот всё равно валидирует).
   - `GET /api/roblox/gamepasses` — добавлен флаг `userExists` (отличить «ника нет» от «есть, но без пассов»). Ходит напрямую в Roblox.

3. **БД:** `WbCode` + `selectedGamepassId String?`, `robloxNick String?`. Миграция `prisma/migrations/20260622_add_wbcode_gamepass_selection` — **уже применена к Neon** (`prisma migrate deploy`, additive/nullable, безопасно). `prisma generate` сделан.

4. **Боты — one-tap (через существующий `gp_pick` пайплайн, валидация не тронута):**
   - TG `bots/tg/handlers.ts`: helper `offerPreselectedGamepass()` в 3 точках приветствия (provisional welcome, /start с активным заказом, restore-state). Если у кода есть `selectedGamepassId` → карточка `[✅ Да, выкупаем]` вместо «введи ник».
   - VK `bots/vk/handlers.ts`: helper `vkOfferPreselectedGamepass()` в 2 точках (handleRefActivation welcome, restore «restored»).

### Инструмент: нарезка видео/кадров
ffmpeg нет в системе → ставлю `imageio-ffmpeg` в venv `/tmp/vidvenv` (бинарь `…/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1`). PIL есть (детект позиций кнопок/полей). Синий **текст-ссылка** ловится как синяя **кнопка** — отделять кнопку по плотности заливки.

### Осталось / на потом
- Деплой (по команде пользователя). Re-крон шагов 6/7 повыше (ближе к оригиналу) — опционально, пользователь спросит.

### ⚠️ Деплой-грабли (критично)
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
- **При деплое one-tap (текущая сессия): передеплоить и оба бота** — TG_bot (`lyz78enntugna9em1biopinr`, SG) и VK_bot (`gmtpfqosgoz23vjyxyczuic9`, RF), иначе они не будут читать `WbCode.selectedGamepassId`. Миграция Neon уже применена.

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
│   │   ├── guide/GuideClient.tsx     ← роутер фаз коридора WB (intro/gate/instruction)
│   │   ├── guide/WBInstructionV2.tsx ← 9-шаговая WB-инструкция + поиск по нику + гейт (scoped wbi-)
│   │   ├── api/wb-code/route.ts      ← резервирование/статус кода
│   │   ├── api/wb-code/select-gamepass/route.ts ← сохраняет выбор геймпасса с сайта (one-tap)
│   │   ├── api/roblox/gamepasses/route.ts ← поиск геймпассов по нику (напрямую в Roblox с RF)
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
│   │   ├── roblox.ts                 ← валидация геймпасса (4 эндпоинта) + resolveRobloxUserId/listForSaleGamepasses
│   │   ├── gamepass-search.ts        ← поиск по нику (searchGamepassesByNick → union: user_not_found/no_gamepasses/ok)
│   │   └── bridge.ts                 ← HTTP-сервер на Singapore VPS (Roblox теперь доступен и с RF)
│   ├── tg/
│   │   ├── handlers.ts               ← весь TG бот (~3200 строк) + offerPreselectedGamepass (one-tap)
│   │   ├── session.ts                ← in-memory: pendingLink, pendingRobloxNick, pendingReview
│   │   └── admin/                    ← TG admin hub (orders, stats, WB, system, rates)
│   └── vk/
│       ├── handlers.ts               ← весь VK бот (~1900 строк) + vkOfferPreselectedGamepass (one-tap)
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
| `selectedGamepassId` | Геймпасс, выбранный на сайте (поиск по нику) → бот предлагает one-tap. Добавлено 2026-06-22 |
| `robloxNick` | Ник, с которым искали на сайте (сидит в `WbOrder.robloxUsername`). Добавлено 2026-06-22 |

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
   - даёт КНОПКУ на инструкцию: /guide?source=wb&skip=1&code=КОД
   - ⭐ если в WbCode уже есть selectedGamepassId (выбрал на сайте) →
     offerPreselectedGamepass(): карточка [✅ Да, выкупаем] (one-tap), шаги 5-6 пропускаются
5. Пользователь проходит 9-шаговую инструкцию, создаёт геймпасс на create.roblox.com
6. ВАРИАНТ А (новый, основной): на сайте (шаг 8) вводит ник → поиск через
   /api/roblox/gamepasses → выбирает пасс → POST /api/wb-code/select-gamepass →
   открывает бота → one-tap [✅ Да].  ВАРИАНТ Б: пишет ник/ссылку/Asset ID прямо в бот.
7. Бот валидирует (любой вариант идёт в processGamepassSubmission):
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
- Историческая причина: Roblox API и api.telegram.org были заблокированы в России с DC IP. **⚠️ На 2026-06-22 Roblox API снова отвечает напрямую с RF** (см. секцию вверху) — мост для Roblox-поиска больше не обязателен, но api.telegram.org через `/tg-proxy` всё ещё актуален для VK-бота. Перед изменениями перепроверяй curl'ом.

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
- ✅ ~~**Поиск геймпасса по нику**~~ — сделано в ботах (gamepass-search.ts) и на сайте (шаг 8, 2026-06-22, локально)
- ✅ ~~**Передача выбранного геймпасса с сайта в бота (one-tap)**~~ — WbCode.selectedGamepassId (2026-06-22, локально)
- [ ] **Web push уведомления** когда менеджер выкупил — пользователь не всегда смотрит в бот
- [ ] **Возможный refactor:** раз Roblox доступен с RF — VK-бот может отказаться от моста для Roblox-вызовов (мост оставить для TG-proxy если нужно)
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
