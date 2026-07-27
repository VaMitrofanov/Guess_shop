# RobloxBank — документация

Сервис выкупа Robux у российских пользователей. Клиент покупает карту на Wildberries,
на вкладыше — 7-символьный код. Он активирует код на сайте, попадает в Telegram- или
VK-бота, создаёт геймпасс в Roblox, менеджер его выкупает — клиент получает деньги.
Ключевая бизнес-цель: приучить клиента заказывать **повторно прямо в боте**, а не через WB.

> **Секреты, доступы к серверам и деплою** намеренно НЕ в этом репозитории (он публичный).
> Операционная информация — в локальном `HANDOFF.md` (в `.gitignore`).

## 👉 Начинать отсюда

**[launch-roadmap.md](launch-roadmap.md) — глобальный план запуска и единая точка входа.**
Где мы сейчас, что осталось до открытия, с чего начинать следующую сессию и какой документ
читать под каждый вопрос. Все остальные файлы — детализация отдельных участков.

## Карта документации

| Файл | О чём |
|------|-------|
| [launch-roadmap.md](launch-roadmap.md) | **Главный документ**: состояние запуска, что осталось (технические волны + внешние гейты + хвосты владельца), точка входа следующей сессии, карта всех планов |
| [architecture.md](architecture.md) | Обзор системы, стек, три канала как единая экосистема, поток данных |
| [b2b-saas.md](b2b-saas.md) | Партнёрское/B2B-направление: TWA/server MVP `Антон`, USDT-ledger, ручной XLSX import, rollout Sheets/batch |
| [corridor-and-site.md](corridor-and-site.md) | WB-гейт, сайт `/guide`, API коридора, восстановление сессии |
| [site-acquiring-master-plan.md](site-acquiring-master-plan.md) | Ультра-ревью `robloxbank.ru`, P0-блокеры эквайринга, единые цена/identity/orders, дизайн и поэтапный launch plan |
| [site-launch-implementation-plan.md](site-launch-implementation-plan.md) | Согласуемый план 18.07: baseline, обязательная регистрация перед оплатой, полноценный ЛК, controlled rollout, WB→сайт→бот/группа и боевой E2E |
| [auth-account-readiness-plan.md](auth-account-readiness-plan.md) | ЛК/login/register и email/TG/VK identity: Brevo SMTP в production, Gmail verification принят; Mail.ru ждёт пересмотра антиспам-блокировки |
| [roblox-codes-plan.md](roblox-codes-plan.md) | Новый товар: коды активации Roblox — прайс, честные 10–15 мин → «моментально» через буфер, безопасность предъявительских кодов, ККТ/юр-гейты и этапы K0–K9 |
| [email-setup.md](email-setup.md) | Почта `robloxbank.ru`: Brevo SMTP relay на порту 2525 работает в production; DNS принят, Gmail принят, Mail.ru appeal на рассмотрении |
| [tbank-precheck-2026-07-17.md](tbank-precheck-2026-07-17.md) | Предрелизный аудит публичной ссылки для Т‑Банка 17.07: фактические тесты, найденные блокеры и план закрытия |
| [design-rework-concept.html](design-rework-concept.html) | Интерактивный визуальный концепт глобального реворка главной и mobile-first WB guide |
| [twa-ux-v3-concept.html](twa-ux-v3-concept.html) | Визуальный концепт TWA v3: два варианта Главной, умная выдача и foreground bottom sheet |
| [bots.md](bots.md) | TG- и VK-боты: активация, приём геймпасса, прямые заказы, поддержка, отзывы |
| [twa-admin.md](twa-admin.md) | Единая admin-экосистема: desktop `/admin`, Telegram TWA, общий `WbOrder`, досье и журнал |
| [twa-design-redesign-plan.md](twa-design-redesign-plan.md) | Контракт редизайна TWA: навигация, поиск, compact cards/history, прибыль и Premium Calm для Аккаунта/Заказов |
| [database.md](database.md) | Модели Prisma и статусы заказов/кодов |
| [payments-and-kkt.md](payments-and-kkt.md) | Эквайринг, outbox worker, refund и ККТ test matrix |
| [deploy.md](deploy.md) | Как деплоится каждый сервис (без секретов) |
| [security.md](security.md) | Модель угроз, известные риски, что проверять перед прод-изменениями |
| [ultra-review-2026-07-25.md](ultra-review-2026-07-25.md) | Сплошное ревью кода 25.07: 18 находок (P0 — обход входа в TWA и обход rate-limit), план фикса и приёмка по каждой, порядок волн |
| [ultra-review-2026-07-28.md](ultra-review-2026-07-28.md) | Ревью перед открытием сайта 28.07: безопасность/работоспособность/мобильный дизайн, 6 блокеров запуска и детальный план реализации по волнам 0–5 |
| [trello-workflow.md](trello-workflow.md) | Правила работы с Trello: понятные карточки, техническая расшифровка и статусы |
| [roblox-plus-buyout-plan.md](roblox-plus-buyout-plan.md) | Транспорт выкупа ГП: почему серверный fetch не проходит chef, браузерный скрипт покупки и его гарды; Roblox Plus 10–20% — классификация и пачка |

