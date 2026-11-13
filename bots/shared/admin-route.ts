/* ─────────────────────────────────────────────────────────────────────────────
   Куда идут уведомления админам (14.11.2026).

   Раньше каждое уведомление уходило КАЖДОМУ админу в личку — 3–4 сообщения
   на заказ, все со звуком, важное тонуло в «код активирован» и «выкуп
   подтверждён». Владелец: «всю инфу всегда в беседу», разложить по темам,
   прямые заказы и отзывы — отдельно, в личку не дублировать.

   Для уведомлений — ОТДЕЛЬНАЯ беседа-форум (решение владельца 14.11.2026): старая
   беседа остаётся для разговоров админов и ИИ-воркера, а сюда только сыплются
   уведомления по темам. Назначается командой /notify_setup в новой беседе; id и
   темы — `WbSyncCursor` stream `admin-notify` (`cursor` — chat id,
   `metadata.topics`). Недостающие темы бот создаёт сам при старте.

   Правила:
   • тема выбирается по смыслу (`topicForNotice`: зона + срочность), а не по
     тому, какой модуль прислал;
   • звук — только там, где нужен человек: 🟠 и 🔴. 🔵🟡🟢⚫️ приходят тихо;
   • беседа не настроена или темы нет — личка, как раньше: уведомление о
     деньгах не имеет права потеряться из-за оформления;
   • тему можно выключить (`metadata.adminRouteOff`), не трогая код, — так
     потом и уберём лишнее, когда консультировать будет ИИ-воркер.

   Ключ получателя (`target.key`) — то, под чем живые карточки и корни веток
   запоминают свой `message_id`: в личке это id админа (как было), в беседе —
   `<chat>#<тема>`. Поэтому ответ на корень пришивается только внутри той же
   темы: отвечать на сообщение из чужой темы Telegram не обязан.
   ───────────────────────────────────────────────────────────────────────── */

export type AdminTopic =
  | "cases"    // 📌 Особые заказы
  | "direct"   // 🛒 Прямые заказы (бот, сайт — всё не через WB)
  | "action"   // 🔥 Нужно действие
  | "buyout"   // 💸 К выкупу
  | "reviews"  // ⭐ Отзывы и вопросы
  | "feed"     // 📦 Лента заказов (тихо)
  | "system";  // 🚨 Система

/**
 * Название темы, цвет иконки (из палитры Telegram) и звук по умолчанию.
 * Порядок = порядок создания (владелец: особые заказы первыми, потом прямые).
 */
export const ADMIN_TOPICS: Record<AdminTopic, { title: string; color: number; silent: boolean; hello: string }> = {
  cases: { title: "📌 Особые заказы", color: 0xFF93B2, silent: false, hello: "Договорённости и особые случаи по заказам — то, что должны знать все админы." },
  direct: { title: "🛒 Прямые заказы", color: 0xFFD67E, silent: false, hello: "Всё по прямым заказам — бот и сайт, без WB: заявки, скриншоты оплаты, карточки к выкупу, отмены." },
  action: { title: "🔥 Нужно действие", color: 0xFB6F5F, silent: false, hello: "Только то, где нужен человек: код не дошёл, возврат открыт, пасс подменили, нет плейса, обращения покупателей. Всё остальное — в «📦 Лента заказов»." },
  buyout: { title: "💸 К выкупу", color: 0x8EEE98, silent: false, hello: "Карточки заказов WB к выкупу с кнопками «Выкупить», «ВЫКУПЛЕНО», «ОШИБКА». Прямые заказы — в «🛒 Прямые заказы»." },
  reviews: { title: "⭐ Отзывы и вопросы", color: 0xCB86DB, silent: false, hello: "Отзывы и вопросы с Wildberries, скриншоты отзывов за бонус." },
  feed: { title: "📦 Лента заказов", color: 0x6FB9F0, silent: true, hello: "Тихая лента: код активирован, карточки DBS (правятся на месте), покупатель нашёлся, выкуп подтверждён. Делать ничего не нужно — звук можно выключить." },
  system: { title: "🚨 Система", color: 0xFB6F5F, silent: true, hello: "Упал бот, сервер, токены WB, кончаются карточки. Звук — только на срочном." },
};

export const ADMIN_TOPIC_KEYS = Object.keys(ADMIN_TOPICS) as AdminTopic[];

type Marker = "progress" | "waiting" | "action" | "urgent" | "done" | "cancelled";
type Zone = "DBS" | "ПРЯМОЙ" | "WB" | "САЙТ" | "ВЫКУП" | "ОТЗЫВ" | "ПОДДЕРЖКА" | "СИСТЕМА";

/** Срочность, при которой нужен человек — и звук. */
export const isLoud = (marker: Marker): boolean => marker === "action" || marker === "urgent";

/**
 * Тема по смыслу уведомления. Прямые заказы, отзывы, поддержка и система —
 * всегда в своей теме, какой бы ни была срочность; всё остальное: нужен
 * человек → «Нужно действие», автоматика работает → тихая «Лента».
 */
export function topicForNotice(n: { marker: Marker; zone: Zone }): AdminTopic {
  if (n.zone === "ПРЯМОЙ") return "direct";
  if (n.zone === "ОТЗЫВ") return "reviews";
  if (n.zone === "СИСТЕМА") return "system";
  // Обращения покупателей (кнопка поддержки, «застрял») — человек нужен, если
  // позвали; «застрял» без просьбы о помощи — тихо в ленту.
  return isLoud(n.marker) ? "action" : "feed";
}

