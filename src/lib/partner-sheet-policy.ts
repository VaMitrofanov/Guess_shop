export type SettledPartnerRowPolicy = {
  preserveTask: boolean;
  allowReplacementTask: boolean;
  restoreDoneStatus: boolean;
};

/**
 * A physical Google Sheet row becomes a permanent idempotency key after payout.
 * Content edits are recorded for audit, but may never free externalRowId or create
 * another task/BUYOUT from the same row.
 */
export function settledPartnerRowPolicy(taskStatus: string | null, sheetStatus: string): SettledPartnerRowPolicy {
  const settled = taskStatus === "DONE";
  return {
    preserveTask: settled,
    allowReplacementTask: !settled,
    restoreDoneStatus: settled && sheetStatus.trim().toLowerCase() !== "готово",
  };
}

/**
 * Column E is the current validation result, not an append-only log. A corrected
 * gamepass clears the old error; a still-invalid row replaces it with the latest
 * error so Anton never sees a stale reason.
 */
export function partnerGamepassCommentValue(valid: boolean, latestError: string) {
  return valid ? "" : latestError;
}
