/* ─────────────────────────────────────────────────────────────────────────────
   Быстрые ответы Telegram Business на @RobloxBank_PA (13.11.2026).

   Оператор набирает `/` в чате с покупателем и выбирает готовый текст. Воркер
   только ДОБАВЛЯЕТ недостающие ярлыки из `PA_QUICK_REPLIES`; существующие (в том
   числе с тем же именем) не правит и не удаляет. Тексты на «вы» — так пишет оператор.

   Писать в чаты покупателей воркер по-прежнему не может: быстрый ответ — это
   сообщение в служебном списке аккаунта, покупатель его не видит, пока
   оператор сам не отправит.
   ───────────────────────────────────────────────────────────────────────── */

import { Api, type TelegramClient } from "telegram";
import { generateRandomLong } from "telegram/Helpers";
import { HTMLParser } from "telegram/extensions/html";
import { db } from "../shared/db";
import { robuxDelaySupportText } from "../shared/robux-wait";

const priceOf = (amount: number) => Math.ceil(amount / 0.7);
const PRICE_EXAMPLES = [100, 200, 300, 500, 800, 1000, 1500, 2000];

/** Ярлык (латиница, без `/`) → текст. Порядок = порядок в списке Telegram. */
/**
 * Ярлык → текст. 13.11.2026: у оператора уже 18 своих ярлыков (/pending, /код,
 * /idгеймпасс, /выкуп…), поэтому здесь — только то, чего у него нет.
 */
export const PA_QUICK_REPLIES: Array<{ shortcut: string; text: string }> = [
  {
    shortcut: "цена",
    text:
      "Цена геймпасса = номинал ÷ 0,7 с округлением вверх (Roblox забирает 30%):\n" +
      PRICE_EXAMPLES.map((a) => `${a} R$ → ${priceOf(a)} R$`).join("\n") +
      "\n\nТочная цена — в карточке заказа в боте @RobloxBankBot.",
  },
  {
    shortcut: "managed",
    text:
      "Проверьте, пожалуйста, что у геймпасса выключен Managed pricing (региональные цены). Если он включён, Roblox сам меняет цену, и мы не сможем выкупить пасс.\n\n" +
      "Где: Passes → ваш пасс → ☰ → Sales → Managed pricing = OFF → Save Changes.",
  },
  {
    // 15.11.2026, владелец: «заебался писать про задержки» — «выкупили N-го, а робуксов нет».
    shortcut: "задержка",
    text: robuxDelaySupportText(),
  },
  {
    shortcut: "бот",
    text: "Все шаги и статус заказа — в боте @RobloxBankBot: кнопки «📖 Инструкция» и «📦 Мой заказ». Там же придёт уведомление о выкупе.",
  },
];

export interface QuickReplySyncResult { created: number; updated: number; same: number }

/**
 * Создать недостающие ярлыки. Существующие НЕ трогаем никогда: ярлык с тем же
 * именем мог завести и править оператор (так было с /pending 13.11.2026).
 */
