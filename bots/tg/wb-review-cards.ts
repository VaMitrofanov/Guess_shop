/* ─────────────────────────────────────────────────────────────────────────────
   ⭐ Карточки плохих отзывов WB (27.11.2026).

   Владелец: «таких уебищ бы обрабатывать, вручную нет сил, а воркер идеально
   справится» + «мы умеем через поддержку WB отменять отзывы — это нельзя
   руинить». Порядок поэтому такой: СНАЧАЛА жалоба, ответ — потом.

   На каждый новый неотвеченный отзыв 1–3★ в тему «Отзывы и вопросы» уходит
   одна карточка: чей это заказ (копируемый код, WB #, ШК, ник, TG/ВК), текст,
   готовый публичный ответ ИИ и оценка «можно ли пожаловаться». Кнопки:
     🚩 Пожаловался — ответ уйдёт через 3 дня, если WB отзыв не снимет;
     📝 Ответить сейчас — ответ уходит в WB сразу;
     🙈 Не отвечать.
   Сам ИИ на отзыв ничего не публикует, пока человек не нажал кнопку.
   Пожаловаться через API WB нельзя (справочник причин убран, 404) — жалоба
   подаётся в кабинете или через поддержку WB.

   Состояние — `WbSyncCursor` stream `wb-review-cards` (metadata.items по id
   отзыва). Выключатель — `WB_REVIEW_CARDS=off`.
   ───────────────────────────────────────────────────────────────────────── */

import { type Telegraf } from "telegraf";
import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { adminTargets } from "../shared/admin-route";
import { escapeHtml } from "../shared/notify";
import { guardDecision, plain } from "../shared/pa-ai-support";
import { decideSupport } from "../shared/support-ai";
import { reviewOrderInfo } from "../shared/wb-review-order";
import { answerReview, getFeedbackById, getUnansweredFeedbacksRaw, type WbFeedbackRaw } from "./admin/wb-client";

const STREAM = "wb-review-cards";
const BAD_MAX_STARS = 3;
/** Карточки только на свежие отзывы: первый запуск не должен вывалить архив. */
const FRESH_MS = 48 * 3600_000;
/** Сколько ждём решения по жалобе, прежде чем ответить публично. */
export const COMPLAINT_WAIT_MS = 72 * 3600_000;
const KEEP_MS = 30 * 86_400_000;

type Status = "new" | "complained" | "answered" | "skipped" | "deleted";
interface Item { status: Status; draft: string; stars: number; at: string; complainedAt?: string; by?: string }
type Items = Record<string, Item>;

const isAdmin = (id: number | undefined) => id !== undefined && ADMIN_IDS.map(String).includes(String(id));

async function load(): Promise<Items> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } }).catch(() => null);
  return ((row?.metadata ?? {}) as { items?: Items }).items ?? {};
}

async function save(items: Items): Promise<void> {
  const now = Date.now();
  for (const [id, it] of Object.entries(items)) if (now - Date.parse(it.at) > KEEP_MS) delete items[id];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metadata = { items } as any;
  await db.wbSyncCursor.upsert({
    where: { stream: STREAM },
    create: { stream: STREAM, metadata, lastSuccessAt: new Date() },
    update: { metadata, lastSuccessAt: new Date() },
  });
}

function reviewText(f: WbFeedbackRaw): string {
  return [f.text, f.pros ? `Достоинства: ${f.pros}` : "", f.cons ? `Недостатки: ${f.cons}` : ""]
    .map((s) => (s ?? "").trim()).filter(Boolean).join("\n");
}

const starsLine = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

/** Публичный ответ и оценка жалобы — от ИИ; сбой модели — `null` (карточка без черновика). */
async function draftFor(f: WbFeedbackRaw, orderContext: string): Promise<{ reply: string; complaint: string } | null> {
  const text = reviewText(f) || "(отзыв без текста, только оценка)";
  const raw = await decideSupport({
    channel: "wb_review",
    context: `ОТЗЫВ НА WILDBERRIES: ${f.productValuation ?? "?"}★, товар «${f.productDetails?.productName ?? f.productDetails?.supplierArticle ?? "карта Robux"}».\nДАННЫЕ ЗАКАЗА: ${orderContext}`,
    turns: [{ role: "user", text }],
  }).catch(() => null);
  if (!raw || raw === "out_of_money") return null;
  // Та же страховка, что в чате WB: другие площадки, сроки, обещания денег.
  const d = guardDecision(raw, "", "wb_chat");
  const reply = plain(d.reply || d.draft).trim();
  return reply ? { reply, complaint: raw.summary.trim() } : null;
}

function buttons(id: string) {
  return {
    inline_keyboard: [
      [{ text: "🚩 Пожаловался — ответ через 3 дня", callback_data: `wbrv:later:${id}` }],
      [{ text: "📝 Ответить сейчас", callback_data: `wbrv:now:${id}` }, { text: "🙈 Не отвечать", callback_data: `wbrv:skip:${id}` }],
    ],
  };
}

