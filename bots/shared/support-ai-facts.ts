/* ─────────────────────────────────────────────────────────────────────────────
   🔎 Факты для ИИ-поддержки (27.11.2026, владелец: «обязательно»).

   До этого ИИ видел лишь «пасс прислан» и «ошибка выкупа (нужен человек)» и
   на треть обращений («пасс не получается») отвечал «на каком шаге застряли?».
   Теперь перед ответом:
   • пасс проверяется вживую — цена против нужной, «в продаже», Managed
     pricing, региональная цена, закрытая игра, 18+;
   • ошибка выкупа и заморозка переводятся в причину, которую можно сказать
     покупателю. Внутреннее (плохой отзыв, риски, имена) — только «проверка
     менеджера».
   Любой сбой проверки = строки нет: ИИ ответит как раньше.
   ───────────────────────────────────────────────────────────────────────── */


const CHECK_TIMEOUT_MS = 7_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(() => null);
}

/** Номер пасса из ссылки или голого ID. */
export function gamepassIdOf(urlOrId: string | null | undefined): string | null {
  const m = String(urlOrId ?? "").match(/(\d{6,12})/);
  return m ? m[1] : null;
}

export interface PassFacts {
  price: number | null;
  forSale: boolean | null;
  managed: boolean;
  regional: boolean;
  privateGame: boolean;
  ageRestricted: boolean;
  notFound: boolean;
}

/** Чистая часть: факты пасса → строка для модели. */
export function describePass(id: string, expected: number | null, f: PassFacts): string {
  if (f.notFound) return `пасс ${id}: Roblox его не находит (удалён или неверный номер)`;
  const problems: string[] = [];
  if (f.forSale === false) problems.push("не в продаже — выключен «Item for sale»");
  if (expected && f.price !== null && f.price !== expected) problems.push(`цена ${f.price} R$ вместо нужных ${expected} R$`);
  if (f.managed) problems.push("включён Managed pricing — Roblox сам меняет цену");
  if (f.regional) problems.push("включены региональные цены (Regional pricing)");
  return problems.length
    ? `ПРОВЕРКА ПАССА ${id} сейчас: ${problems.join("; ")}. Подскажи, что именно поправить.`
    : `ПРОВЕРКА ПАССА ${id} сейчас: всё в порядке (цена ${f.price ?? "?"} R$, в продаже) — выкуп за нами.`;
}

/** Живая проверка пасса. `null` — Roblox не ответил вовремя. */
export async function gamepassDiagnosis(urlOrId: string | null | undefined, expected: number | null): Promise<string | null> {
  const id = gamepassIdOf(urlOrId);
  if (!id) return null;
  // Динамически: модуль Roblox тяжёлый, а чистые функции файла нужны и тестам.
  const { getGamepassDetails, getGamepassProductInfo } = await import("./roblox");
  const [info, details] = await Promise.all([
    withTimeout(getGamepassProductInfo(id), CHECK_TIMEOUT_MS),
    withTimeout(getGamepassDetails(id), CHECK_TIMEOUT_MS),
  ]);
  if (!info && !details) return null;
  if (details?.validationSkipped && !info) return null;
  const facts: PassFacts = {
    price: info?.priceInRobux ?? details?.price ?? null,
    forSale: info ? info.isForSale : details ? details.isActive : null,
    managed: Boolean(info?.isManagedPricing),
    regional: Boolean(info?.hasUnsafeBuyerPrice),
    privateGame: Boolean(details?.isGamePrivate),
    ageRestricted: Boolean(details?.isAgeRestricted),
    notFound: !info && Boolean(details?.isNotInCatalog),
  };
  return describePass(id, expected, facts);
}

/**
 * Почему заказ стоит — словами, которые можно сказать покупателю. Плохой
 * отзыв, риски и прочее внутреннее превращаются в «нужна проверка менеджера».
 */
export function orderProblemRu(o: {
  status: string;
  buyoutErrorCode?: string | null;
  adminNote?: string | null;
  heldAt?: Date | string | null;
  heldReason?: string | null;
}): string | null {
  const note = o.adminNote ?? "";
  const lastNote = note.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
  if (o.heldAt) {
    const r = o.heldReason ?? "";
    if (/^Заказ отменён на WB|деньги вернулись/i.test(r)) return "заказ отменён на WB, деньги вернулись покупателю";
    if (/^Возврат на WB одобрен/.test(r)) return "возврат на WB одобрен — выкупа не будет";
    if (/Платёж возвращён/.test(r)) return "платёж возвращён покупателю";
    if (/висит|актуальн/i.test(r)) return "ждём, что покупатель подтвердит: заказ ещё нужен";
    return "заказ на проверке у менеджера (причину покупателю не называем)";
  }
  if (o.status === "ERROR") {
    if (o.buyoutErrorCode === "REGIONAL_PRICE" || /регион/i.test(lastNote)) return "выкуп встал: у пасса включены региональные цены — выключить Regional pricing";
    if (/\[ЦЕНА-СТОП\]/.test(lastNote)) return "выкуп встал: цена пасса не совпала с нужной — проверить цену и Managed pricing";
    if (/\[ПРОДАВЕЦ-СТОП\]/.test(lastNote)) return "выкуп встал: пасс принадлежит не тому аккаунту, что в заказе";
    if (/\[ПАСС-СТОП\]/.test(lastNote)) return "выкуп встал: пасс изменился после отправки — прислать заново";
    return "выкуп встал, нужен менеджер";
  }
  return null;
}

/**
 * 📷 Распознавание скриншота Transactions (27.11.2026, владелец: «распознавание
 * тоже нужно»). Тот же локальный Tesseract, что в «Робуксов нет» (`pending-ocr`).
 * Строка — только когда на скрине есть «Pending»: иначе модель смотрит сама.
 */
export async function screenshotFact(imageBase64: string, amount: number | null | undefined, nick?: string | null): Promise<string | null> {
  try {
    const ocr = await import("./pending-ocr");
    const buf = Buffer.from(imageBase64, "base64");
    const text = await withTimeout(ocr.ocrImageBufferText(buf), 20_000);
    if (!text) return null;
    const read = ocr.readPendingFromText(text, nick);
    if (!read.labelFound) return null;
    const verdict = ocr.pendingVerdict(read, amount);
    if (read.pending === null) return "РАСПОЗНАВАНИЕ СКРИНШОТА: строка Pending есть, число не прочиталось — смотри картинку сама.";
    return `РАСПОЗНАВАНИЕ СКРИНШОТА: в Pending ${read.pending} R$` +
      (amount ? (verdict === "ok" ? ` — не меньше суммы заказа ${amount} R$, всё в порядке` : ` — меньше суммы заказа ${amount} R$`) : "") +
      (read.nickSeen === false && nick ? `; ник ${nick} на скрине не виден — возможно, другой аккаунт` : "") + ".";
  } catch {
    return null;
  }
}
