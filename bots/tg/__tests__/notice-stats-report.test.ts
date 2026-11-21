jest.mock("../../shared/db", () => ({ db: {} }));
import { noticeStatsText } from "../notice-stats-report";

describe("сводка уведов за сутки", () => {
  const names = [
    { key: "-100#5", name: "Нужно действие" },
    { key: "-100#7", name: "Лента заказов" },
    { key: "-100#9", name: "Система" },
  ];

  it("темы по убыванию, нули скрыты, личка и склейка отдельными строками", () => {
    const text = noticeStatsText("15 ноября", { sent: { "-100#5": 40, "-100#7": 90, "999": 12 }, merged: 33, resurfaced: 4 }, names, ["999"]);
    expect(text).toContain("уведы за 15 ноября · 130");
    expect(text.indexOf("Лента заказов")).toBeLessThan(text.indexOf("Нужно действие"));
    expect(text).not.toContain("Система —");
    expect(text).toContain("Копии в личку — 12");
    expect(text).toContain("33 сообщ. покупателей");
    expect(text).toContain("4 уведов поднято заново");
  });
});