/** Проход: новые плохие отзывы → карточки; жалобы старше 3 дней → ответ. */
export async function runWbReviewCards(bot: Telegraf, now = Date.now()): Promise<void> {
  if (process.env.WB_REVIEW_CARDS === "off") return;
  const items = await load();
  let dirty = false;

  const fresh = (await getUnansweredFeedbacksRaw(30)).filter((f) =>
    (f.productValuation ?? 5) <= BAD_MAX_STARS && !items[f.id]
    && f.createdDate && now - Date.parse(f.createdDate) < FRESH_MS);

  for (const f of fresh.slice(0, 5)) {
    const info = await reviewOrderInfo(db, f).catch(() => ({ lines: ["📦 заказ не определить"], code: null, context: "Заказ не найден." }));
    const draft = await draftFor(f, info.context);
    const text = reviewText(f);
    const stars = f.productValuation ?? 1;
    const msg = [
      `⭐ <b>Плохой отзыв на WB · ${stars}/5</b> ${starsLine(stars)}`,
      `👤 <b>${escapeHtml(f.userName ?? "Покупатель")}</b> · 🏷 <code>${escapeHtml(f.productDetails?.supplierArticle ?? String(f.productDetails?.nmId ?? "—"))}</code>`,
      ...info.lines,
      "",
      text ? `💬 «${escapeHtml(text.slice(0, 900))}${text.length > 900 ? "…" : ""}»` : "<i>(без текста — только оценка)</i>",
      "",
      f.isAbleSupplierFeedbackValuation === false ? "🚫 WB не даёт пожаловаться на этот отзыв" : draft?.complaint ? `🚩 ${escapeHtml(draft.complaint)}` : null,
      draft ? `\n✍️ <b>Ответ, который уйдёт:</b>\n${escapeHtml(draft.reply)}` : "\n✍️ <i>ИИ не ответил — ответьте в кабинете WB.</i>",
    ].filter((l) => l !== null).join("\n");
    for (const t of await adminTargets("reviews", { loud: true })) {
      await bot.telegram.sendMessage(t.chatId, msg.slice(0, 4000), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(draft ? { reply_markup: buttons(f.id) } : {}),
        ...t.extra,
      }).catch((e: unknown) => console.warn("[wb-review-cards] карточка не ушла:", e instanceof Error ? e.message : e));
    }
    items[f.id] = { status: draft ? "new" : "skipped", draft: draft?.reply ?? "", stars, at: new Date(now).toISOString() };
    dirty = true;
  }

  for (const [id, it] of Object.entries(items)) {
    if (it.status !== "complained" || !it.complainedAt || now - Date.parse(it.complainedAt) < COMPLAINT_WAIT_MS) continue;
    const fb = await getFeedbackById(id);
    if (fb === undefined) continue; // сеть — попробуем в следующий раз
    if (fb === null) {
      it.status = "deleted";
      dirty = true;
      await notify(bot, `✅ <b>Отзыв ${it.stars}★ снят по жалобе</b> — отвечать не пришлось.`);
      continue;
    }
    if (fb.answer?.text) { it.status = "answered"; dirty = true; continue; }
    if (await answerReview(id, it.draft, false)) {
      it.status = "answered";
      dirty = true;
      await notify(bot, `📤 <b>Жалоба на отзыв ${it.stars}★ не сработала за 3 дня — ответ опубликован:</b>\n${escapeHtml(it.draft)}`);
    }
  }
  if (dirty) await save(items);
}

async function notify(bot: Telegraf, html: string): Promise<void> {
  for (const t of await adminTargets("reviews", { loud: false })) {
    await bot.telegram.sendMessage(t.chatId, html, { parse_mode: "HTML", ...t.extra }).catch(() => undefined);
  }
}

export function registerWbReviewCards(bot: Telegraf): void {
  bot.action(/^wbrv:(later|now|skip):([\w-]{4,60})$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("Только для админов").catch(() => undefined);
    const [, act, id] = ctx.match;
    const who = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name ?? "админ";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const original = ((ctx.callbackQuery?.message as any)?.text ?? "") as string;
    const items = await load();
    const it = items[id];
    if (!it || it.status === "answered" || it.status === "skipped" || it.status === "deleted") {
      await ctx.answerCbQuery("Уже решено", { show_alert: false }).catch(() => undefined);
      return;
    }
    let note = "";
    if (act === "later") {
      it.status = "complained";
      it.complainedAt = new Date().toISOString();
      note = `🚩 ${who}: жалоба подана. Если через 3 дня отзыв останется — ответ уйдёт сам.`;
    } else if (act === "skip") {
      it.status = "skipped";
      note = `🙈 ${who}: без ответа.`;
    } else {
      const ok = await answerReview(id, it.draft, false);
      if (!ok) {
        await ctx.answerCbQuery("WB не принял ответ — ответьте в кабинете", { show_alert: true }).catch(() => undefined);
        return;
      }
      it.status = "answered";
      note = `📤 ${who}: ответ опубликован.`;
    }
    it.by = who;
    await save(items);
    await ctx.answerCbQuery("Готово").catch(() => undefined);
    await ctx.editMessageText(`${escapeHtml(original).slice(0, 3700)}\n\n${escapeHtml(note)}`, { parse_mode: "HTML" }).catch(() => undefined);
  });
}