export async function syncPaQuickReplies(tg: TelegramClient, dry = false): Promise<QuickReplySyncResult> {
  const res: QuickReplySyncResult = { created: 0, updated: 0, same: 0 };
  const all = await tg.invoke(new Api.messages.GetQuickReplies({ hash: 0 as never }));
  const names = new Set(("quickReplies" in all ? all.quickReplies : []).map((q) => q.shortcut.toLowerCase()));
  for (const want of PA_QUICK_REPLIES) {
    if (names.has(want.shortcut.toLowerCase())) { res.same++; continue; }
    res.created++;
    if (dry) { console.log(`[pa-quick] (dry) создать /${want.shortcut}`); continue; }
    await tg.invoke(new Api.messages.SendMessage({
      peer: new Api.InputPeerSelf(),
      message: want.text,
      randomId: generateRandomLong(),
      noWebpage: true,
      quickReplyShortcut: new Api.InputQuickReplyShortcut({ shortcut: want.shortcut }),
    }));
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (res.created && !dry) {
    // Проверка: Telegram мог принять запрос и не завести ярлык — смотрим список заново.
    const after = await tg.invoke(new Api.messages.GetQuickReplies({ hash: 0 as never }));
    const list = ("quickReplies" in after ? after.quickReplies : []).map((q) => q.shortcut);
    const missing = PA_QUICK_REPLIES.filter((w) => !list.some((n) => n.toLowerCase() === w.shortcut.toLowerCase())).map((w) => w.shortcut);
    console.log(`[pa-quick] теперь ярлыков ${list.length}: ${list.map((n) => `/${n}`).join(" ")}${missing.length ? ` — НЕ появились: ${missing.join(", ")}` : ""}`);
  }
  return res;
}

/* ── Ревизия быстрых ответов оператора (15.11.2026) ────────────────────────
   Владелец: «проверь все наши быстрые на актуальность, приведи в порядок».
   Сессию аккаунта нельзя открыть вне воркера, поэтому через базу:
   1) `dumpPaQuickReplies` — тексты всех ярлыков (HTML) → `WbSyncCursor`
      stream `pa-quick`, `metadata.dump`;
   2) `applyPaQuickPlan` — если в `metadata.plan` лежит план с новым `id`, воркер
      применяет его один раз (правка текста / переименование / удаление /
      создание), пишет итог в `metadata.applied` и выгружает заново.
   Ярлыки Business-приветствия и «нет на месте» не удаляются никогда.
   ───────────────────────────────────────────────────────────────────────── */

const QUICK_STREAM = "pa-quick";

export type QuickPlanOp =
  /** Новое сообщение в тот же ярлык вместо `messageId` (вложение переносится), старое удаляется. */
  | { op: "edit"; shortcut: string; messageId: number; html: string }
  | { op: "rename"; shortcut: string; to: string }
  | { op: "delete"; shortcut: string }
  | { op: "create"; shortcut: string; html: string };

interface QuickMeta {
  dump?: { at: string; items: Array<{ shortcut: string; shortcutId: number; protected: boolean; messages: Array<{ id: number; html: string; media: string | null }> }> };
  plan?: { id: string; ops: QuickPlanOp[] };
  applied?: { id: string; at: string; results: string[] };
}

async function loadQuickMeta(): Promise<QuickMeta> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: QUICK_STREAM } });
  return (row?.metadata ?? {}) as QuickMeta;
}

async function saveQuickMeta(patch: Partial<QuickMeta>): Promise<void> {
  const meta = { ...(await loadQuickMeta()), ...patch };
  await db.wbSyncCursor.upsert({
    where: { stream: QUICK_STREAM },
    create: { stream: QUICK_STREAM, metadata: meta as never },
    update: { metadata: meta as never },
  });
}

async function protectedShortcutIds(tg: TelegramClient): Promise<Set<number>> {
  const full = await tg.invoke(new Api.users.GetFullUser({ id: new Api.InputUserSelf() }));
  const u = full.fullUser;
  return new Set([u.businessGreetingMessage?.shortcutId, u.businessAwayMessage?.shortcutId].filter((x): x is number => x != null));
}

/** Вложение сообщения ярлыка → то же вложение для повторной отправки (без перезаливки). */
function inputMediaOf(media: Api.TypeMessageMedia | undefined): Api.TypeInputMedia | null {
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    const d = media.document;
    return new Api.InputMediaDocument({ id: new Api.InputDocument({ id: d.id, accessHash: d.accessHash, fileReference: d.fileReference }) });
  }
  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
    const ph = media.photo;
    return new Api.InputMediaPhoto({ id: new Api.InputPhoto({ id: ph.id, accessHash: ph.accessHash, fileReference: ph.fileReference }) });
  }
  return null;
}

async function listShortcuts(tg: TelegramClient): Promise<Api.QuickReply[]> {
  const res = await tg.invoke(new Api.messages.GetQuickReplies({ hash: 0 as never }));
  return "quickReplies" in res ? res.quickReplies : [];
}

/** Выгрузить тексты всех ярлыков в базу (читает аккаунт, ничего не меняет). */
export async function dumpPaQuickReplies(tg: TelegramClient): Promise<number> {
  const keep = await protectedShortcutIds(tg);
  const items: NonNullable<QuickMeta["dump"]>["items"] = [];
  for (const q of await listShortcuts(tg)) {
    const res = await tg.invoke(new Api.messages.GetQuickReplyMessages({ shortcutId: q.shortcutId, hash: 0 as never }));
    const msgs = ("messages" in res ? res.messages : []).filter((m): m is Api.Message => m instanceof Api.Message);
    items.push({
      shortcut: q.shortcut, shortcutId: q.shortcutId, protected: keep.has(q.shortcutId),
      messages: msgs.sort((a, b) => a.id - b.id).map((m) => ({
        id: m.id,
        html: HTMLParser.unparse(m.message ?? "", m.entities),
        media: m.media ? m.media.className : null,
      })),
    });
    await new Promise((r) => setTimeout(r, 400));
  }
  await saveQuickMeta({ dump: { at: new Date().toISOString(), items } });
  console.log(`[pa-quick] выгружено ярлыков: ${items.length}`);
  return items.length;
}