## Три канала — единая экосистема

- **Сайт** `robloxbank.ru/guide?source=wb` — точка входа с WB, инструкция.
- **TG-бот** `@RobloxBankBot` — основной рабочий канал.
- **VK-бот** `vk.me/club237309399` — альтернатива для VK-аудитории (воркфлоу идентичен TG).
- **Desktop `/admin`** — Control Center для общей очереди, платежей, досье и audit-журнала.
- **TWA** — мобильный Action Center внутри Telegram для защищённых операций менеджера.

Публичный корень `robloxbank.ru` открыт 17.07 для предварительного просмотра Т‑Банком;
WB-гайд остаётся отдельной рабочей точкой входа. Новый checkout использует канонический
`WbOrder`/quote/payment-attempt; outbox worker, refund и локальная ККТ contract matrix
готовы, но боевой payment E2E ещё не выполнен. 18.07 перед вводом production credentials
снят baseline и production acquiring принудительно возвращён в `false`. Новый gate требует
одновременно master flag и явный режим `off|allowlist|percentage|on`, поэтому сайт сейчас
не может создать `Init` и принять деньги —
см. [architecture.md](architecture.md#legacy) и
[master plan эквайринга](site-acquiring-master-plan.md).

С 16.07 публичный shell имеет custom 404/error recovery, корректные SEO/noindex-границы,
PII-safe Core Web Vitals/client-error telemetry и read-only `npm run smoke:site`. Web и
отдельный Guide-контейнер после rollout `b6b699f` отдают общий source fingerprint
`20183b40b8783d9c`; corridor-smoke `29/29`. Quick-fix batch для банковской ссылки добавил
runtime payment-disabled state, платёжные логотипы, registration consent, mobile legal fix
и актуальный public copy. 19.07 VK ID переведён на официальный SDK 2.6.6 и прямой popup
вместо зависавшего скрытого OneTap; gate остаётся fail-closed, а полный real-account
callback — ручным acceptance-пунктом. Corridor-smoke
автоматически обнаруживает будущий drift. Это закрывает storefront hardening, но не заменяет реальные
TG/VK/iPhone/Android acceptance, реквизиты, ККТ/payment E2E и soft launch.

Личный кабинет и все три поверхности входа используют общий Violet/Frost shell. Email-вход
нормализует адрес, Telegram login/link идёт через одноразовый bot-assisted challenge с
серверной HMAC-проверкой, а VK identity проверяется сервером; публичность VK-кнопки
управляется отдельным fail-closed build gate.
Повторный аудит и batch 18.07 добавили verification/resend, password reset, versioned
consent evidence и отзыв JWT после смены пароля; токены в БД только hash. До публичного
email recovery остаются SMTP/DNS и живая доставка; live TG/VK acceptance вынесен в
[план готовности](auth-account-readiness-plan.md).

Текущий implementation batch добавляет сохранение checkout draft через обязательный
login/register, same-origin return guard, per-user rollout, активный order timeline в ЛК и
`/payment/status` как основную страницу подтверждения. Desktop `/admin` и TWA объединены
вокруг `WbOrder`: широкий обзор/журнал дополняет мобильные protected actions без второй
копии payment-логики. Детальный порядок до боевого включения и целевой WB flow зафиксированы
в [плане запуска 18.07](site-launch-implementation-plan.md).

19.07.2026 в desktop Control Center увеличена типографика всех рабочих поверхностей
(навигация, карточки, таблицы, журнал, health и досье), чтобы оператору не приходилось
масштабировать браузер. Правила платёжной безопасности и контракты API не изменялись.

С 19.07 paid-state `/payment/status` завершает post-purchase loop: предлагает персональные
уведомления через связанный Telegram и добровольную подписку/диалог в TG или VK. Переходы
видны в admin-журнале как обезличенные channel-intent события; выдача заказа от подписки
не зависит.

**28.07.2026 проведено ревью перед открытием сайта.** Платёжное ядро, возвраты, вход в TWA
и rate-limit подтверждены как надёжные; гейты зелёные (`jest` 323/323, `smoke:site` 15/15).
Но открывать сайт пока нельзя: найдено шесть блокеров — необработанный outbox-топик
`web.order.created` (каждый заказ даёт ложную тревогу `DEAD-LETTER`, подтверждено на проде
4/4), намертво зашитый в подвале текст «приём платежей отключён», `enabled:false` для любого
гостя даже в режиме `on`, отсутствие входа в ЛК на планшетах 768–1023 px, белый текст на белом
фоне в мобильном меню тёмной темы и отставший Guide-контейнер. Отдельно: вся тёмная тема
включается только после гидратации, поэтому первый кадр на мобильном всегда в чужой теме.
Полный разбор, доказательства и детальный план по волнам 0–5 —
[ultra-review-2026-07-28.md](ultra-review-2026-07-28.md).

**26.07.2026 все 18 находок ревью закрыты кодом и задеплоены.** Вход в TWA больше не
выдаётся по публичному Telegram ID (подписанный ботом токен запуска + проверка членства на
каждом запросе + TTL 2 ч), rate-limit считает клиента по honest-hop от нашего Traefik,
бонус и скидка возвращаются на всех исходах неудачной оплаты, кнопки ботов проверяют
владельца заказа, чек при возврате остатка формируется корректно, legacy-слой магазина и
~1180 строк мёртвого UI удалены, у ботов появились проверка типов и тесты, а линтер снова
работает как гейт. Статус по каждой находке и что осталось за владельцем —
[ultra-review-2026-07-25.md](ultra-review-2026-07-25.md).

25.07.2026 проведено сплошное ревью кодовой базы. Платёжное ядро, изоляция donor-cookie и
admin-гейты подтверждены как надёжные, но найдены два P0, которые нужно закрыть **до**
любого расширения публичного доступа: обходной Path 2 при выдаче admin-токена TWA и полный
обход rate-limit через подделку `cf-connecting-ip` (заголовку доверяют с времён
Cloudflare-туннеля, которого больше нет). Также подтверждено, что Guide-контейнер в проде
отстаёт от Web, а бонусы клиента сгорают при неудачной оплате без компенсации. Полный
список из 18 находок с планом реализации и критериями приёмки —
[ultra-review-2026-07-25.md](ultra-review-2026-07-25.md); риски заведены в
[security.md](security.md) под номерами 24 и 25 и обновили риски 1 и 2.

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
