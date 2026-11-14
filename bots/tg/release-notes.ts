/* ─────────────────────────────────────────────────────────────────────────────
   Тема «Апдейты» в беседе админов + публикация для клиентов (14.11.2026).

   Каталог записей — `bots/shared/release-notes.ts`. Здесь: доставка в тему и
   кнопки «Опубликовать в канал и ВК» / «Не публиковать». Состояние — в
   `WbSyncCursor` stream `release-notes`:
     metadata.sent   — id записей, уже показанных в теме (повторов не бывает);
     metadata.public — судьба клиентского поста: published | skipped | failed.
   Отметка «отправлено» пишется ДО отправки: лучше потерять одно сообщение при
   падении, чем засыпать тему дублями после каждого рестарта.
   ───────────────────────────────────────────────────────────────────────── */

import path from "node:path";
import { existsSync } from "node:fs";
import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { TG_CAPTION_LIMIT, findNote, formatAdminUpdate, unsentNotes, visibleText, vkPostText, type ReleaseNote } from "../shared/release-notes";
import { card, loadSettings } from "./pa-ai";

/** Обложки лежат в bots/shared/assets/updates (копируются в образ вместе с bots/shared). */
const COVERS_DIR = path.resolve(__dirname, "../shared/assets/updates");

type SendExtra = Record<string, unknown>;

/**
 * Нарядный пост: обложка файлом + подпись с разметкой + кнопки. Подпись длиннее
 * лимита фото — обложка отдельно, текст следом. Возвращает message_id последнего
 * сообщения (под ним в теме «Апдейты» встают кнопки решения).
 */
async function sendRichPost(bot: Telegraf, chatId: string | number, note: ReleaseNote, extra: SendExtra = {}): Promise<number> {
  const post = note.public!;
  const markup = post.buttons?.length
    ? { reply_markup: { inline_keyboard: post.buttons.map((row) => row.map((b) => ({ text: b.label, url: b.url }))) } }
    : {};
  const cover = post.cover ? path.join(COVERS_DIR, path.basename(post.cover)) : null;
  const fits = visibleText(post.tgHtml).length <= TG_CAPTION_LIMIT;
  if (cover && existsSync(cover)) {
    if (fits) {
      const sent = await bot.telegram.sendPhoto(chatId, { source: cover }, { caption: post.tgHtml, parse_mode: "HTML", ...markup, ...extra });
      return sent.message_id;
    }
    await bot.telegram.sendPhoto(chatId, { source: cover }, extra);
  }
  const sent = await bot.telegram.sendMessage(chatId, post.tgHtml, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...markup, ...extra });
  return sent.message_id;
}

const STREAM = "release-notes";

type PublicState = { status: "published" | "skipped" | "failed"; by: string; at: string; tg?: string; vk?: string; tgDone?: boolean; vkDone?: boolean };
type NotesState = { sent: string[]; public: Record<string, PublicState> };

async function loadState(): Promise<NotesState> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } });
  const meta = (row?.metadata ?? {}) as Partial<NotesState>;
  return { sent: Array.isArray(meta.sent) ? meta.sent.map(String) : [], public: meta.public ?? {} };
}

async function saveState(state: NotesState): Promise<void> {
  await db.wbSyncCursor.upsert({
    where: { stream: STREAM },
    create: { stream: STREAM, metadata: state as never },
    update: { metadata: state as never },
  });
}

const isAdmin = (id: number | undefined) => id !== undefined && ADMIN_IDS.map(String).includes(String(id));

let delivering = false;

/** Показать в теме записи, которых там ещё не было. */
export async function deliverReleaseNotes(bot: Telegraf): Promise<number> {
  if (delivering) return 0;
  delivering = true;
  try {
    const state = await loadState();
    const fresh = unsentNotes(state.sent);
    for (const note of fresh) {
      state.sent.push(note.id);
      await saveState(state);
      await card(bot, formatAdminUpdate(note), undefined, "updates");
      if (note.public) await sendPublicPreview(bot, note);
    }
    return fresh.length;
  } finally {
    delivering = false;
  }
}

/**
 * Превью в теме «Апдейты» — тот же пост, что увидят клиенты, а под ним
 * отдельным ответом кнопки решения. Беседа не назначена — превью не шлём:
 * публиковать в канал вслепую из лички незачем.
 */
async function sendPublicPreview(bot: Telegraf, note: ReleaseNote): Promise<void> {
  const s = await loadSettings();
  const thread = s.topics.updates;
  if (!s.chatId) return;
  const where = thread ? { message_thread_id: thread } : {};
  await bot.telegram.sendMessage(s.chatId, "📣 <b>Пост для клиентов</b> — так он выйдет в канале. В ВК — тот же текст без разметки, с карточкой сайта.", { parse_mode: "HTML", ...where });
  const postId = await sendRichPost(bot, s.chatId, note, { ...where, disable_notification: true });
  await bot.telegram.sendMessage(s.chatId, "Публикуем клиентам?", {
    ...where,
    reply_parameters: { message_id: postId },
    reply_markup: { inline_keyboard: [[
      { text: "📣 Опубликовать в канал и ВК", callback_data: `rn:pub:${note.id}` },
      { text: "Не публиковать", callback_data: `rn:skip:${note.id}` },
    ]] },
  });
}