/** Применить новый план из базы (один раз на `plan.id`). */
export async function applyPaQuickPlan(tg: TelegramClient): Promise<boolean> {
  const meta = await loadQuickMeta();
  if (!meta.plan?.id || meta.applied?.id === meta.plan.id) return false;
  const keep = await protectedShortcutIds(tg);
  const results: string[] = [];
  for (const op of meta.plan.ops) {
    try {
      const all = await listShortcuts(tg);
      const q = all.find((x) => x.shortcut.toLowerCase() === op.shortcut.toLowerCase());
      if (op.op === "create") {
        if (q) { results.push(`create /${op.shortcut}: уже есть`); continue; }
        const [message, entities] = HTMLParser.parse(op.html);
        await tg.invoke(new Api.messages.SendMessage({
          peer: new Api.InputPeerSelf(), message, entities, randomId: generateRandomLong(), noWebpage: true,
          quickReplyShortcut: new Api.InputQuickReplyShortcut({ shortcut: op.shortcut }),
        }));
        results.push(`create /${op.shortcut}: ok`);
      } else if (!q) {
        results.push(`${op.op} /${op.shortcut}: ярлыка нет`);
      } else if (op.op === "delete") {
        if (keep.has(q.shortcutId)) { results.push(`delete /${op.shortcut}: защищён (приветствие / нет на месте)`); continue; }
        await tg.invoke(new Api.messages.DeleteQuickReplyShortcut({ shortcutId: q.shortcutId }));
        results.push(`delete /${op.shortcut}: ok`);
      } else if (op.op === "rename") {
        await tg.invoke(new Api.messages.EditQuickReplyShortcut({ shortcutId: q.shortcutId, shortcut: op.to }));
        results.push(`rename /${op.shortcut} → /${op.to}: ok`);
      } else {
        // Не EditMessage: правку Telegram на сервере принимает, но приложения
        // оператора её не видят — список ярлыков кэшируется по последнему
        // сообщению, а у правки его номер прежний (15.11.2026, «ответы не
        // изменились вообще»). Поэтому: новое сообщение в тот же ярлык (с тем же
        // вложением), старое — удалить. Номер ярлыка не меняется, и приветствие /
        // «нет на месте», которые ссылаются на него, продолжают работать.
        const [message, entities] = HTMLParser.parse(op.html);
        const res = await tg.invoke(new Api.messages.GetQuickReplyMessages({ shortcutId: q.shortcutId, id: [op.messageId], hash: 0 as never }));
        const prev = ("messages" in res ? res.messages : []).find((m): m is Api.Message => m instanceof Api.Message && m.id === op.messageId);
        if (!prev) { results.push(`edit /${op.shortcut} #${op.messageId}: сообщения нет`); continue; }
        const target = new Api.InputQuickReplyShortcutId({ shortcutId: q.shortcutId });
        const media = inputMediaOf(prev.media);
        if (prev.media && !media) { results.push(`edit /${op.shortcut} #${op.messageId}: вложение не переносится — пропущено`); continue; }
        if (media) {
          await tg.invoke(new Api.messages.SendMedia({ peer: new Api.InputPeerSelf(), media, message, entities, randomId: generateRandomLong(), quickReplyShortcut: target }));
        } else {
          await tg.invoke(new Api.messages.SendMessage({ peer: new Api.InputPeerSelf(), message, entities, randomId: generateRandomLong(), noWebpage: true, quickReplyShortcut: target }));
        }
        await tg.invoke(new Api.messages.DeleteQuickReplyMessages({ shortcutId: q.shortcutId, id: [op.messageId] }));
        results.push(`edit /${op.shortcut} #${op.messageId}: ok`);
      }
    } catch (error) {
      results.push(`${op.op} /${op.shortcut}: ошибка ${error instanceof Error ? error.message : error}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  await saveQuickMeta({ applied: { id: meta.plan.id, at: new Date().toISOString(), results } });
  for (const r of results) console.log(`[pa-quick] план ${meta.plan.id}: ${r}`);
  await dumpPaQuickReplies(tg);
  return true;
}
