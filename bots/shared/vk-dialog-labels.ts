/* ─────────────────────────────────────────────────────────────────────────────
   Метки диалогов сообщества ВК — список сообщений, по которому видно, кто где.

   До 11.11.2026 сообщения сообщества были одной лентой: кто ждёт робуксы, кто
   пропал без пасса, кому нужен человек, — менеджер узнавал, только открыв
   диалог. У ВК для этого есть метки (`groups.tag*`): цветные ярлыки на диалоге
   и фильтр по ним в «Сообщениях» сообщества. Ставим их сами из того, что уже
   знает база, и снимаем, когда состояние ушло.

   Что важно знать про API (проверено живыми вызовами 11.11.2026):
   • `tagAdd` возвращает `1`, а не id — id берётся из `getTagList`;
   • имя до 20 «букв», и эмодзи считаются за несколько: «🚀 Идут робуксы»
     отклоняется, «Идут робуксы» — нет. Поэтому смысл несёт цвет;
   • цвет — только из фиксированного списка (`VK_TAG_COLORS`);
   • `tagBind` идемпотентен (повторный bind отвечает 1);
   • метки диалога ЧИТАЮТСЯ: `messages.getConversations` отдаёт у беседы
     `tags: [id…]` (777 диалогов = 4 запроса по 200). Сверяемся с тем, что
     реально стоит, — без памяти и без полной пересверки после рестарта;
   • цвет метки уникален в сообществе («color has been used already»);
   • в `messages.getHistory` сообщение живого менеджера несёт
     `admin_author_id`, сообщение бота — нет. По нему и снимаем «Нужен человек».

   Метки, созданные людьми руками («Не пришли рб» и т. п.), не трогаем: модуль
   управляет только своими — по точному имени из `VK_LABELS`.
   ───────────────────────────────────────────────────────────────────────── */

import { classifyBuyerMessage } from "./buyer-contact";
import { isRobuxSupportContext } from "./support-metric";

type VkLabelKey =
  | "human" | "held" | "queue" | "pass" | "stale" | "pay" | "bought" | "ready"
  | "regular" | "once" | "abandoned" | "fresh";

/** Разрешённые цвета `groups.tagAdd` (из ответа API). */
export const VK_TAG_COLORS = [
  "4bb34b", "5c9ce6", "e64646", "792ec0", "63b9ba", "ffa000", "ffc107", "76787a", "9e8d6b", "45678f",
  "539b9c", "454647", "7a6c4f", "6bc76b", "5181b8", "ff5c5c", "a162de", "7ececf", "aaaeb3", "bbaa84",
] as const;

/** Порядок = порядок важности в списке диалогов. */
export const VK_LABELS: Record<VkLabelKey, { name: string; color: (typeof VK_TAG_COLORS)[number]; hint: string }> = {
  human: { name: "Нужен человек", color: "e64646", hint: "описал проблему, которую бот не решит; менеджер ещё не ответил (до 7 дней)" },
  held: { name: "Заморожен", color: "63b9ba", hint: "заказ заморожен — не выкупать" },
  queue: { name: "В очереди выкупа", color: "792ec0", hint: "пасс есть, заказ ждёт выкупа" },
  pass: { name: "Ждём геймпасс", color: "ffc107", hint: "код активирован, пасса ещё нет (до 3 суток)" },
  stale: { name: "Пропал без пасса", color: "aaaeb3", hint: "ждём пасс дольше 3 суток" },
  pay: { name: "Ждёт оплату", color: "5c9ce6", hint: "прямой заказ оформлен, оплаты нет (до суток)" },
  bought: { name: "Выкуплен, идут рб", color: "6bc76b", hint: "выкупили меньше 5 дней назад — робуксы в ожидании Roblox" },
  ready: { name: "Готово", color: "4bb34b", hint: "выкупили 5–14 дней назад — робуксы уже должны быть на счету" },
  // История — когда ничего открытого нет: у каждого диалога хоть одна метка.
  regular: { name: "Постоянный клиент", color: "a162de", hint: "2+ выкупа, сейчас ничего не ждёт" },
  once: { name: "Был клиентом", color: "5181b8", hint: "1 выкуп, сейчас ничего не ждёт" },
  abandoned: { name: "Бросил заказ", color: "9e8d6b", hint: "заказ или заявка были, выкупа не было" },
  fresh: { name: "Новый клиент", color: "7ececf", hint: "написал, но ни кода, ни заказа ещё нет" },
};

