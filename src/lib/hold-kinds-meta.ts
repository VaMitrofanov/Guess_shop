/** Подвкладки «Заморожены» — без серверных зависимостей, читает и клиент. */
export const HOLD_KINDS = ["review", "claim", "stale", "manual"] as const;
export type HoldKind = (typeof HOLD_KINDS)[number];

export const HOLD_KIND_META: Record<HoldKind, { label: string; icon: string; hint: string }> = {
  review: { label: "Отзыв", icon: "★", hint: "покупатель поставил ★1–3 — заморозил гейт" },
  claim:  { label: "Возврат", icon: "↩", hint: "заявка на возврат, отмена или возврат денег" },
  stale:  { label: "Висяк", icon: "⏳", hint: "висит без выкупа больше 21 дня — подтвердить актуальность" },
  manual: { label: "Вручную", icon: "✋", hint: "заморозил кто-то из админов" },
};

export function isHoldKind(value: unknown): value is HoldKind {
  return typeof value === "string" && (HOLD_KINDS as readonly string[]).includes(value);
}

