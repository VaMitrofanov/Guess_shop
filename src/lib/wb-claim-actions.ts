/**
 * ↩ Какое действие WB вызвать по заявке покупателя (27.11.2026).
 * Строится только из `actions`, которые WB отдал по этой заявке.
 */
export function pickClaimActions(actions: string[]): { reject: string | null; refund: string | null; rejectNeedsComment: boolean } {
  const reject = actions.includes("rejectcustom") ? "rejectcustom" : actions.find((a) => a.startsWith("reject")) ?? null;
  const refund = actions.find((a) => a.startsWith("approve")) ?? actions.find((a) => a.startsWith("autorefund")) ?? null;
  return { reject, refund, rejectNeedsComment: reject === "rejectcustom" };
}
