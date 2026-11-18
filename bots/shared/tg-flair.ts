import { isBuyerQuietHourMsk } from "./quiet-hours";

/* ─────────────────────────────────────────────────────────────────────────────
   ✨ Эффекты и реакции Telegram (18.11.2026, мокап З7; владелец: «конфетти —
   супер идея»). Проверено живьём 18.11: бот шлёт эффекты в личку, Telegram
   принимает все четыре ID ниже, спойлер и кнопку `copy_text`.

   Правила, чтобы бот был «живым», а не цирком:
     • эффект только в радостный момент, по одному на событие, четыре вида;
     • в тихие часы (22–9 МСК) — без эффекта: и так `disable_notification`;
     • отказ Telegram из-за эффекта (старый клиент, бизнес-чат) не роняет
       сообщение — `withoutEffectOnError` отправляет его ещё раз без эффекта.
   ВК эффектов не умеет: там картинка и текст.
   ───────────────────────────────────────────────────────────────────────── */

/** Бесплатные эффекты сообщений Telegram (доступны ботам в личных чатах). */
export const TG_EFFECT = {
  /** 🎉 Код Robux готов, заказ выкуплен. */
  party: "5046509860389126442",
  /** 🔥 Геймпасс принят — заказ в очереди. */
  fire: "5104841245755180586",
  /** ❤️ Отзыв принят, бонус на балансе. */
  heart: "5159385139981059251",
  /** 👍 Код карты WB активирован. */
  like: "5107584321108051014",
} as const;

export type TgEffect = keyof typeof TG_EFFECT;

/** `{ message_effect_id }` для отправки или `{}` в тихие часы. */
export function effectExtra(kind: TgEffect, now = Date.now()): { message_effect_id?: string } {
  return isBuyerQuietHourMsk(now) ? {} : { message_effect_id: TG_EFFECT[kind] };
}

/** Похоже, что Telegram отказал именно из-за эффекта. */
export function isEffectRefusal(err: unknown): boolean {
  const text = String((err as { description?: string; message?: string } | null)?.description ?? (err as Error)?.message ?? err ?? "");
  return /EFFECT|message_effect/i.test(text);
}

/**
 * Отправить с эффектом; если Telegram отказал из-за эффекта — ещё раз без него.
 * `send` получает `extra` (с эффектом или без) и делает саму отправку.
 */
export async function withoutEffectOnError<T>(extra: Record<string, unknown>, send: (extra: Record<string, unknown>) => Promise<T>): Promise<T> {
  try {
    return await send(extra);
  } catch (err) {
    if (!("message_effect_id" in extra) || !isEffectRefusal(err)) throw err;
    const { message_effect_id: _drop, ...rest } = extra;
    void _drop;
    return send(rest);
  }
}

/** Нативная кнопка Telegram «скопировать текст» (Bot API 7.11). */
export function copyButton(label: string, text: string) {
  return { text: label, copy_text: { text: text.slice(0, 256) } };
}

/** Реакции бота на сообщение клиента: 👀 «смотрю», 👍 «готово», 🙏 «спасибо». */
export const TG_REACTION = { look: "👀", ok: "👍", thanks: "🙏" } as const;
export function reactionPayload(emoji: string) {
  return [{ type: "emoji", emoji }];
}

/* ── Картинки (scripts/render-brand-cards.mjs) ── */
export const FLAIR_IMAGE = {
  orderDone: "order-done.jpg",
  codePreparing: "code-preparing.jpg",
  code: (denomination: number) => `code-${denomination}.jpg`,
} as const;
const CODE_IMAGE_DENOMS = new Set([100, 200, 800, 1000, 2000, 2500, 4500, 10000]);
/** Есть ли готовый билет на этот номинал (иначе — сообщение без картинки). */
export const hasCodeImage = (denomination: number) => CODE_IMAGE_DENOMS.has(denomination);
