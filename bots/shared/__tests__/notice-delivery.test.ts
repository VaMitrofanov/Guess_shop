import { completedNoticeAuditLine } from "../notice-delivery";

/* Строка следа доставки — то, что админ читает в карточке заказа. По 49ANALQ
   её не было вовсе, и «не дошло» выглядело неотличимо от «отправлено». */

describe("след доставки уведомления о выкупе", () => {
  it("недоставка называется прямо", () => {
    const line = completedNoticeAuditLine({ delivered: false, bonusDelivered: false, channel: "tg" }, "2026-09-08 19:00");
    expect(line).toContain("[УВЕД-НЕ-ДОШЛО 2026-09-08 19:00]");
    expect(line).toContain("TG");
    expect(line).toContain("покупатель НЕ знает");
  });

  it("дошло главное, не дошло бонусное — это отдельный случай", () => {
    const line = completedNoticeAuditLine({ delivered: true, bonusDelivered: false, channel: "vk" }, "s");
    expect(line).toContain("о выкупе сказали");
    expect(line).toContain("не дошло");
    expect(line).not.toContain("НЕ ДОШЛО");
  });

  it("успех тоже оставляет след — иначе «нет строки» значило бы и то, и другое", () => {
    expect(completedNoticeAuditLine({ delivered: true, bonusDelivered: true, channel: "tg" }, "s"))
      .toContain("покупатель извещён о выкупе");
  });

  it("клиент без TG и VK: сказать некому, и это видно", () => {
    expect(completedNoticeAuditLine({ delivered: false, bonusDelivered: false, channel: "none" }, "s"))
      .toContain("сказать о выкупе некому");
  });
});
