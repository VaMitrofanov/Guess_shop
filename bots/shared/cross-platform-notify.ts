import { formatAdminNotice, orderRef } from "./notify-format";
import type { ConflictReason } from "./cross-platform-claim";

/* ─────────────────────────────────────────────────────────────────────────────
   Тексты кросс-платформенной привязки — один на все площадки.

   Сайт, TG-бот и VK-бот показывают человеку одно и то же событие; расхождение
   в словах читается как «системы не знают друг о друге» — ровно то ощущение,
   от которого эта работа и затевалась.
   ───────────────────────────────────────────────────────────────────────── */

const PLATFORM_WORD = { TG: "Telegram", VK: "ВКонтакте" } as const;
export type PlatformKey = keyof typeof PLATFORM_WORD;

export function platformWord(key: PlatformKey): string {
  return PLATFORM_WORD[key];
}

/** Заказ нашёлся и площадки связаны. `from` — где заказ был оформлен. */
export function xlinkLinkedText(code: string, from: PlatformKey | null): string {
  const origin = from ? ` — он был оформлен через ${PLATFORM_WORD[from]}` : "";
  return (
    `✅ Нашёл твой заказ по коду ${code}${origin}.\n\n` +
    `Теперь он и здесь: статус, выкуп и бонусы приходят на обе площадки. ` +
    `Ничего заново оформлять не нужно.`
  );
}

/** Код чужой, но владельцу можно написать — ждём его ответа. */
export function xlinkWaitingText(): string {
  return (
    `🔒 Этот код уже активирован на другой площадке.\n\n` +
    `Если это твой заказ — я уже спросил подтверждение там, где он был оформлен. ` +
    `Как только придёт «да», открою заказ здесь и напишу.`
  );
}

/** Владельцу: у него просят доступ к его же заказу с другой площадки. */
export function xlinkOwnerAskText(code: string, claimant: string, platform: PlatformKey): string {
  return (
    `🔑 Доступ к заказу <code>${code}</code>\n\n` +
    `Из ${PLATFORM_WORD[platform]} просят открыть этот заказ: <b>${claimant}</b>.\n\n` +
    `Это ты перешёл на другую площадку? Нажми «Да» — заказ откроется и там, ` +
    `а статус и бонусы будут приходить в оба места.\n\n` +
    `Если это не ты — просто не отвечай, ничего не изменится.`
  );
}

export function xlinkOwnerConfirmedText(code: string, platform: PlatformKey): string {
  return `✅ Готово: заказ ${code} теперь открыт и в ${PLATFORM_WORD[platform]}.`;
}

/** Настоящий тупик: второй аккаунт на той же площадке. */
export function xlinkConflictText(): string {
  return (
    `⚠️ Этот код уже активирован в другом аккаунте на этой же площадке.\n\n` +
    `Если код твой — напиши нам, разберёмся вручную.`
  );
}

const CONFLICT_WHY: Record<ConflictReason, string> = {
  owner_has_same_platform: "у владельца кода уже есть аккаунт на этой же площадке — это две разные учётки, а не переход",
  claimant_has_own_orders: "у предъявителя своя история заказов, а владельца кода не спросить",
};

/**
 * Алерт админам. Красный остался ровно за настоящим вторым аккаунтом:
 * до 12.09.2026 под него попадал и сам владелец при повторном входе (4 из 4
 * срабатываний за сутки были ложными), и сигнал перестал что-либо значить.
 */
export function xlinkAdminNotice(input: {
  kind: "linked" | "asked" | "conflict";
  code: string;
  denomination?: number | null;
  ownerLabel: string;
  claimantLabel: string;
  platform: PlatformKey;
  reason?: ConflictReason;
}): string {
  const ref = orderRef({ code: input.code, denomination: input.denomination ?? undefined }, [input.ownerLabel]);
  if (input.kind === "conflict") {
    return formatAdminNotice({
      marker: "urgent",
      zone: "САЙТ",
      title: "код активируют вторым аккаунтом",
      lines: [
        ref,
        `👤 Пытался: ${input.claimantLabel} (${PLATFORM_WORD[input.platform]})`,
        `🕵️ ${CONFLICT_WHY[input.reason ?? "owner_has_same_platform"]}`,
      ],
      next: "проверить, кому код принадлежит, и при подтверждении заморозить его",
    });
  }
  if (input.kind === "asked") {
    return formatAdminNotice({
      marker: "waiting",
      zone: "САЙТ",
      title: "просят открыть заказ со второй площадки",
      lines: [
        ref,
        `👤 Просит: ${input.claimantLabel} (${PLATFORM_WORD[input.platform]})`,
        `📨 Подтверждение ушло владельцу — ждём его «да»`,
      ],
      next: "ничего: владелец решает сам, вмешиваться только по его просьбе",
    });
  }
  return formatAdminNotice({
    marker: "done",
    zone: "САЙТ",
    title: "покупатель перешёл на вторую площадку",
    lines: [
      ref,
      `👤 Теперь и в ${PLATFORM_WORD[input.platform]}: ${input.claimantLabel}`,
      `🔗 Аккаунты связаны по коду — спросить владельца было нельзя (нет диалога)`,
    ],
    next: null,
  });
}