async function postToTelegramChannel(bot: Telegraf, note: ReleaseNote): Promise<string> {
  const channel = process.env.TG_CHANNEL_ID;
  if (!channel || !note.public) return "канал не настроен";
  await sendRichPost(bot, channel, note);
  return "канал ✅";
}

async function postToVkWall(note: ReleaseNote): Promise<string> {
  const token = process.env.VK_TOKEN;
  const group = process.env.VK_GROUP_ID;
  const text = vkPostText(note);
  if (!token || !group || !text) return "ВК не настроен";
  /* 15.11.2026: ссылка вложением падает — «link_photo_sizing_rule. No photo
     given»: ВК больше не принимает ссылку-сниппет от сообщества без фото, а
     загрузить фото на стену токен сообщества не может (photos.getWallUploadServer
     — только пользовательский токен). Поэтому ссылка — строкой в конце текста. */
  const link = note.public?.link;
  const message = link && !text.includes(link) ? `${text}\n\n👉 ${link}` : text;
  const response = await fetch("https://api.vk.com/method/wall.post", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: token, v: "5.131", owner_id: `-${group}`, from_group: "1", message,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({})) as { error?: { error_msg?: string } };
  if (data.error) throw new Error(`ВК: ${data.error.error_msg ?? "ошибка"}`);
  return "ВК ✅";
}

const busy = new Set<string>();

export function registerReleaseNotes(bot: Telegraf): void {
  bot.action(/^rn:(pub|skip):([\w-]{1,48})$/, async (ctx) => {
    const [, action, id] = ctx.match as unknown as [string, "pub" | "skip", string];
    if (!isAdmin(ctx.from?.id)) {
      await ctx.answerCbQuery("Только для админов").catch(() => undefined);
      return;
    }
    const note = findNote(id);
    if (!note?.public) {
      await ctx.answerCbQuery("Такой записи нет").catch(() => undefined);
      return;
    }
    if (busy.has(id)) {
      await ctx.answerCbQuery("Уже публикую…").catch(() => undefined);
      return;
    }
    busy.add(id);
    try {
      const state = await loadState();
      const done = state.public[id];
      if (done && done.status !== "failed") {
        await ctx.answerCbQuery(done.status === "published" ? "Уже опубликовано" : "Уже отменено").catch(() => undefined);
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => undefined);
        return;
      }
      const who = ctx.from?.username ? `@${ctx.from.username}` : String(ctx.from?.id ?? "");
      if (action === "skip") {
        state.public[id] = { status: "skipped", by: who, at: new Date().toISOString() };
        await saveState(state);
        await ctx.answerCbQuery("Не публикуем").catch(() => undefined);
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => undefined);
        await ctx.reply(`Клиентам не объявляем — решил ${who}.`, { reply_parameters: { message_id: ctx.callbackQuery.message!.message_id } }).catch(() => undefined);
        return;
      }
      await ctx.answerCbQuery("Публикую…").catch(() => undefined);
      // Канал и ВК независимы: упал один — второй всё равно пробуем. При повторе
      // после частичной неудачи шлём только туда, где не вышло, — без дублей.
      const [tg, vk] = await Promise.allSettled([
        done?.tgDone ? Promise.resolve("канал ✅ (раньше)") : postToTelegramChannel(bot, note),
        done?.vkDone ? Promise.resolve("ВК ✅ (раньше)") : postToVkWall(note),
      ]);
      const tgText = tg.status === "fulfilled" ? tg.value : `канал ❌ ${tg.reason instanceof Error ? tg.reason.message : ""}`;
      const vkText = vk.status === "fulfilled" ? vk.value : `ВК ❌ ${vk.reason instanceof Error ? vk.reason.message : ""}`;
      const tgDone = tg.status === "fulfilled" && tg.value.includes("✅");
      const vkDone = vk.status === "fulfilled" && vk.value.includes("✅");
      const ok = tgDone && vkDone;
      state.public[id] = { status: ok ? "published" : "failed", by: who, at: new Date().toISOString(), tg: tgText, vk: vkText, tgDone, vkDone };
      await saveState(state);
      if (ok) await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => undefined);
      await ctx.reply(`${ok ? "📣 Опубликовано" : "⚠️ Опубликовано не везде"} (${who}): ${tgText} · ${vkText}${ok ? "" : "\nКнопка осталась — можно нажать ещё раз."}`, {
        reply_parameters: { message_id: ctx.callbackQuery.message!.message_id },
      }).catch(() => undefined);
    } finally {
      busy.delete(id);
    }
  });

  bot.command("updates_resend", async (ctx) => {
    // Для проверки: показать запись в теме ещё раз (`/updates_resend <id>`).
    if (!isAdmin(ctx.from?.id)) return;
    const id = (ctx.message?.text ?? "").split(/\s+/)[1] ?? "";
    const note = findNote(id);
    if (!note) {
      await ctx.reply("Нет такой записи. Формат: /updates_resend 2026-11-14-site-activation-codes");
      return;
    }
    await card(bot, formatAdminUpdate(note), undefined, "updates");
  });

  // Тема создаётся при старте (~15 с, pa-group) — шлём после неё и раз в полчаса.
  const tick = () => void deliverReleaseNotes(bot)
    .then((n) => { if (n) console.log(`[release-notes] в «Апдейты» отправлено: ${n}`); })
    .catch((error) => console.error("[release-notes]", error instanceof Error ? error.message : error));
  setTimeout(tick, 90_000);
  setInterval(tick, 30 * 60_000);
}
