/** The guide reads two independent query params:
 *
 *   `skip=1`  — open straight on the code form instead of the marketing intro.
 *   `code=…`  — the code itself, which the guide verifies and then jumps all
 *               the way to the instruction. It is only honoured when `skip` is
 *               also set (see `wbCodeFromUrl` in `src/app/guide/page.tsx`).
 *
 * So a link carrying a code needs both, and the buyer types nothing. Every bot
 * surface already builds it this way; the DBS gate is the last one to join. */
export function wbGateUrl(code: string, origin = "https://robloxbank.ru"): string {
  return `${wbGuideOrigin(origin)}/guide?source=wb&skip=1&code=${encodeURIComponent(code)}`;
}

function wbGuideOrigin(origin = "https://robloxbank.ru"): string {
  return origin.replace(/\/$/, "");
}

/** Fallback for a buyer whose link did not open. `source=wb` is not decoration:
 * Traefik only routes `Path(/guide)` with that query to the guide container, so
 * a bare `/guide` never reaches it at all. */
export function wbGuideFallbackUrl(origin?: string): string {
  return `${wbGuideOrigin(origin)}/guide?source=wb`;
}

/** Owner-approved wording (16.08.2026). Kept byte-identical across the console
 * button, the auto-reply worker and anything sent by hand from the WB cabinet,
 * so a buyer never sees two different scripts for the same step. */
export function wbCodeRequestMessage(): string {
  return [
    "Здравствуйте! Для успешного получения заказа просим прислать 5-6-значный код доставки,"
    + " расположенный в разделе \"Доставки\" приложения Wildberries, рядом с QR-кодом.",
    "Код необходимо направить в этот чат.",
    "Доставка заказов осуществляется Онлайн через этот чат, без необходимости физической доставки,"
    + " курьера Вам ждать не нужно",
  ].join("\n");
}

/** The single message a DBS buyer receives after the operator sends the gate.
 * Shared by the console action and the auto-gate worker so the two can never
 * drift into telling buyers different things.
 *
 * Sent only once the delivery is actually closed on WB — the words "заказ
 * подтверждён" are a statement about WB's own state, and on 20.08 they went out
 * on an order WB had just rejected. `tryAutoGate` and the console action both
 * enforce that now; this text may be trusted to mean it.
 *
 * Deliberately names no messenger: Wildberries penalises sellers for steering
 * buyers to outside platforms, so the page itself introduces the next step. */
export function wbGateMessage(
  code: string,
  denomination: number | null,
  origin?: string,
  sibling?: WbOrderSibling | null,
): string {
  const amount = denomination ? `${denomination.toLocaleString("ru-RU")} R$` : "ваш номинал";
  return [
    `Спасибо, код доставки получен! Заказ подтверждён, ${amount} готовы к зачислению.`,
    ...wbSiblingLines(sibling),
    "Откройте ссылку — код уже подставлен, вводить его вручную не нужно:",
    wbGateUrl(code, origin),
    `Если ссылка не открылась, перейдите на ${wbGuideFallbackUrl(origin)} и введите код: ${code}`,
    // Геймпасс назван прямо здесь: до страницы покупатель доходит с уже
    // сложившимся ожиданием «сейчас просто скажу ник», а без геймпасса
    // зачислить Robux физически нельзя — это половина инструкции.
    "На этой странице будет вся дальнейшая инструкция: указать ник Roblox, куда зачислить Robux,"
    + " и создать геймпасс по инструкции — именно через него приходят Robux.",
  ].join("\n\n");
}

/** Одна покупка на Wildberries может содержать несколько наших карточек: WB
 * заводит на каждую отдельный заказ и отдельный чат, а `orderUid` у них общий.
 * Позиция считается по нему. */
export type WbOrderSibling = { index: number; total: number };

