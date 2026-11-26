/* ─────────────────────────────────────────────────────────────────────────────
   Воркер разметки чатов поддержки @RobloxBank_PA (12.11.2026).

   Аккаунт подключён как ещё одно устройство (GramJS, сессия в `PA_SESSION`).
   Раз в 5 минут: личные чаты за 30 дней → покупатель по `User.tgId` → заказы
   → метка в имени контакта и папка (`bots/shared/pa-desk.ts`).

   Бот НИКОМУ НЕ ПИШЕТ — только переименовывает контакты и раскладывает чаты:
   массовые действия от пользовательского аккаунта Telegram банит, поэтому
   за проход — не больше `RENAME_CAP` переименований, с паузой.

   С 13.11.2026 ещё: папка «⏰ Без ответа» (последнее слово покупателя, ждёт
   дольше `WAIT_MIN`), раз в сутки — время ответа поддержки за вчера
   (`pa-response-stats.ts`, курсор `pa-response`) и при старте — проверка
   профиля (приветствие, «нет на месте», часы, быстрые ответы, порядок папок)
   в лог и курсор `pa-profile`.

   Включение: `PA_API_ID`, `PA_API_HASH`, `PA_SESSION` в env TG-бота;
   `PA_DESK=off` — выключить, `PA_DESK=dry` — только писать в лог, что сделал бы.
   ───────────────────────────────────────────────────────────────────────── */

import { redactWbChatText } from "../shared/wb-delivery-crypto";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import type { Dialog } from "telegram/tl/custom/dialog";
import { db } from "../shared/db";
import { setAdminDm } from "../shared/admin-route";
import { openFlags } from "../shared/order-flags";
import { DESK_FOLDERS, answeredByReaction, badReviewMark, deskDecision, heartTarget, isThanksLike, nextContactName, type DeskFolder, type DeskOrder } from "../shared/pa-desk";
import { BAD_REVIEW_STARS_SQL } from "../shared/vk-dialog-labels";
import { CODE_PIN_STATUS, pinText, pinWorthCreating, type PinOrder } from "../shared/pa-pin";
import { chatTurns, formatResponseStats, summarizeTurns, type ChatMsg, type ResponseStats } from "./pa-response-stats";
import { CODE_VIAS } from "../shared/order-contacts";
import { ocrImageBufferText } from "../shared/pending-ocr";
import { RATING_CAP, loadAskedMap, ratingDue, recordRatingAsked } from "../shared/pa-rating";
import { aiWeeklyReport } from "../shared/support-ai-log";

/** Кто отправляет вопрос об оценке — регистрирует обработчик Business (у него подключение). */
let ratingSender: ((tgId: string) => Promise<boolean>) | null = null;
export function setPaRatingSender(fn: (tgId: string) => Promise<boolean>): void {
  ratingSender = fn;
}

/**
 * ⭐ Тихая оценка (17.11.2026): чаты, где последним ответили мы больше часа
 * назад, а покупатель писал в течение суток до этого. Правило — `ratingDue`.
 */
async function askRatings(tg: TelegramClient, dialogs: Dialog[], mode: Mode): Promise<void> {
  if ((process.env.PA_RATING ?? "").trim().toLowerCase() === "off" || !ratingSender) return;
  const asked = await loadAskedMap(db);
  const nowS = Math.floor(Date.now() / 1000);
  const sent: string[] = [];
  for (const d of [...dialogs].sort((a, b) => (b.date ?? 0) - (a.date ?? 0))) {
    if (sent.length >= RATING_CAP) break;
    const last = d.message;
    if (!last || !last.out) continue;
    const tgId = String((d.entity as Api.User).id);
    const quick = { last: { out: true, date: last.date, text: last.message ?? "", viaBot: false }, lastIncoming: last.date };
    if (!ratingDue(quick, asked[tgId], nowS)) continue;
    // Было ли обращение: последнее входящее среди свежих сообщений.
    const msgs = await tg.getMessages(d.entity as Api.User, { limit: 15 }).catch(() => []);
    const incoming = msgs.find((m) => !m.out);
    const tail = { last: quick.last, lastIncoming: incoming?.date ?? null };
    if (!ratingDue(tail, asked[tgId], nowS)) continue;
    if (mode === "dry") { console.log(`[pa-rating] (dry) спросили бы оценку в чате ${tgId}`); continue; }
    if (await ratingSender(tgId)) sent.push(tgId);
    await sleep(1500);
  }
  if (sent.length) {
    await recordRatingAsked(db, sent);
    console.log(`[pa-rating] спросили оценку: ${sent.length}`);
  }
}

const WINDOW_DAYS = 30;
/** «Новые» — только те, кто писал за неделю: старый незнакомец уже не новый. */
const NEW_WINDOW_DAYS = 7;
const RENAME_CAP = 20;
/** Чатов в одной папке у Telegram Premium — до 200; держим запас. */
const FOLDER_CAP = 150;
/** Сколько старых чатов убираем в архив за проход. */
const ARCHIVE_CAP = 100;
/**
 * Цвет папки (0 красный, 1 оранжевый, 2 фиолетовый, 3 зелёный, 4 бирюзовый, 5 синий,
 * 6 розовый). Без цвета Telegram НЕ показывает тег папки под чатом во «Все» (13.11.2026:
 * тег был только у «Проблем», которой цвет поставили руками). Цвет, выбранный
 * оператором в приложении, сохраняем.
 */
const FOLDER_COLOR: Record<DeskFolder, number> = { NEW: 5, QUEUE: 2, PROBLEM: 1, DONE: 3, REVIEW: 6 };
/**
 * «⏰ Без ответа» — не этап заказа, а «кому мы должны ответить»: последнее
 * сообщение в чате от покупателя, ждёт дольше `WAIT_MIN` и не старше `WAIT_MAX_H`.
 * Свой id вне `DESK_FOLDERS`: чат одновременно и в папке по заказу.
 */
const WAIT_FOLDER = { id: 206, title: "⏰ Без ответа", color: 0 };
const WAIT_MIN = 15;
const WAIT_MAX_H = 72;
const MSK = 3 * 3600_000;

