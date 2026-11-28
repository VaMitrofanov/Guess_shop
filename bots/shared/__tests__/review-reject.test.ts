jest.mock("../db", () => ({ db: {} }));

import { CB } from "../admin";
import {
  escapeReviewReason,
  normalizeCustomReviewReason,
  REVIEW_REJECT_CUSTOM_MAX,
  REVIEW_REJECT_REASONS,
  reviewRejectReasonText,
} from "../review-reject";

// CUID — 25 символов: две штуки в callback_data плюс ключ.
const CUID = "c".repeat(25);

describe("причины отказа по отзыву", () => {
  it("каждая кнопка влезает в 64 байта callback_data Telegram", () => {
    for (const r of REVIEW_REJECT_REASONS) {
      expect(Buffer.byteLength(CB.reviewRejectReason(CUID, CUID, r.key))).toBeLessThanOrEqual(64);
    }
    expect(Buffer.byteLength(CB.reviewRejectCustom(CUID, CUID))).toBeLessThanOrEqual(64);
  });

  it("ключи уникальны, «rrt:» не путается с «rr:»", () => {
    const keys = REVIEW_REJECT_REASONS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(CB.reviewRejectCustom(CUID, CUID).startsWith("rr:")).toBe(false);
  });

  it("старые ключи из уже разосланных карточек по-прежнему понимаются", () => {
    for (const key of ["blur", "notpub", "wrong"]) expect(reviewRejectReasonText(key)).not.toBeNull();
  });

  it("своя причина: пустую не принимаем, длинную режем, HTML экранируем", () => {
    expect(normalizeCustomReviewReason("   ")).toBeNull();
    expect(normalizeCustomReviewReason("x".repeat(900))!.length).toBe(REVIEW_REJECT_CUSTOM_MAX);
    expect(escapeReviewReason("<b>&")).toBe("&lt;b&gt;&amp;");
  });
});
