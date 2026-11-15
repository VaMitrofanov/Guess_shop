/**
 * Алерт «оплачен — выдать код вручную» не дошёл ни разу (CODE-827TX8XJ,
 * 15.11.2026): в подсказке стояло голое «<код>», Telegram отклонял HTML целиком.
 */
import fs from "node:fs";
import path from "node:path";

const send = jest.fn();
jest.mock("@/lib/telegram", () => ({ sendTelegramMessage: (...a: unknown[]) => send(...a) }));
jest.mock("../../bots/shared/admin-route", () => ({
  adminTargets: async () => [{ key: "g#5", chatId: "-100", extra: { message_thread_id: 5 }, group: true }],
}));

import { notifyCodeAdmins, plainForTelegram } from "@/lib/codes/admin-notify";

describe("алерт заказа кода", () => {
  beforeEach(() => { send.mockReset(); process.env.TG_TOKEN = "t"; });

  it("Telegram отклонил разметку — повтор простым текстом", async () => {
    send.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await notifyCodeAdmins({ marker: "urgent", title: "оплачен", orderPublicId: "CODE-1", denomination: 1000, amountKopecks: 119900, next: "x" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(String(send.mock.calls[1][2])).not.toMatch(/<[a-z]/i);
    expect(String(send.mock.calls[1][2])).toContain("CODE-1");
  });

  it("plainForTelegram экранирует угловые скобки", () => {
    expect(plainForTelegram("<b>a</b> &lt;код&gt; & b")).toBe("a &lt;код&gt; &amp; b");
  });

  it("в подсказках вебхука нет голых угловых скобок", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/codes/webhook.ts"), "utf8");
    const nexts = [...src.matchAll(/next:\s*(`[^`]*`|"[^"]*")/g)].map((m) => m[1]);
    expect(nexts.length).toBeGreaterThan(0);
    for (const n of nexts) expect(n.replace(/\$\{[^}]*\}/g, "")).not.toMatch(/<[^a/]/);
  });
});