/** Метки «где человек сейчас»; без них ставится метка истории. */
const STAGE_KEYS: readonly VkLabelKey[] = ["queue", "pass", "stale", "pay", "bought", "ready"];

const VK_LABEL_KEYS = Object.keys(VK_LABELS) as VkLabelKey[];

/**
 * Желаемый цвет, а если он занят — свободный. Сначала из тех, что не задуманы
 * для других наших меток: иначе замена одной сдвигала бы цвета по цепочке.
 */
function pickFreeColor(wanted: string, used: ReadonlySet<string>): string | null {
  if (!used.has(wanted)) return wanted;
  const reserved = new Set<string>(Object.values(VK_LABELS).map((l) => l.color));
  return VK_TAG_COLORS.find((c) => !used.has(c) && !reserved.has(c))
    ?? VK_TAG_COLORS.find((c) => !used.has(c))
    ?? null;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const PASS_FRESH_MS = 72 * HOUR;
const PAY_FRESH_MS = 24 * HOUR;
/** Roblox держит купленные робуксы «в ожидании» до 5 дней (`robux-eta`). */
const ROBUX_PENDING_MS = 5 * DAY;
const READY_KEEP_MS = 14 * DAY;
/** Сколько ждём ответа менеджера, прежде чем метка уходит сама. Не 72 ч:
 * пробный прогон 11.11 показал троих, кому не ответили больше трёх суток, —
 * метка не должна прятать ровно тех, кого пропустили. */
export const HUMAN_WINDOW_MS = 7 * DAY;

export interface VkLabelOrder {
  status: string;
  isDirectOrder: boolean;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  held: boolean;
  /** Для комментария диалога: код, номинал, ник, источник. */
  wbCode?: string;
  amount?: number;
  nick?: string | null;
  source?: string;
}

export interface VkLabelSnapshot {
  vkId: string;
  orders: VkLabelOrder[];
  /** Самая свежая живая (PENDING) прямая заявка. */
  pendingIntentAt: Date | null;
  /** Последнее обращение, на которое должен ответить человек (`needsHuman`). */
  humanSince: Date | null;
  /** Менеджер ответил после `humanSince` — заполняет синхронизация. */
  managerReplied?: boolean;
  /** Выкупов за всё время. */
  completedCount?: number;
  /** Был ли хоть один заказ, заявка или активированный код. */
  everOrdered?: boolean;
}

/* ── «Нужен человек» ───────────────────────────────────────────────────── */

/** Обращение через «Поддержку» бота (событие `SUPPORT_REQUEST_DELIVERED`). */
export interface VkSupportRequest {
  at: Date;
  text: string | null;
  contextKey: string | null;
  /** Бот сам сказал, что это про робуксы (контекст или вопрос «когда придут»). */
  robux: boolean;
  /** Автопроверка скрина: `ok` + число «в ожидании» — робуксы на скрине есть. */
  ocr: string | null;
  ocrPending: number | null;
  orderStatus: string;
  orderCompletedAt: Date | null;
}

const NICK_PROBLEM_RE = /ник\S*.{0,40}(букв|ошиб|не\s+тот|не\s+та|неправил|не\s+было)|(букв|ошиб|неправил).{0,40}ник/u;

/**
 * Нужен ли на это обращение живой человек. Нужен — когда бот ответить не
 * может: отмена, нестандартный вопрос, ник с ошибкой, робуксов нет ПОСЛЕ
 * окна ожидания Roblox. Не нужен — «когда выкупят» до выкупа (очередь и так
 * в «Первым делом»), «робуксов нет» в первые 5 дней (бот объясняет ожидание)
 * и скрин, на котором робуксы «в ожидании» видны: повторы такого скрина
 * сотый раз — не повод звать менеджера.
 */
export function needsHuman(r: VkSupportRequest): boolean {
  const text = (r.text ?? "").trim();
  if (!text) return false; // просто нажал кнопку — бот ответил сам
  if (r.ocr === "ok" && r.ocrPending != null) return false;

  const kind = classifyBuyerMessage(text, { contextKey: r.contextKey, viaSupport: true });
  if (kind === "cancel") return true;
  if (NICK_PROBLEM_RE.test(text.toLowerCase())) return true;

  const completed = r.orderStatus === "COMPLETED" && r.orderCompletedAt != null && r.orderCompletedAt <= r.at;
  const pendingOver = completed && r.at.getTime() - r.orderCompletedAt!.getTime() >= ROBUX_PENDING_MS;
  const robuxTopic = r.robux || r.contextKey === "status" || isRobuxSupportContext(r.contextKey);

  if (robuxTopic) return pendingOver; // до выкупа и в окне ожидания отвечает бот
  if (kind === "human") return true;
  if (kind === "rush") return r.contextKey === "status" ? pendingOver : true;
  return false; // «спасибо», «получилось»
}

/* ── Правило меток ─────────────────────────────────────────────────────── */

/** Какие метки должны стоять на диалоге. Чистая функция — без сети и базы. */
export function desiredVkLabels(snap: VkLabelSnapshot, now: Date): Set<VkLabelKey> {
  const t = now.getTime();
  const out = new Set<VkLabelKey>();
  const age = (d: Date | null) => (d ? t - d.getTime() : Infinity);

  if (snap.humanSince && age(snap.humanSince) <= HUMAN_WINDOW_MS && !snap.managerReplied) out.add("human");

  let lastDone: Date | null = null;
  for (const o of snap.orders) {
    const open = o.status !== "COMPLETED" && o.status !== "REJECTED";
    if (open && o.held) out.add("held");
    switch (o.status) {
      case "PENDING":
      case "IN_PROGRESS":
      case "ERROR":
        out.add("queue");
        break;
      case "AWAITING_GAMEPASS":
        out.add(age(o.createdAt) <= PASS_FRESH_MS ? "pass" : "stale");
        break;
      case "REJECTED":
        // Коридор ВБ: пасс отклонили — человек должен прислать новый.
        // У прямого заказа REJECTED — отмена, ждать там нечего.
        if (!o.isDirectOrder && age(o.updatedAt) <= PASS_FRESH_MS) out.add("pass");
        break;
      case "AWAITING_PAYMENT":
      case "PAYMENT_PENDING":
        if (age(o.createdAt) <= PAY_FRESH_MS) out.add("pay");
        break;
      case "COMPLETED": {
        const at = o.completedAt ?? o.updatedAt;
        if (!lastDone || at > lastDone) lastDone = at;
        break;
      }
    }
  }
  if (age(snap.pendingIntentAt) <= PAY_FRESH_MS) out.add("pay");
  // Свежий пасс по одному заказу важнее старого висяка по другому.
  if (out.has("pass")) out.delete("stale");

  const openWork = out.has("queue") || out.has("pass") || out.has("stale") || out.has("pay");
  if (!openWork && lastDone) {
    const doneAge = age(lastDone);
    if (doneAge < ROBUX_PENDING_MS) out.add("bought");
    else if (doneAge <= READY_KEEP_MS) out.add("ready");
  }
  if (!STAGE_KEYS.some((k) => out.has(k))) {
    const done = snap.completedCount ?? 0;
    out.add(done >= 2 ? "regular" : done === 1 ? "once" : snap.everOrdered ? "abandoned" : "fresh");
  }
  return out;
}

/* ── Комментарий диалога ─────────────────────────────────────────────────
   Поле «Комментарий» над перепиской в «Сообщениях» сообщества пишется методом
   `groups.setUserNote` (проверено 11.11.2026): до 96 символов, клиенту не видно,
   прочитать через API нельзя — только перезаписать. Кладём туда код заказа,
   номинал, ник и источник, чтобы не искать их в переписке. */

const NOTE_MAX = 96;
const SOURCE_SHORT: Record<string, string> = { WB_DBS: "DBS", WB: "WB", DIRECT: "прямой", SITE: "сайт", MANUAL: "ручной", AVITO: "Авито" };

/** Строка комментария: активные заказы (иначе последний выкупленный) · ник · источник. */
export function vkDialogNote(snap: Pick<VkLabelSnapshot, "orders">): string {
  const withCode = snap.orders.filter((o) => o.wbCode);
  const active = withCode
    .filter((o) => o.status !== "COMPLETED" && o.status !== "REJECTED")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const done = withCode
    .filter((o) => o.status === "COMPLETED")
    .sort((a, b) => (b.completedAt ?? b.updatedAt).getTime() - (a.completedAt ?? a.updatedAt).getTime());
  const pick = active.length > 0 ? active : done.slice(0, 1);
  if (pick.length === 0) return "";
  const shown = pick.slice(0, 2);
  const codes = shown.length === 1
    ? `${shown[0].wbCode} · ${(shown[0].amount ?? 0).toLocaleString("ru-RU")} R$`
    : `${shown.map((o) => `${o.wbCode} ${o.amount ?? 0}`).join(", ")} R$`;
  const more = pick.length > 2 ? ` +${pick.length - 2}` : "";
  const nick = pick.find((o) => o.nick)?.nick;
  const src = SOURCE_SHORT[shown[0].source ?? ""] ?? null;
  const done1 = active.length === 0 ? "✅ " : "";
  const parts = [`${done1}${codes}${more}`, nick, src].filter(Boolean) as string[];
  let note = parts.join(" · ");
  if (note.length > NOTE_MAX) note = note.slice(0, NOTE_MAX - 1) + "…";
  return note;
}

/* ── Синхронизация ─────────────────────────────────────────────────────── */

interface VkTagApi {
  /** Вызов метода VK API. Бросает при ошибке; `code` — VK error_code. */
  call(method: string, params: Record<string, string | number>): Promise<unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Пауза между вызовами: лимит токена сообщества — 20/с, оставляем запас боту. */
const CALL_GAP_MS = 200;

function vkErrorCode(err: unknown): number | null {
  const e = err as { code?: unknown; error_code?: unknown } | null;
  const code = Number(e?.code ?? e?.error_code);
  return Number.isFinite(code) ? code : null;
}

/** Диалог сообщества и id меток, которые на нём стоят сейчас. */
interface VkConversationTags {
  vkId: string;
  tags: number[];
}

export class VkDialogLabelSync {
  private ids: Map<VkLabelKey, number> | null = null;
  /** vkId → для какого обращения уже нашли ответ менеджера (мс). */
  private answered = new Map<string, number>();
  /** vkId → комментарий, который мы уже записали (ВК его не отдаёт — помним сами). */
  private notes = new Map<string, string>();
  private running = false;

  constructor(
    private readonly api: VkTagApi,
    private readonly groupId: number,
    private readonly gapMs = CALL_GAP_MS,
  ) {}

  /** id наших меток; недостающие создаёт. */
  async ensureLabels(): Promise<Map<VkLabelKey, number>> {
    if (this.ids) return this.ids;
    const list = async () =>
      ((await this.api.call("groups.getTagList", { group_id: this.groupId })) as { id: number; name: string; color?: string }[]) ?? [];
    let tags = await list();
    let created = false;
    // Цвет у меток сообщества уникален: «color has been used already» (прод,
    // 11.11 — `ffc107` уже был у ручной «Не пришли рб»). Занятый — заменяем.
    const used = new Set(tags.map((t) => String(t.color ?? "").replace(/^#/, "").toLowerCase()));
    for (const key of VK_LABEL_KEYS) {
      const { name, color: wanted } = VK_LABELS[key];
      if (tags.some((t) => t.name === name)) continue;
      const color = pickFreeColor(wanted, used);
      if (!color) {
        console.warn(`[vk-labels] нет свободного цвета для «${name}» — метка не создана`);
        continue;
      }
      await this.api.call("groups.tagAdd", { group_id: this.groupId, tag_name: name, tag_color: color });
      used.add(color);
      created = true;
      await sleep(this.gapMs);
    }
    if (created) tags = await list();
    const ids = new Map<VkLabelKey, number>();
    for (const key of VK_LABEL_KEYS) {
      const tag = tags.find((t) => t.name === VK_LABELS[key].name);
      if (tag) ids.set(key, tag.id);
    }
    this.ids = ids;
    return ids;
  }

  /** Все личные диалоги сообщества с их текущими метками (по 200 за запрос). */
  async listConversations(): Promise<VkConversationTags[]> {
    const out: VkConversationTags[] = [];
    for (let offset = 0; offset < 20_000; offset += 200) {
      const res = (await this.api.call("messages.getConversations", {
        group_id: this.groupId, count: 200, offset,
      })) as { count?: number; items?: Array<{ conversation?: { peer?: { id?: number; type?: string }; tags?: number[] } }> };
      for (const item of res?.items ?? []) {
        const peer = item.conversation?.peer;
        if (peer?.type !== "user" || !peer.id || peer.id <= 0) continue;
        out.push({ vkId: String(peer.id), tags: (item.conversation?.tags ?? []).map(Number) });
      }
      await sleep(this.gapMs);
      if (offset + 200 >= Number(res?.count ?? 0)) break;
    }
    return out;
  }

  /**
   * Ответил ли живой менеджер после `since`. Смотрим последние сообщения
   * диалога: у менеджерских есть `admin_author_id`, у бота — нет. Найденный
   * ответ запоминаем, чтобы не спрашивать ВК каждый проход.
   */
  /** `null` — ВК не ответил: неизвестно, метку тогда не трогаем (без мигания). */
  async managerRepliedAfter(vkId: string, since: Date): Promise<boolean | null> {
    const sinceMs = since.getTime();
    if ((this.answered.get(vkId) ?? -1) >= sinceMs) return true;
    try {
      const res = (await this.api.call("messages.getHistory", {
        group_id: this.groupId, peer_id: vkId, count: 50,
      })) as { items?: Array<{ out?: number; date?: number; admin_author_id?: number }> };
      await sleep(this.gapMs);
      const replied = (res?.items ?? []).some((m) =>
        m.out === 1 && Number(m.admin_author_id) > 0 && (m.date ?? 0) * 1000 > sinceMs);
      if (replied) this.answered.set(vkId, sinceMs);
      return replied;
    } catch (err) {
      console.warn(`[vk-labels] история ${vkId}: ${(err as Error)?.message ?? err}`);
      return null;
    }
  }

  private async bind(vkId: string, key: VkLabelKey, act: "bind" | "unbind"): Promise<boolean> {
    const tagId = this.ids?.get(key);
    if (!tagId) return false;
    const params = { group_id: this.groupId, tag_id: tagId, user_id: vkId, act };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.api.call("groups.tagBind", params);
        await sleep(this.gapMs);
        return true;
      } catch (err) {
        const code = vkErrorCode(err);
        // 6 — слишком часто, 9 — флуд-контроль: подождать и повторить один раз.
        if ((code === 6 || code === 9) && attempt === 0) {
          await sleep(2_000);
          continue;
        }
        // Метку удалили руками — перечитаем список на следующем проходе.
        if (code === 100) this.ids = null;
        console.warn(`[vk-labels] ${act} ${VK_LABELS[key].name} → ${vkId}: ${(err as Error)?.message ?? err}`);
        return false;
      }
    }
    return false;
  }

  /**
   * Один проход: все диалоги сообщества → нужные метки → разница с тем, что
   * стоит сейчас. Чужие (ручные) метки не трогаются. Диалог без данных в базе
   * — «Новый клиент».
   */
  async run(
    load: (vkIds: string[]) => Promise<VkLabelSnapshot[]>,
    now = new Date(),
  ): Promise<{ dialogs: number; bound: number; unbound: number; notes: number }> {
    if (this.running) return { dialogs: 0, bound: 0, unbound: 0, notes: 0 };
    this.running = true;
    let bound = 0;
    let unbound = 0;
    let notes = 0;
    try {
      const ids = await this.ensureLabels();
      const conversations = await this.listConversations();
      const snapshots = new Map((await load(conversations.map((c) => c.vkId))).map((s) => [s.vkId, s]));
      for (const conv of conversations) {
        let snap = snapshots.get(conv.vkId) ?? { vkId: conv.vkId, orders: [], pendingIntentAt: null, humanSince: null };
        let humanUnknown = false;
        if (snap.humanSince && now.getTime() - snap.humanSince.getTime() <= HUMAN_WINDOW_MS) {
          const replied = await this.managerRepliedAfter(conv.vkId, snap.humanSince);
          humanUnknown = replied === null;
          snap = { ...snap, managerReplied: replied === true };
        }
        const want = desiredVkLabels(snap, now);
        const has = new Set(conv.tags);
        // Комментарий: пишем только изменившийся и никогда не стираем — известный
        // код заказа должен оставаться над перепиской и после закрытия заказа.
        const note = vkDialogNote(snap);
        if (note && this.notes.get(conv.vkId) !== note) {
          try {
            await this.api.call("groups.setUserNote", { group_id: this.groupId, user_id: conv.vkId, note });
            this.notes.set(conv.vkId, note);
            notes++;
            await sleep(this.gapMs);
          } catch (err) {
            console.warn(`[vk-labels] комментарий ${conv.vkId}: ${(err as Error)?.message ?? err}`);
          }
        }
        // ВК не ответил про историю — «Нужен человек» оставляем как стоит.
        const humanId = ids.get("human");
        if (humanUnknown && humanId) {
          if (has.has(humanId)) want.add("human"); else want.delete("human");
        }
        for (const key of VK_LABEL_KEYS) {
          const tagId = ids.get(key);
          if (!tagId) continue;
          if (want.has(key) && !has.has(tagId)) {
            if (await this.bind(conv.vkId, key, "bind")) bound++;
          } else if (!want.has(key) && has.has(tagId)) {
            if (await this.bind(conv.vkId, key, "unbind")) unbound++;
          }
        }
      }
      return { dialogs: conversations.length, bound, unbound, notes };
    } finally {
      this.running = false;
    }
  }
}

/* ── Выборка из базы ───────────────────────────────────────────────────── */

/**
 * Данные по диалогам `$1` (vkId[]): открытые заказы — любой давности (иначе
 * заказ в очереди старше 45 дней оставался без метки), прочие — за 45 дней;
 * выкупы за всё время — для меток истории.
 */
const VK_LABEL_SNAPSHOT_SQL = `
select u."vkId" as "vkId",
       coalesce(json_agg(json_build_object(
         'status', w.status, 'isDirectOrder', w."isDirectOrder",
         'createdAt', w."createdAt", 'updatedAt', w."updatedAt",
         'completedAt', w."completedAt", 'held', w."heldAt" is not null,
         'wbCode', w."wbCode", 'amount', w.amount, 'nick', w."robloxUsername", 'source', w."orderSource"
       )) filter (where w.id is not null), '[]') as orders,
       (select max(i."createdAt") from "DirectIntent" i
         where i."userId" = u.id and i.status = 'PENDING') as "pendingIntentAt",
       (select count(*) from "WbOrder" c
         where c."userId" = u.id and c."isTest" = false and c.status = 'COMPLETED')::int as "completedCount",
       (exists (select 1 from "WbOrder" c where c."userId" = u.id and c."isTest" = false)
        or exists (select 1 from "DirectIntent" i where i."userId" = u.id)
        or exists (select 1 from "WbCode" k where k."userId" = u.id)) as "everOrdered"
from "User" u
left join "WbOrder" w on w."userId" = u.id and w."isTest" = false
      and (w.status in ('AWAITING_GAMEPASS','PENDING','IN_PROGRESS','ERROR')
           or w."updatedAt" > now() - interval '45 days')
where u."vkId" = any($1::text[])
group by u.id`;

/** Обращения через «Поддержку» VK-бота за окно «Нужен человек». */
const VK_SUPPORT_REQUESTS_SQL = `
select coalesce(e.payload->>'vkId', u."vkId") as "vkId",
       e."createdAt" as "at",
       e.payload->>'text' as "text",
       e.payload->>'contextKey' as "contextKey",
       coalesce((e.payload->>'robux')::boolean, false) as "robux",
       e.payload->>'ocr' as "ocr",
       (e.payload->>'ocrPending')::numeric as "ocrPending",
       w.status as "orderStatus",
       w."completedAt" as "orderCompletedAt"
from "OrderEvent" e
join "WbOrder" w on w.id = e."orderId"
join "User" u on u.id = w."userId"
where e.type = 'SUPPORT_REQUEST_DELIVERED'
  and e.payload->>'via' = 'vk-bot'
  and e."createdAt" > now() - interval '${HUMAN_WINDOW_MS / HOUR} hours'`;

type OrderRow = Omit<VkLabelOrder, "createdAt" | "updatedAt" | "completedAt"> & {
  createdAt: string; updatedAt: string; completedAt: string | null;
};
type SnapshotRow = {
  vkId: string; orders: OrderRow[]; pendingIntentAt: Date | null; completedCount: number; everOrdered: boolean;
};
type SupportRow = Omit<VkSupportRequest, "ocrPending"> & { vkId: string | null; ocrPending: unknown };

type RawDb = { $queryRawUnsafe: (sql: string, ...values: unknown[]) => Promise<unknown> };

export async function loadVkLabelSnapshots(db: RawDb, vkIds: readonly string[]): Promise<VkLabelSnapshot[]> {
  const wanted = new Set(vkIds);
  const rows = (await db.$queryRawUnsafe(VK_LABEL_SNAPSHOT_SQL, [...wanted])) as SnapshotRow[];
  const support = (await db.$queryRawUnsafe(VK_SUPPORT_REQUESTS_SQL)) as SupportRow[];

  const byId = new Map<string, VkLabelSnapshot>();
  for (const r of rows) {
    const vkId = String(r.vkId);
    byId.set(vkId, {
      vkId,
      pendingIntentAt: r.pendingIntentAt ? new Date(r.pendingIntentAt) : null,
      humanSince: null,
      completedCount: Number(r.completedCount ?? 0),
      everOrdered: Boolean(r.everOrdered),
      // json_build_object отдаёт timestamp без зоны — это UTC (так пишет Prisma).
      orders: (r.orders ?? []).map((o) => ({
        status: o.status,
        isDirectOrder: Boolean(o.isDirectOrder),
        held: Boolean(o.held),
        createdAt: utc(o.createdAt),
        updatedAt: utc(o.updatedAt),
        completedAt: o.completedAt ? utc(o.completedAt) : null,
        wbCode: o.wbCode,
        amount: Number(o.amount),
        nick: o.nick ?? null,
        source: o.source,
      })),
    });
  }
  for (const s of support) {
    const vkId = String(s.vkId ?? "");
    if (!wanted.has(vkId)) continue;
    const req: VkSupportRequest = {
      at: new Date(s.at),
      text: s.text,
      contextKey: s.contextKey,
      robux: Boolean(s.robux),
      ocr: s.ocr,
      ocrPending: s.ocrPending == null ? null : Number(s.ocrPending),
      orderStatus: s.orderStatus,
      orderCompletedAt: s.orderCompletedAt ? new Date(s.orderCompletedAt) : null,
    };
    if (!needsHuman(req)) continue;
    const snap = byId.get(vkId) ?? { vkId, orders: [], pendingIntentAt: null, humanSince: null };
    if (!snap.humanSince || req.at > snap.humanSince) snap.humanSince = req.at;
    byId.set(vkId, snap);
  }
  return [...byId.values()];
}

function utc(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
}
