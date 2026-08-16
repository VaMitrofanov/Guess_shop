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
 * Deliberately names no messenger: Wildberries penalises sellers for steering
 * buyers to outside platforms, so the page itself introduces the next step. */
export function wbGateMessage(code: string, denomination: number | null, origin?: string): string {
  const amount = denomination ? `${denomination.toLocaleString("ru-RU")} R$` : "ваш номинал";
  return [
    `Спасибо, код доставки получен! Заказ подтверждён, ${amount} готовы к зачислению.`,
    "Откройте ссылку — код уже подставлен, вводить его вручную не нужно:",
    wbGateUrl(code, origin),
    `Если ссылка не открылась, перейдите на ${wbGuideFallbackUrl(origin)} и введите код: ${code}`,
    "На этой странице будет вся дальнейшая инструкция — нужно будет указать ник Roblox, куда зачислить Robux.",
  ].join("\n\n");
}