/** Позиция заказа среди своих же — по возрастанию `wbOrderId`, потому что WB
 * нумерует заказы одной покупки подряд, и покупатель видит их в том же порядке.
 * `wbOrderId` — строка (int64 не переживает JSON), поэтому сначала по длине,
 * иначе «9» окажется после «10». Одиночный заказ позиции не имеет: сообщение о
 * нескольких заказах не должно появляться там, где заказ один. */
export function wbSiblingPosition(
  wbOrderId: string,
  siblings: { wbOrderId: string }[],
): WbOrderSibling | null {
  if (siblings.length < 2) return null;
  const ordered = siblings
    .map((s) => s.wbOrderId)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  const index = ordered.indexOf(wbOrderId);
  if (index < 0) return null;
  return { index: index + 1, total: ordered.length };
}

/** Покупателю двух карточек нужно сказать вслух, что заказа два и они не
 * связаны.
 *
 * 21.08 покупательница взяла две карточки на два аккаунта Roblox, оформила
 * первую и написала: «во втором чате висит ник из первого заказа, как оформить
 * второй». Ссылки в обоих чатах выглядели одинаково, и ничто в тексте не
 * намекало, что ник указывается для каждого заказа свой. */
function wbSiblingLines(sibling?: WbOrderSibling | null): string[] {
  if (!sibling || sibling.total < 2) return [];
  return [
    `Это заказ ${sibling.index} из ${sibling.total} в вашей покупке. Заказы независимы:`
    + " у каждого свой код и свой ник Roblox, и робуксы придут на тот аккаунт, который вы укажете"
    + " именно по этому коду. Ссылка ниже — только для этого заказа; остальные оформляются"
    + " по ссылкам из своих чатов.",
  ];
}

/** WB отклонил код, который прислал покупатель.
 *
 * Отдельное сообщение вместо гейта: пока доставка не закрыта, писать «заказ
 * подтверждён» нельзя (20.08 именно так и произошло — WB отклонил код, а
 * покупатель получил подтверждение и ссылку). Просим прислать код заново и
 * называем, где он лежит, — чаще всего присылают номер заказа или случайные
 * цифры. */
export function wbCodeRetryMessage(): string {
  return [
    "К сожалению, этот код доставки не подошёл — Wildberries его не принял.",
    "Пожалуйста, проверьте и пришлите код ещё раз: это 5-6 цифр в приложении Wildberries,"
    + " раздел \"Доставки\", рядом с QR-кодом вашего заказа.",
    "Как только код подойдёт, сразу пришлём ссылку на получение — заказ никуда не денется.",
  ].join("\n\n");
}

/** Nudge for a buyer whose gate link is still unopened.
 *
 * Two of them go out — three hours and a day after the link — and then it
 * stops: a silent buyer gets help, not pestering. Same rule as the gate message
 * itself, no messenger is named; WB penalises sellers for steering buyers off
 * the platform, and the page introduces the next step by itself. */
export function wbGateReminderMessage(
  code: string,
  denomination: number | null,
  level: number,
  origin?: string,
  sibling?: WbOrderSibling | null,
): string {
  const amount = denomination ? `${denomination.toLocaleString("ru-RU")} R$` : "ваш номинал";
  const opening = level === 1
    ? `Напоминаем: ваши ${amount} ждут получения.`
    : `Ваши ${amount} всё ещё не получены — заказ открыт, забрать можно в любой момент.`;
  return [
    opening,
    ...wbSiblingLines(sibling),
    "Откройте ссылку — код уже подставлен, вводить его вручную не нужно:",
    wbGateUrl(code, origin),
    `Если ссылка не открылась, перейдите на ${wbGuideFallbackUrl(origin)} и введите код: ${code}`,
    level === 1
      ? "На странице будет вся инструкция: указать ник Roblox, куда зачислить Robux,"
        + " и создать геймпасс по инструкции — именно через него приходят Robux."
      : "Если что-то не получается — напишите прямо в этот чат, поможем и разберёмся вместе.",
  ].join("\n\n");
}
