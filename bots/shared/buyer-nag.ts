/* ─────────────────────────────────────────────────────────────────────────────
   «Ебут мозги» и «Спрашивают» (28.11.2026).

   Владелец: «если ждёт долго, но молчит — похуй. Главное те, кто пишет, и
   смотря что пишут: могут просто узнавать, а могут ебать голову. Проблемных
   надо находить, сортировать и выкупать в первую очередь».

   Источник — обращения за 48 ч (`buyer-contact`: TG, ВК, чат WB, кнопка
   «Статус») и тон, который ИИ ставит каждому сообщению (`AiSupportLog.tone`).
   • brain «Ебут мозги» — тон ноет/наезжает/угрожает, или 4+ обращения;
   • asks «Спрашивают» — писали, но спокойно.
   Внутри «Ебут мозги» — сначала тон (угроза › наезд › нытьё), потом сколько
   раз писал, потом кто дольше ждёт. Молчащие сюда не попадают вовсе.
   «Опустить» (`nagDismissedAt`) — обращения до этой отметки не считаются.

   Модуль чистый: его берут и сайт (`src/lib/first-in-line.ts`), и боты.
   ───────────────────────────────────────────────────────────────────────── */

export const NAG_TONES = ["calm", "asks", "nags", "aggressive", "threat"] as const;
export type NagTone = (typeof NAG_TONES)[number];

/** Чем выше, тем сильнее ебёт мозги. */
export function toneRank(tone: string | null | undefined): number {
  const i = NAG_TONES.indexOf((tone ?? "") as NagTone);
  return i < 0 ? 0 : i;
}

/** Самый резкий тон из нескольких сообщений. */
export function worstTone(tones: Array<string | null | undefined>): NagTone | null {
  let best: NagTone | null = null;
  for (const t of tones) if (toneRank(t) > toneRank(best) && NAG_TONES.includes(t as NagTone)) best = t as NagTone;
  return best;
}

export const TONE_RU: Record<NagTone, string> = {
  calm: "спокойно", asks: "спрашивает", nags: "ноет", aggressive: "наезжает", threat: "угрожает",
};

/** Сколько обращений за 48 ч само по себе = «ебёт мозги», даже вежливо. */
export const NAG_COUNT = 4;

/** Заказ моложе суток в «Ебут мозги»/«Спрашивают» не попадает вовсе:
 *  «кто ебёт мозги с заказом меньше суток — идёт на хуй, минимум сутки».
 *  Поднятые вручную, «Не дошло» и прямые правило не трогает. */
export const NAG_MIN_AGE_HOURS = 24;
export function nagOldEnough(createdAt: Date | number, now = Date.now()): boolean {
  return now - new Date(createdAt).getTime() >= NAG_MIN_AGE_HOURS * 3_600_000;
}

export type NagLevel = "brain" | "asks";

export function nagLevel(input: { count: number; tone: string | null | undefined }): NagLevel {
  return toneRank(input.tone) >= toneRank("nags") || input.count >= NAG_COUNT ? "brain" : "asks";
}

/** Порядок внутри группы: тон › сколько раз › кто дольше ждёт. */
export function compareNag(
  a: { count: number; tone: string | null | undefined; since: number },
  b: { count: number; tone: string | null | undefined; since: number },
): number {
  return toneRank(b.tone) - toneRank(a.tone) || b.count - a.count || a.since - b.since;
}

/** Строка под кодом: «наезжает · 8 раз». */
export function nagLine(input: { count: number; tone: string | null | undefined }): string {
  const t = NAG_TONES.includes(input.tone as NagTone) && toneRank(input.tone) >= toneRank("nags") ? TONE_RU[input.tone as NagTone] : null;
  const n = input.count;
  const times = `${n} ${n % 10 === 1 && n % 100 !== 11 ? "раз" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "раза" : "раз"}`;
  return t ? `${t} · ${times}` : times;
}
