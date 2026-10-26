import { numbersIn, readPendingFromText, pendingVerdict, pendingCheckNote, pendingOkReplyText } from "../pending-ocr";

describe("числа в строке", () => {
  it.each([
    ["Pending Robux 1,000", [1000]],
    ["Pending Robux 1 000", [1000]],
    ["Pending Robux 12500", [12500]],
    ["Ожидающие Robux 2.143", [2143]],
    ["Past Week 10/27/2026 12:30", []],
    ["27.10.2026", []],
  ])("%s", (line, want) => expect(numbersIn(line)).toEqual(want));
});

describe("разбор текста Transactions", () => {
  const desktop = [
    "Kabsjdvdnd 13+",
    "My Transactions",
    "Summary Purchases Sales Pending Robux",
    "Past 30 Days",
    "Sales of Goods 0",
    "Premium Payouts 0",
    "Pending Robux 1,000",
    "Incoming Robux Total 0",
  ].join("\n");

  it("число из строки Pending Robux, а не из вкладки «Pending Robux» без числа", () => {
    const r = readPendingFromText(desktop, "Kabsjdvdnd");
    expect(r).toEqual({ labelFound: true, pending: 1000, nickSeen: true });
    expect(pendingVerdict(r, 1000)).toBe("ok");
    expect(pendingVerdict(r, 1500)).toBe("low");
  });

  it("«0» со значком робукса, прочитанный буквой (©o, Oo) — это 0", () => {
    expect(readPendingFromText("Pending Robux ©o").pending).toBe(0);
    expect(readPendingFromText("Pending Robux Oo").pending).toBe(0);
    expect(readPendingFromText("Pending Robux © 715").pending).toBe(715);
    expect(readPendingFromText("Summary Purchases Sales Pending").pending).toBeNull();
  });

  it("значение уехало на следующую строку", () => {
    const r = readPendingFromText("Pending Robux\n715\nIncoming 0", null);
    expect(r.pending).toBe(715);
    expect(r.nickSeen).toBeNull();
  });

  it("ноль — это «меньше», а не «не прочиталось»", () => {
    const r = readPendingFromText("Pending Robux 0", "abc");
    expect(pendingVerdict(r, 500)).toBe("low");
    expect(r.nickSeen).toBe(false);
  });

  it("OCR путает букву в нике — всё равно узнаём", () => {
    expect(readPendingFromText("KabsjdvdnD1 Pending Robux 5", "Kabsjdvdnd").nickSeen).toBe(true);
    expect(readPendingFromText("Kabsjdvdmd\nPending Robux 5", "Kabsjdvdnd").nickSeen).toBe(true);
  });

  it("без подписи Pending — не доверяем никаким числам", () => {
    const r = readPendingFromText("Robux 1000\nBalance 1000", null);
    expect(pendingVerdict(r, 500)).toBe("unreadable");
  });
});

describe("тексты", () => {
  it("заметка менеджеру и ответ покупателю", () => {
    expect(pendingCheckNote({ labelFound: true, pending: 1000, nickSeen: true }, "ok", 1000)).toContain("✅ в Pending 1000");
    expect(pendingCheckNote({ labelFound: true, pending: 0, nickSeen: false }, "low", 500)).toContain("НЕ найден");
    expect(pendingOkReplyText(1000)).toContain("Pending Robux — 1000");
  });
});