export interface AdminTarget {
  /** Ключ для карт `{ ключ: messageId }` (живые карточки, корни веток). */
  key: string;
  chatId: string;
  /** В беседе: тема и звук. Подмешивать в extra отправки. */
  extra: Record<string, unknown>;
  /** Это беседа: кнопки `web_app` туда нельзя, их надо заменить ссылкой. */
  group: boolean;
}

interface RouteConfig { chatId: string | null; topics: Partial<Record<string, number>>; off: string[] }

type CursorDb = { wbSyncCursor: { findUnique(args: { where: { stream: string } }): Promise<{ cursor: string | null; metadata: unknown } | null> } };

export const ADMIN_NOTIFY_STREAM = "admin-notify";

/**
 * База, из которой читаются настройки беседы. Регистрируется один раз при
 * загрузке клиента Prisma (`bots/shared/db.ts`, `src/lib/prisma.ts`), чтобы
 * общие модули (DBS, выкуп) не таскали её в каждый вызов. Нет базы — личка.
 */
let routeDb: CursorDb | null = null;
export function registerAdminRouteDb(db: unknown): void {
  routeDb = db as CursorDb;
}
const CACHE_MS = 60_000;
let cache: { at: number; cfg: RouteConfig } | null = null;

/** Настройки беседы из базы, с минутным кэшем. Никогда не бросает. */
export async function loadAdminRoute(force = false): Promise<RouteConfig> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.cfg;
  let cfg: RouteConfig = { chatId: null, topics: {}, off: [] };
  if (!routeDb) return cfg;
  try {
    const row = await routeDb.wbSyncCursor.findUnique({ where: { stream: ADMIN_NOTIFY_STREAM } });
    const meta = (row?.metadata ?? {}) as { topics?: Record<string, number>; adminRouteOff?: string[] };
    cfg = {
      chatId: row?.cursor && /^-?\d+$/.test(row.cursor) ? row.cursor : null,
      topics: meta.topics ?? {},
      off: Array.isArray(meta.adminRouteOff) ? meta.adminRouteOff : [],
    };
  } catch { /* база недоступна — личка */ }
  cache = { at: Date.now(), cfg };
  return cfg;
}

/** Сбросить кэш (после создания тем). */
export function resetAdminRouteCache(): void { cache = null; }

function adminIds(): string[] {
  return [...new Set((process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
}

/**
 * Кому отправить уведомление темы `topic`.
 *
 * Беседа и тема есть → один получатель (беседа, нужная тема). Тема выключена →
 * никому (пустой список). Иначе — каждый админ в личку, как до 14.11.2026.
 * `loud` — звук: по умолчанию по теме, явное значение побеждает.
 */
export async function adminTargets(
  topic: AdminTopic,
  opts: { loud?: boolean } = {},
): Promise<AdminTarget[]> {
  const cfg = await loadAdminRoute();
  if (cfg.off.includes(topic)) return [];
  const thread = cfg.topics[topic];
  if (cfg.chatId && thread) {
    const silent = opts.loud === undefined ? ADMIN_TOPICS[topic].silent : !opts.loud;
    return [{
      key: `${cfg.chatId}#${thread}`,
      chatId: cfg.chatId,
      extra: { message_thread_id: thread, ...(silent ? { disable_notification: true } : {}) },
      group: true,
    }];
  }
  return adminIds().map((id) => ({ key: id, chatId: id, extra: {}, group: false }));
}

/** Тема и звук по уведомлению — одна строка на месте вызова. */
export function adminTargetsForNotice(n: { marker: Marker; zone: Zone }): Promise<AdminTarget[]> {
  return adminTargets(topicForNotice(n), { loud: isLoud(n.marker) });
}

/** Chat id по ключу получателя (`<chat>#<тема>` или id админа). */
export function chatOfKey(key: string): string {
  return key.split("#")[0];
}

/** Ответ на корень ветки — только если корень в той же теме (тот же ключ). */
export function replyToRootFor(roots: Record<string, number> | null | undefined, target: AdminTarget): Record<string, unknown> {
  const rootId = roots?.[target.key];
  return rootId ? { reply_to_message_id: rootId, allow_sending_without_reply: true } : {};
}

const BOT_USERNAME = "RobloxBankBot";

/**
 * Кнопки под беседу. `web_app` Telegram пускает только в личку — в беседе
 * сообщение с ним не уйдёт вовсе. Меняем на ссылку `t.me/<бот>?startapp=<код>`:
 * она открывает главное мини-приложение бота (BotFather → Main Mini App), и
 * TWA сам открывает заказ по коду. Вход — по initData нажавшего, так что одна
 * кнопка годится всем админам. Код берём из `?q=` старой ссылки.
 */
export function groupSafeMarkup(markup: unknown, target: AdminTarget): unknown {
  if (!target.group || !markup || typeof markup !== "object") return markup;
  const kb = (markup as { inline_keyboard?: unknown[][] }).inline_keyboard;
  if (!Array.isArray(kb)) return markup;
  const rows = kb.map((row) => (Array.isArray(row) ? row : []).map((btn) => {
    const b = btn as { text?: string; web_app?: { url?: string } };
    if (!b?.web_app) return btn;
    let code = "";
    try { code = new URL(String(b.web_app.url)).searchParams.get("q") ?? ""; } catch { /* битая ссылка */ }
    return code && /^[A-Za-z0-9_-]{1,64}$/.test(code)
      ? { text: b.text, url: `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(code)}` }
      : null;
  }).filter(Boolean)).filter((row) => row.length > 0);
  return { ...(markup as object), inline_keyboard: rows };
}