type Mode = "off" | "dry" | "on";

export function paDeskMode(env: NodeJS.ProcessEnv = process.env): Mode {
  if (!env.PA_SESSION || !env.PA_API_ID || !env.PA_API_HASH) return "off";
  const flag = (env.PA_DESK ?? "").trim().toLowerCase();
  return flag === "off" ? "off" : flag === "dry" ? "dry" : "on";
}

let client: TelegramClient | null = null;

/** Тот же клиент аккаунта для других задач (одна сессия — одно подключение). */
export async function paDeskClient(): Promise<TelegramClient> {
  return getClient();
}

async function getClient(): Promise<TelegramClient> {
  if (client?.connected) return client;
  client = new TelegramClient(
    new StringSession(process.env.PA_SESSION!.trim()),
    Number(process.env.PA_API_ID),
    process.env.PA_API_HASH!.trim(),
    { connectionRetries: 5, deviceModel: "RobloxBank Support Desk", appVersion: "1.0", systemVersion: "server" },
  );
  client.setLogLevel("error" as never);
  await client.connect();
  return client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const titleOf = (f: DeskFolder) => `${DESK_FOLDERS[f].emoticon} ${DESK_FOLDERS[f].title}`;

export interface PaDeskResult {
  chats: number;
  linked: number;
  renamed: number;
  folders: Record<DeskFolder, number>;
  waiting: number;
  foldersUpdated: number;
  archived: number;
  pinsCreated: number;
  pinsUpdated: number;
}

let profileAudited = false;

export async function runPaDeskSweep(mode: Mode = paDeskMode()): Promise<PaDeskResult | null> {
  if (mode === "off") return null;
  const result = await sweepOnce(mode);
  // Тем же проходом и по очереди (одно подключение аккаунта): проверка профиля —
  // один раз за запуск; время ответа за вчера — раз в сутки (функция помнит день).
  if (!profileAudited) {
    profileAudited = true;
    if (mode === "on") await tidyPaProfile().catch((e) => console.warn("[pa-profile] порядок/био:", e instanceof Error ? e.message : e));
    await auditPaProfile().catch((e) => console.warn("[pa-profile]", e instanceof Error ? e.message : e));
    await registerPaDm().catch((e) => console.warn("[pa-dm]", e instanceof Error ? e.message : e));
  }
  await runPaResponseStats().catch((e) => console.warn("[pa-response]", e instanceof Error ? e.message : e));
  // Раз в неделю: новые диалоги для разбора ИИ (сама решает, пора ли; проверка — одно чтение строки).
  await exportPaDialogs().catch((e) => console.warn("[pa-export]", e instanceof Error ? e.message : e));
  return result;
}

async function sweepOnce(mode: Mode): Promise<PaDeskResult> {
  const tg = await getClient();
  const now = Date.now() / 1000;
  const all = await tg.getDialogs({ limit: 1000 });
  const dialogs = all.filter((d: Dialog) =>
    d.isUser && d.entity instanceof Api.User && !d.entity.bot && !d.entity.self && d.date && now - d.date < WINDOW_DAYS * 86_400);
  // Порядок: личные чаты без сообщений больше 30 дней — в Архив. Новое сообщение
  // вернёт чат из архива само (если он не заглушён). Закреп и непрочитанное не трогаем.
  const stale = all.filter((d: Dialog) =>
    d.isUser && !d.archived && !d.pinned && !d.unreadCount && d.entity instanceof Api.User && !d.entity.self
    && d.date && now - d.date >= WINDOW_DAYS * 86_400).slice(0, ARCHIVE_CAP);

  const ids = dialogs.map((d) => String((d.entity as Api.User).id));
  const users = await db.user.findMany({ where: { tgId: { in: ids } }, select: { id: true, tgId: true, name: true } });
  const userByTg = new Map(users.map((u) => [u.tgId as string, u]));
  const orders = users.length ? await chatOrders(users.map((u) => u.id)) : [];
  const ordersBy = new Map<string, DeskOrder[]>();
  const pinOrdersBy = new Map<string, PinOrder[]>();
  for (const o of orders) {
    const pins = pinOrdersBy.get(o.userId) ?? [];
    pins.push({ wbCode: o.wbCode, amount: o.amount, status: o.status, createdAt: o.createdAt, completedAt: o.completedAt, heldAt: o.heldAt, robloxUsername: o.robloxUsername });
    pinOrdersBy.set(o.userId, pins);
    const list = ordersBy.get(o.userId) ?? [];
    list.push({ wbCode: o.wbCode, amount: o.amount, status: o.status, createdAt: o.createdAt, heldAt: o.heldAt, openFlags: openFlags(o).length > 0 });
    ordersBy.set(o.userId, list);
  }

  // Плохой отзыв на WB (актуальная версия) — то же правило, что у метки ВК.
  const badStars = new Map<string, number>();
  if (users.length) {
    const rows = (await db.$queryRawUnsafe(
      `select u.id as "userId", ${BAD_REVIEW_STARS_SQL} as "stars" from "User" u where u.id = any($1::text[])`,
      users.map((u) => u.id),
    ).catch(() => [])) as Array<{ userId: string; stars: number | null }>;
    for (const r of rows) if (r.stars != null) badStars.set(r.userId, Number(r.stars));
  }

  const result: PaDeskResult = { chats: dialogs.length, linked: 0, renamed: 0, folders: { NEW: 0, QUEUE: 0, PROBLEM: 0, DONE: 0, REVIEW: 0 }, waiting: 0, foldersUpdated: 0, archived: 0, pinsCreated: 0, pinsUpdated: 0 };
  const members: Record<DeskFolder, Dialog[]> = { NEW: [], QUEUE: [], PROBLEM: [], DONE: [], REVIEW: [] };

  for (const d of dialogs) {
    const u = d.entity as Api.User;
    const buyer = userByTg.get(String(u.id));
    const list = buyer ? ordersBy.get(buyer.id) ?? [] : [];
    if (list.length) result.linked++;
    const decision = deskDecision(list);
    if (decision.folder !== "NEW" || now - (d.date ?? 0) < NEW_WINDOW_DAYS * 86_400) members[decision.folder].push(d);
    const stars = buyer ? badStars.get(buyer.id) : undefined;
    if (stars != null) {
      members.REVIEW.push(d);
      if (decision.tag) decision.tag += badReviewMark(stars);
    }

    const current = [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
    const next = nextContactName({
      isContact: Boolean(u.contact),
      currentName: current,
      fallbackName: buyer?.name?.trim() || u.username || "Покупатель",
      tag: decision.tag,
    });
    if (!next || result.renamed >= RENAME_CAP) continue;
    result.renamed++;
    if (mode === "dry") {
      console.log(`[pa-desk] (dry) ${current ?? "?"} → ${next}`);
      continue;
    }
    try {
      await tg.invoke(new Api.contacts.AddContact({
        id: await tg.getInputEntity(u),
        firstName: next,
        lastName: "",
        phone: "",
        addPhonePrivacyException: false,
      }));
      await sleep(1500);
    } catch (error) {
      console.warn(`[pa-desk] метка не встала: ${error instanceof Error ? error.message : error}`);
    }
  }

  // 📌 Закреп заказа в самом диалоге — виден и покупателю, и нам.
  await syncOrderPins(tg, dialogs, (tgId) => {
    const buyer = userByTg.get(tgId);
    return buyer ? pinOrdersBy.get(buyer.id) ?? [] : [];
  }, mode, result).catch((e) => console.warn("[pa-pin]", e instanceof Error ? e.message : e));

  await askRatings(tg, dialogs, mode).catch((e) => console.warn("[pa-rating]", e instanceof Error ? e.message : e));

  // ❤️ на финальное «спасибо» — до папок: такой чат уже не «без ответа».
  const hearted = await autoHearts(tg, dialogs, mode).catch((e) => {
    console.warn("[pa-heart]", e instanceof Error ? e.message : e);
    return new Set<string>();
  });

  // Папки: пересобираем свои, только если состав (или цвет) поменялся.
  const existing = await tg.invoke(new Api.messages.GetDialogFilters());
  const list = "filters" in existing ? existing.filters : (existing as unknown as Api.TypeDialogFilter[]);
  for (const key of Object.keys(DESK_FOLDERS) as DeskFolder[]) {
    const want = members[key].slice(0, FOLDER_CAP);
    result.folders[key] = want.length;
    if (await syncFolder(tg, list, { id: DESK_FOLDERS[key].id, title: titleOf(key), color: FOLDER_COLOR[key] }, want, mode)) result.foldersUpdated++;
  }
  const waiting = dialogs.filter((d) => {
    const age = now - (d.date ?? 0);
    return d.message && !d.message.out && age >= WAIT_MIN * 60 && age < WAIT_MAX_H * 3600
      // Наша реакция на последнее сообщение клиента — тоже ответ.
      && !answeredByReaction(d.message.reactions as never)
      && !hearted.has(String((d.entity as Api.User).id));
  }).slice(0, FOLDER_CAP);
  result.waiting = waiting.length;
  if (await syncFolder(tg, list, WAIT_FOLDER, waiting, mode)) result.foldersUpdated++;

  if (stale.length > 0) {
    result.archived = stale.length;
    if (mode === "dry") {
      console.log(`[pa-desk] (dry) в архив: ${stale.length} старых чатов`);
    } else {
      try {
        const peers = await Promise.all(stale.map((d) => tg.getInputEntity(d.entity as Api.User)));
        await tg.invoke(new Api.folders.EditPeerFolders({
          folderPeers: peers.map((peer) => new Api.InputFolderPeer({ peer, folderId: 1 })),
        }));
      } catch (error) {
        result.archived = 0;
        console.warn(`[pa-desk] архив не обновился: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
  return result;
}

/* ── ❤️ Авто-реакция на финальное «спасибо» (17.11.2026) ───────────────────── */

/** Реакций за проход: каждая видна клиенту, не устраиваем лавину после простоя. */
const HEART_CAP = 10;
/** Старше трёх суток — разговор уже остыл, ❤️ на древнее «спасибо» выглядит странно. */
const HEART_MAX_AGE_S = WAIT_MAX_H * 3600;

/**
 * Ставит ❤️ на короткую благодарность клиента после нашего ответа (правило —
 * `heartTarget` в `bots/shared/pa-desk.ts`). Возвращает tgId чатов, где ❤️ встала:
 * их в этом же проходе не кладём в «⏰ Без ответа». Env `PA_HEART=off` выключает.
 */
async function autoHearts(tg: TelegramClient, dialogs: Dialog[], mode: Mode): Promise<Set<string>> {
  const done = new Set<string>();
  if ((process.env.PA_HEART ?? "").trim().toLowerCase() === "off") return done;
  const nowS = Math.floor(Date.now() / 1000);
  const candidates = dialogs.filter((d) => d.message && !d.message.out
    && nowS - (d.date ?? 0) < HEART_MAX_AGE_S
    && !answeredByReaction(d.message.reactions as never)
    && isThanksLike(d.message.message) !== null);
  for (const d of candidates) {
    if (done.size >= HEART_CAP) break;
    const u = d.entity as Api.User;
    const msgs = await tg.getMessages(u, { limit: 6 }).catch(() => []);
    const view = msgs.map((m) => ({
      out: Boolean(m.out),
      text: m.message ?? null,
      ourReaction: answeredByReaction(m.reactions as never),
      // Превью ссылки — это текст; фото, стикер, голос — нет.
      media: Boolean(m.media) && !(m.media instanceof Api.MessageMediaWebPage),
    }));
    const at = heartTarget(view);
    if (at === null) continue;
    const key = String(u.id);
    if (mode === "dry") { console.log(`[pa-heart] (dry) ❤️ в чате ${key}: «${(msgs[at].message ?? "").slice(0, 60)}»`); done.add(key); continue; }
    try {
      await tg.invoke(new Api.messages.SendReaction({
        peer: await tg.getInputEntity(u),
        msgId: msgs[at].id,
        reaction: [new Api.ReactionEmoji({ emoticon: "❤" })],
      }));
      done.add(key);
      await sleep(1500);
    } catch (error) {
      console.warn(`[pa-heart] реакция не встала: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (done.size) console.log(`[pa-heart] ❤️ поставлено: ${done.size}`);
  return done;
}

/**
 * Реакция на сообщение клиента ОТ ИМЕНИ аккаунта (26.11.2026): Bot API через
 * бизнес-подключение реакцию не ставит («message to react not found» на каждой
 * передаче человеку), а аккаунт может — id сообщения в бизнес-чате тот же.
 */
export async function reactPaMessage(tgId: string, messageId: number, emoji: string): Promise<boolean> {
  if (paDeskMode() !== "on") return false;
  const tg = await getClient();
  let peer = await tg.getInputEntity(Number(tgId)).catch(() => null);
  if (!peer) {
    // Сущности ещё нет в кэше сессии (новый клиент) — она есть в свежих диалогах.
    const d = (await tg.getDialogs({ limit: 50 })).find((x: Dialog) =>
      x.isUser && x.entity instanceof Api.User && String(x.entity.id) === tgId);
    peer = d?.inputEntity ?? null;
  }
  if (!peer) return false;
  await tg.invoke(new Api.messages.SendReaction({ peer, msgId: messageId, reaction: [new Api.ReactionEmoji({ emoticon: emoji })] }));
  return true;
}

/* ── 📌 Закреп заказа в диалоге (15.11.2026) ─────────────────────────────── */

/**
 * Заказы для меток и закрепа: свои + подключённые с другого аккаунта по коду
 * (`OrderContact`, 17.11.2026). Подключённые по нику/пассу не берём: в закрепе
 * виден код заказа. Подключённый заказ приходит строкой с `userId` контакта.
 */
async function chatOrders(userIds: string[]) {
  const select = { userId: true, wbCode: true, amount: true, status: true, createdAt: true, heldAt: true, flags: true, completedAt: true, robloxUsername: true } as const;
  const own = await db.wbOrder.findMany({ where: { userId: { in: userIds } }, select });
  const links = await db.orderContact.findMany({
    where: { userId: { in: userIds }, removedAt: null, via: { in: CODE_VIAS } },
    select: { userId: true, order: { select } },
  }).catch(() => [] as Array<{ userId: string; order: typeof own[number] }>);
  return [...own, ...links.map((l) => ({ ...l.order, userId: l.userId })), ...await codeChatOrders(userIds)];
}

/**
 * Заказы кодов Robux (17.11.2026) — в метку и закреп рядом с WB-заказами.
 * Только оплаченные: неоплаченная корзина — не заказ, возврат — не наша забота
 * в диалоге. Вместо `CODE-JKTTGD5S` метка несёт `JKTTGD5S`, клиент в закрепе
 * номера не видит вовсе (`pa-pin.ts`).
 */
async function codeChatOrders(userIds: string[]) {
  const select = { creatorUserId: true, publicId: true, denomination: true, status: true, createdAt: true, issuedAt: true } as const;
  const own = await db.codeOrder.findMany({
    where: { creatorUserId: { in: userIds }, status: { in: ["PAID", "ISSUED"] }, refundedAt: null },
    select,
  }).catch(() => []);
  // + подключённые из поддержки (18.11.2026: купила на сайте через ВК, пишет из Telegram).
  const linked = await db.codeOrderContact.findMany({
    where: { userId: { in: userIds }, removedAt: null, codeOrder: { status: { in: ["PAID", "ISSUED"] }, refundedAt: null } },
    select: { userId: true, codeOrder: { select } },
  }).catch(() => []);
  const rows = [...own.map((o) => ({ ...o, userId: o.creatorUserId as string })), ...linked.map((l) => ({ ...l.codeOrder, userId: l.userId }))];
  return rows.map((o) => ({
    userId: o.userId,
    wbCode: o.publicId.replace(/^CODE-/, ""),
    amount: o.denomination,
    status: o.status === "ISSUED" ? CODE_PIN_STATUS.ISSUED : CODE_PIN_STATUS.PAID,
    createdAt: o.createdAt,
    heldAt: null,
    flags: null,
    completedAt: o.issuedAt,
    robloxUsername: null,
  }));
}

/**
 * Закреп заказа в одном чате — сразу, не дожидаясь прохода (17.11.2026): аккаунт
 * только что подключили к заказу кнопкой в поддержке. Те же правила и та же
 * запись в `pa-pin`, что у обычного прохода.
 */
export async function pinPaOrdersNow(tgId: string): Promise<void> {
  const mode = paDeskMode();
  if (mode === "off") return;
  const tg = await getClient();
  const dialogs = (await tg.getDialogs({ limit: 200 })).filter((d: Dialog) =>
    d.isUser && d.entity instanceof Api.User && String(d.entity.id) === tgId);
  if (!dialogs.length) return;
  const user = await db.user.findUnique({ where: { tgId }, select: { id: true } });
  if (!user) return;
  const pins: PinOrder[] = (await chatOrders([user.id])).map((o) => ({
    wbCode: o.wbCode, amount: o.amount, status: o.status, createdAt: o.createdAt, completedAt: o.completedAt, heldAt: o.heldAt, robloxUsername: o.robloxUsername,
  }));
  const result = { pinsCreated: 0, pinsUpdated: 0 } as PaDeskResult;
  await syncOrderPins(tg, dialogs, () => pins, mode, result);
}

/**
 * Последние сообщения клиента в чате поддержки — для `/привязать` без кода
 * (17.11.2026): оператор не перепечатывает код, бот сам читает переписку.
 * Текст — последние 30 сообщений клиента; картинка — самая свежая его фотография,
 * прочитанная Tesseract'ом.
 */
export async function paRecentCustomerText(tgId: string): Promise<{ text: string; ocr: string | null }> {
  if (paDeskMode() === "off") return { text: "", ocr: null };
  const tg = await getClient();
  const dialog = (await tg.getDialogs({ limit: 200 })).find((d: Dialog) =>
    d.isUser && d.entity instanceof Api.User && String(d.entity.id) === tgId);
  if (!dialog) return { text: "", ocr: null };
  const msgs = (await tg.getMessages(dialog.entity as Api.User, { limit: 30 })).filter((m) => !m.out);
  const text = msgs.map((m) => m.message ?? "").filter(Boolean).reverse().join("\n");
  const photo = msgs.find((m) => m.photo);
  let ocr: string | null = null;
  if (photo) {
    const buf = await tg.downloadMedia(photo, {}).catch(() => null);
    if (buf && Buffer.isBuffer(buf)) ocr = await ocrImageBufferText(buf);
  }
  return { text, ocr };
}

const PIN_STREAM = "pa-pin";
/** Новых закрепов за проход: каждый — сообщение клиенту от аккаунта, не спамим. */
const PIN_CREATE_CAP = 5;
/** Новый закреп — только в живом разговоре: клиент писал за последние сутки. */
const PIN_ACTIVE_S = 24 * 3600;

type PinState = Record<string, { id: number; text: string }>;

async function syncOrderPins(
  tg: TelegramClient,
  dialogs: Dialog[],
  ordersOf: (tgId: string) => PinOrder[],
  mode: Mode,
  result: PaDeskResult,
): Promise<void> {
  if ((process.env.PA_PIN ?? "").trim().toLowerCase() === "off") return;
  const row = await db.wbSyncCursor.findUnique({ where: { stream: PIN_STREAM } });
  const pins: PinState = ((row?.metadata ?? {}) as { pins?: PinState }).pins ?? {};
  const now = Date.now();
  let changed = false;

  for (const d of dialogs) {
    const u = d.entity as Api.User;
    const key = String(u.id);
    const orders = ordersOf(key);
    if (!orders.length) continue;
    const text = pinText(orders, now);
    if (!text) continue;
    const have = pins[key];
    if (have && have.text === text) continue;

    if (have) {
      if (mode === "dry") { console.log(`[pa-pin] (dry) правка закрепа ${key}`); continue; }
      try {
        await tg.editMessage(u, { message: have.id, text, parseMode: "html" });
        pins[key] = { id: have.id, text };
        result.pinsUpdated++;
        changed = true;
        await sleep(800);
        continue;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/MESSAGE_NOT_MODIFIED/.test(msg)) { pins[key] = { id: have.id, text }; changed = true; continue; }
        // Удалили или истёк срок правки — поставим новый по правилам создания.
        console.warn(`[pa-pin] правка не прошла (${msg}) — закреп будет новым`);
        delete pins[key];
        changed = true;
      }
    }

    const fresh = d.date && now / 1000 - d.date < PIN_ACTIVE_S;
    if (!fresh || !pinWorthCreating(orders, now) || result.pinsCreated >= PIN_CREATE_CAP) continue;
    result.pinsCreated++;
    if (mode === "dry") { console.log(`[pa-pin] (dry) новый закреп ${key}`); continue; }
    try {
      const sent = await tg.sendMessage(u, { message: text, silent: true, parseMode: "html" });
      // Общий закреп (не «только у себя»): клиент тоже видит его над чатом.
      await tg.pinMessage(u, sent.id, { notify: false, pmOneSide: false });
      if (have) await tg.unpinMessage(u, have.id).catch(() => undefined);
      pins[key] = { id: sent.id, text };
      changed = true;
      await sleep(2500);
    } catch (error) {
      console.warn(`[pa-pin] закреп не встал: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (result.pinsCreated || result.pinsUpdated) console.log(`[pa-pin] новых закрепов ${result.pinsCreated}, обновлено ${result.pinsUpdated}`);
  if (!changed) return;
  await db.wbSyncCursor.upsert({
    where: { stream: PIN_STREAM },
    create: { stream: PIN_STREAM, metadata: { pins } as never },
    update: { metadata: { pins } as never },
  });
}

/** Привести одну папку к составу `want`. `true` — что-то меняли (или хотели в dry). */
async function syncFolder(
  tg: TelegramClient,
  list: Api.TypeDialogFilter[],
  spec: { id: number; title: string; color: number },
  want: Dialog[],
  mode: Mode,
): Promise<boolean> {
  const have = list.find((f) => f instanceof Api.DialogFilter && f.id === spec.id) as Api.DialogFilter | undefined;
  const haveIds = new Set((have?.includePeers ?? []).map((p) => ("userId" in p ? String(p.userId) : "")));
  const wantIds = new Set(want.map((d) => String((d.entity as Api.User).id)));
  // Цвет: свой, если оператор выбрал в приложении; иначе наш — без него нет тега под чатом.
  const color = have?.color ?? spec.color;
  // Закреплённое оператором в папке (например, чат @RobloxBankBot с кнопкой OPEN)
  // переживает пересборку: раньше pinnedPeers затирались пустым списком.
  const pinnedPeers = have?.pinnedPeers ?? [];
  const pinnedIds = new Set(pinnedPeers.map((p) => ("userId" in p ? String(p.userId) : "")));
  for (const id of pinnedIds) wantIds.delete(id);
  const same = have && have.color != null && haveIds.size === wantIds.size && [...wantIds].every((x) => haveIds.has(x));
  if (same || (want.length === 0 && !have)) return false;
  if (want.length === 0 && pinnedPeers.length) return false; // пустую папку с закрепом не удаляем
  if (mode === "dry") {
    console.log(`[pa-desk] (dry) папка «${spec.title}»: ${want.length} чатов`);
    return true;
  }
  try {
    if (want.length === 0) {
      await tg.invoke(new Api.messages.UpdateDialogFilter({ id: spec.id }));
      return true;
    }
    const includePeers = await Promise.all(want
      .filter((d) => !pinnedIds.has(String((d.entity as Api.User).id)))
      .map((d) => tg.getInputEntity(d.entity as Api.User)));
    await tg.invoke(new Api.messages.UpdateDialogFilter({
      id: spec.id,
      filter: new Api.DialogFilter({
        id: spec.id,
        title: new Api.TextWithEntities({ text: spec.title, entities: [] }),
        color,
        pinnedPeers,
        includePeers,
        excludePeers: [],
      }),
    }));
    await sleep(1000);
  } catch (error) {
    console.warn(`[pa-desk] папка «${spec.title}» не обновилась: ${error instanceof Error ? error.message : error}`);
  }
  return true;
}

/* ── Время ответа за вчера (раз в сутки) ─────────────────────────────────── */

export const RESPONSE_STREAM = "pa-response";
const STATS_CHAT_CAP = 120;

function mskDay(offsetDays = 0): { key: string; from: number; to: number } {
  const startMsk = Math.floor((Date.now() + MSK) / 86_400_000) * 86_400_000 + offsetDays * 86_400_000;
  return {
    key: new Date(startMsk).toISOString().slice(0, 10),
    from: (startMsk - MSK) / 1000,
    to: (startMsk - MSK + 86_400_000) / 1000,
  };
}

/** Посчитать вчерашний день, если ещё не считали. Только чтение чатов. */
export async function runPaResponseStats(): Promise<ResponseStats | null> {
  if (paDeskMode() === "off") return null;
  const day = mskDay(-1);
  const row = await db.wbSyncCursor.findUnique({ where: { stream: RESPONSE_STREAM } }).catch(() => null);
  if (row?.cursor === day.key) return null;

  const tg = await getClient();
  const all = await tg.getDialogs({ limit: 1000 });
  const chats = all.filter((d: Dialog) =>
    d.isUser && d.entity instanceof Api.User && !d.entity.bot && !d.entity.self && (d.date ?? 0) >= day.from,
  ).slice(0, STATS_CHAT_CAP);

  const turns: Array<{ delaySec: number | null; viaBot: boolean }> = [];
  for (const d of chats) {
    try {
      const msgs = await tg.getMessages(d.entity as Api.User, { limit: 60, offsetDate: Math.floor(day.to + 6 * 3600) });
      const chat: ChatMsg[] = msgs
        .filter((m) => m.date >= day.from - 6 * 3600)
        .map((m) => ({ date: m.date, out: Boolean(m.out), viaBot: Boolean((m as unknown as { viaBusinessBotId?: unknown }).viaBusinessBotId) }));
      turns.push(...chatTurns(chat, day.from, day.to));
    } catch (error) {
      console.warn(`[pa-response] чат не прочитался: ${error instanceof Error ? error.message : error}`);
    }
    await sleep(700);
  }
  const stats = summarizeTurns(turns);
  await db.wbSyncCursor.upsert({
    where: { stream: RESPONSE_STREAM },
    create: { stream: RESPONSE_STREAM, cursor: day.key, lastSuccessAt: new Date(), metadata: { day: day.key, ...stats } as never },
    update: { cursor: day.key, lastSuccessAt: new Date(), metadata: { day: day.key, ...stats } as never },
  });
  console.log(`[pa-response] ${day.key}: ${formatResponseStats(stats, "").replace(/\n/g, " | ")}`);
  return stats;
}

/** Последний посчитанный день — для сводки и команды. */
export async function loadPaResponseStats(): Promise<(ResponseStats & { day: string }) | null> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: RESPONSE_STREAM } }).catch(() => null);
  const meta = row?.metadata as (ResponseStats & { day: string }) | null | undefined;
  return meta?.day ? meta : null;
}

/* ── Проверка профиля (при старте) ───────────────────────────────────────── */

export const PROFILE_STREAM = "pa-profile";

/** Что настроено в профиле аккаунта поддержки. Только чтение. */
export async function auditPaProfile(): Promise<string[] | null> {
  if (paDeskMode() === "off") return null;
  const tg = await getClient();
  const full = await tg.invoke(new Api.users.GetFullUser({ id: new Api.InputUserSelf() }));
  const u = full.fullUser;
  const quick = await tg.invoke(new Api.messages.GetQuickReplies({ hash: 0 as never })).catch(() => null);
  const shortcuts = quick && "quickReplies" in quick ? quick.quickReplies.map((q) => `/${q.shortcut}`) : [];
  const filters = await tg.invoke(new Api.messages.GetDialogFilters());
  const flist = "filters" in filters ? filters.filters : (filters as unknown as Api.TypeDialogFilter[]);
  const order = flist
    .map((f) => f instanceof Api.DialogFilter ? f.title.text : f instanceof Api.DialogFilterDefault ? "Все" : null)
    .filter(Boolean);
  const hours = u.businessWorkHours;
  const lines = [
    `био: ${u.about ? `«${u.about}»` : "нет"}`,
    `приветствие (Business): ${u.businessGreetingMessage ? `есть, ярлык #${u.businessGreetingMessage.shortcutId}, молчание ${u.businessGreetingMessage.noActivityDays} дн.` : "нет"}`,
    `«нет на месте» (Business): ${u.businessAwayMessage ? `есть, ярлык #${u.businessAwayMessage.shortcutId}` : "нет"}`,
    `интро для новых (Business): ${u.businessIntro ? `«${u.businessIntro.title}»` : "нет"}`,
    `часы работы: ${hours ? `${hours.timezoneId}, интервалов ${hours.weeklyOpen.length}` : "нет"}`,
    `личный канал: ${u.personalChannelId ? "есть" : "нет"}`,
    `быстрые ответы: ${shortcuts.length ? shortcuts.join(" ") : "нет"}`,
    `порядок папок: ${order.join(" → ")}`,
  ];
  await db.wbSyncCursor.upsert({
    where: { stream: PROFILE_STREAM },
    create: { stream: PROFILE_STREAM, lastSuccessAt: new Date(), metadata: { lines } as never },
    update: { lastSuccessAt: new Date(), metadata: { lines } as never },
  }).catch(() => undefined);
  for (const l of lines) console.log(`[pa-profile] ${l}`);
  return lines;
}

/**
 * Копии важных уведомлений — в личку этого аккаунта (14.11.2026).
 *
 * @RobloxBank_PA — общий аккаунт всех админов, с него работают из лички.
 * Добавить его в беседу уведомлений = двойные уведомления у всех, поэтому он
 * получает копию только важного (`DM_TOPICS` в admin-route). Свой id аккаунт
 * знает сам — вписываем его в получатели, руками ничего настраивать не надо.
 */
async function registerPaDm(): Promise<void> {
  const tg = await getClient();
  const me = await tg.getMe();
  const id = String(me.id);
  const changed = await setAdminDm(db as never, id, true);
  const admin = (process.env.ADMIN_IDS ?? "").split(",").map((s) => s.trim()).includes(id);
  console.log(`[pa-dm] копии уведомлений в личку аккаунта: ${changed ? "включены" : "уже включены"}${admin ? "" : " · ⚠️ аккаунта нет в ADMIN_IDS — кнопки карточек у него не сработают"}`);
}

/* ── Порядок папок и био (при старте, 13.11.2026) ───────────────────────── */

/** Сначала «кому ответить» и «проблемы», «Готово» — в конце; чужие папки — после наших. */
const FOLDER_ORDER = [WAIT_FOLDER.id, DESK_FOLDERS.PROBLEM.id, DESK_FOLDERS.NEW.id, DESK_FOLDERS.QUEUE.id, DESK_FOLDERS.REVIEW.id, DESK_FOLDERS.DONE.id];
/** Био — только если пустое: своё оператора не перетираем. Не длиннее 70 символов. */
const PA_BIO = "Поддержка RobloxBank 💙 Заказ, статус и инструкция — в @RobloxBankBot";

async function tidyPaProfile(): Promise<void> {
  const tg = await getClient();
  const res = await tg.invoke(new Api.messages.GetDialogFilters());
  const list = "filters" in res ? res.filters : (res as unknown as Api.TypeDialogFilter[]);
  const current = list.map((f) => f instanceof Api.DialogFilterDefault ? 0 : "id" in f ? (f as { id: number }).id : -1).filter((id) => id >= 0);
  const ours = FOLDER_ORDER.filter((id) => current.includes(id));
  const desired = [
    ...(current.includes(0) ? [0] : []),
    ...ours,
    ...current.filter((id) => id !== 0 && !ours.includes(id)),
  ];
  if (desired.join(",") !== current.join(",")) {
    await tg.invoke(new Api.messages.UpdateDialogFiltersOrder({ order: desired }));
    console.log(`[pa-profile] порядок папок: ${current.join(",")} → ${desired.join(",")}`);
  }
  const full = await tg.invoke(new Api.users.GetFullUser({ id: new Api.InputUserSelf() }));
  if (!full.fullUser.about?.trim()) {
    await tg.invoke(new Api.account.UpdateProfile({ about: PA_BIO }));
    console.log(`[pa-profile] био заполнено: «${PA_BIO}»`);
  }
  await dropStaleQuickReplies(tg, full.fullUser);
}

/**
 * Устаревшие быстрые ответы, которые владелец велел убрать (13.11.2026): июньское
 * «Важное объявление» про опрос и публичный плейс — скрытый плейс давно не отказ.
 * Ищем по ТЕКСТУ первого сообщения ярлыка, а не по имени (имя оператор мог поменять).
 * Ярлыки Business-приветствия и «нет на месте» не трогаем никогда.
 */
const STALE_QUICK_REPLY_MARKERS = ["Важное объявление для всех покупателей"];

async function dropStaleQuickReplies(tg: TelegramClient, user: Api.UserFull): Promise<void> {
  const res = await tg.invoke(new Api.messages.GetQuickReplies({ hash: 0 as never }));
  if (!("quickReplies" in res)) return;
  const keep = new Set([user.businessGreetingMessage?.shortcutId, user.businessAwayMessage?.shortcutId].filter((x) => x != null));
  let dropped = 0;
  for (const q of res.quickReplies) {
    if (keep.has(q.shortcutId)) continue;
    // `topMessage` — последнее сообщение ярлыка, а не первое: читаем ярлык целиком.
    const msgs = await tg.invoke(new Api.messages.GetQuickReplyMessages({ shortcutId: q.shortcutId, hash: 0 as never }));
    const texts = "messages" in msgs ? msgs.messages.map((m) => (m instanceof Api.Message ? m.message ?? "" : "")) : [];
    if (!texts.some((t) => STALE_QUICK_REPLY_MARKERS.some((s) => t.includes(s)))) continue;
    await tg.invoke(new Api.messages.DeleteQuickReplyShortcut({ shortcutId: q.shortcutId }));
    console.log(`[pa-profile] удалён устаревший быстрый ответ /${q.shortcut}`);
    dropped++;
  }
  if (!dropped) console.log("[pa-profile] устаревших быстрых ответов не найдено");
}

/* ── Выгрузка диалогов для разбора ИИ: раз в неделю (13.11 → 26.11.2026) ── */

/**
 * Только чтение. Раз в 7 дней (курсор `pa-export`, `metadata.until`) — новые
 * сообщения всех личных чатов аккаунта (и архива) с прошлой выгрузки, плюс
 * несколько предыдущих для контекста (`ctx: true`) → `/tmp/pa-export/chats-<дата>.jsonl`
 * в контейнере. Имён, юзернеймов, телефонов нет — только номер чата, сторона
 * (C покупатель, O оператор, B бот аккаунта), время, текст, тип вложения и
 * сводка заказов из базы. Файл забирается по ssh и в репозиторий не попадает;
 * сжатая копия последней выгрузки — в базе (`pa-export-file`), длинные ключи вырезаны.
 * После выгрузки — итог недели ИИ в «📊 Сводки» (`aiWeeklyReport`).
 * Поменять `EXPORT_VERSION` — внеочередная выгрузка при следующем проходе.
 */
const EXPORT_VERSION = "2026-11-26";
const EXPORT_STREAM = "pa-export";
/** Сжатая копия последней выгрузки (jsonl.gz в base64): `/tmp` не переживает деплой. */
const EXPORT_FILE_STREAM = "pa-export-file";
const EXPORT_RETRY_MS = 3 * 3600_000;
const EXPORT_MSGS_PER_CHAT = 300;
const EXPORT_EVERY_MS = 7 * 86_400_000;
const EXPORT_CONTEXT_MSGS = 6;
const EXPORT_FIRST_SINCE = new Date("2026-11-13T00:00:00Z");

export async function exportPaDialogs(): Promise<void> {
  if (paDeskMode() === "off") return;
  const row = await db.wbSyncCursor.findUnique({ where: { stream: EXPORT_STREAM } }).catch(() => null);
  const last = row?.lastSuccessAt ? new Date(row.lastSuccessAt).getTime() : 0;
  if (row?.cursor === EXPORT_VERSION && Date.now() - last < EXPORT_EVERY_MS) return;
  const meta = (row?.metadata ?? {}) as { until?: string; startedAt?: string };
  // Упавшую посреди выгрузку (деплой пересоздал контейнер — 26.11.2026 так
  // пропала выгрузка за две недели) повторяем, но не чаще раза в 3 часа.
  if (meta.startedAt && Date.now() - new Date(meta.startedAt).getTime() < EXPORT_RETRY_MS) return;
  const since = meta.until ? new Date(meta.until) : row?.lastSuccessAt ? new Date(row.lastSuccessAt) : EXPORT_FIRST_SINCE;
  const until = new Date();
  // Курсор (cursor/lastSuccessAt/until) двигается только после успеха: до
  // 26.11 он ставился в начале, и прерванная выгрузка считалась сделанной на неделю.
  const running = { ...meta, startedAt: until.toISOString() };
  await db.wbSyncCursor.upsert({
    where: { stream: EXPORT_STREAM },
    create: { stream: EXPORT_STREAM, cursor: "running", metadata: running as never },
    update: { metadata: running as never },
  });

  const fs = await import("node:fs/promises");
  const dir = "/tmp/pa-export";
  await fs.mkdir(dir, { recursive: true });
  const file = `${dir}/chats-${until.toISOString().slice(0, 10)}.jsonl`;
  await fs.writeFile(file, "");

  const sinceSec = Math.floor(since.getTime() / 1000);
  const tg = await getClient();
  const main = await tg.getDialogs({ limit: 3000, folder: 0 });
  const archive = await tg.getDialogs({ limit: 3000, folder: 1 }).catch(() => [] as unknown as typeof main);
  const chats = [...main, ...archive].filter((d: Dialog) =>
    d.isUser && d.entity instanceof Api.User && !d.entity.bot && !d.entity.self && (d.date ?? 0) > sinceSec);

  const ids = chats.map((d) => String((d.entity as Api.User).id));
  const users = await db.user.findMany({ where: { tgId: { in: ids } }, select: { id: true, tgId: true } });
  const userByTg = new Map(users.map((u) => [u.tgId as string, u.id]));
  const orders = users.length
    ? await db.wbOrder.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { userId: true, status: true, amount: true, isDirectOrder: true, heldAt: true } })
    : [];

  let n = 0;
  let msgsTotal = 0;
  for (const d of chats) {
    const uid = userByTg.get(String((d.entity as Api.User).id));
    try {
      const msgs = await tg.getMessages(d.entity as Api.User, { limit: EXPORT_MSGS_PER_CHAT });
      const all = msgs.filter((m) => m.message || m.media).sort((a, b) => a.date - b.date);
      const firstNew = all.findIndex((m) => m.date > sinceSec);
      if (firstNew < 0) continue;
      const lines = all.slice(Math.max(0, firstNew - EXPORT_CONTEXT_MSGS)).map((m) => ({
        t: new Date(m.date * 1000).toISOString().slice(0, 16),
        s: !m.out ? "C" : (m as unknown as { viaBusinessBotId?: unknown }).viaBusinessBotId ? "B" : "O",
        // Ключи API Roblox, которые покупатели присылают в чат, в выгрузку не
        // идут (она хранится копией в базе) — тем же фильтром, что переписка WB.
        x: redactWbChatText(m.message ?? ""),
        ...(m.media ? { m: m.media.className.replace(/^MessageMedia/, "") } : {}),
        ...(m.date <= sinceSec ? { ctx: true } : {}),
      }));
      n++;
      msgsTotal += lines.filter((l) => !("ctx" in l)).length;
      const chatOrders = uid ? orders.filter((o) => o.userId === uid).map((o) => ({ st: o.status, amt: o.amount, dir: o.isDirectOrder, held: Boolean(o.heldAt) })) : [];
      await fs.appendFile(file, JSON.stringify({ i: n, archived: d.archived, orders: chatOrders, msgs: lines }) + "\n");
    } catch (error) {
      console.warn(`[pa-export] чат не прочитался: ${error instanceof Error ? error.message : error}`);
    }
    await sleep(800);
  }
  // Файл в /tmp контейнера живёт до следующего деплоя — копия сжатой в базе.
  const { gzipSync } = await import("node:zlib");
  const gz = gzipSync(await fs.readFile(file)).toString("base64");
  await db.wbSyncCursor.upsert({
    where: { stream: EXPORT_FILE_STREAM },
    create: { stream: EXPORT_FILE_STREAM, cursor: until.toISOString().slice(0, 10), lastSuccessAt: until, metadata: { since: since.toISOString(), until: until.toISOString(), gzBase64: gz } as never },
    update: { cursor: until.toISOString().slice(0, 10), lastSuccessAt: until, metadata: { since: since.toISOString(), until: until.toISOString(), gzBase64: gz } as never },
  }).catch((e) => console.warn("[pa-export] копия в базу не записалась:", e instanceof Error ? e.message : e));
  await db.wbSyncCursor.update({
    where: { stream: EXPORT_STREAM },
    data: { cursor: EXPORT_VERSION, lastSuccessAt: until, metadata: { since: since.toISOString(), until: until.toISOString(), chats: n, messages: msgsTotal, file, copy: EXPORT_FILE_STREAM } as never },
  });
  console.log(`[pa-export] готово: чатов ${n}, новых сообщений ${msgsTotal} (с ${since.toISOString().slice(0, 10)}) → ${file}`);
  await aiWeeklyReport(db, { since, chats: n, messages: msgsTotal })
    .catch((e) => console.warn("[ai-weekly]", e instanceof Error ? e.message : e));
}
