import { readFileSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/**
 * Аудит бесполезен, если его не вызывают в момент, когда покупатель что-то
 * сделал. Эти проверки держат сами точки подключения — их легко потерять при
 * рефакторинге, и потеря будет молчаливой до следующего спора.
 */
describe("подключение следа покупателя", () => {
  it("ник пишется ДО дедупликации заметки — иначе совпавший ник не попадёт в след", () => {
    // Ровно этот случай и оказался главным в споре по CEALJKV.
    for (const file of ["bots/shared/nick.ts", "src/lib/capture-nick.ts"]) {
      const src = read(file);
      const audit = src.indexOf("auditNickEntered(");
      const dedupe = src.indexOf("robloxUsername?.toLowerCase() === nick.toLowerCase()");
      expect(audit).toBeGreaterThan(-1);
      expect(dedupe).toBeGreaterThan(-1);
      expect(audit).toBeLessThan(dedupe);
    }
  });

  it("присланный геймпасс пишется в обоих ботах вместе с владельцем от Roblox", () => {
    for (const file of ["bots/tg/handlers.ts", "bots/vk/handlers.ts"]) {
      const src = read(file);
      expect(src).toContain("auditGamepassSubmitted(");
      expect(src).toContain("creatorName: validatedCreator");
    }
  });

  it("выбор пасса на сайте тоже попадает в след", () => {
    const src = read("src/app/api/wb-code/select-gamepass/route.ts");
    expect(src).toContain("auditGamepassSubmitted(");
    expect(src).toContain("site-one-tap");
    expect(src).toContain("site-manual-link");
  });

  it("след читается из карточки заказа", () => {
    expect(read("src/app/api/twa/orders/route.ts")).toContain('action === "order-audit"');
    expect(read("src/app/twa/_components/screens/OrdersScreen.tsx")).toContain("AuditTrail");
  });
});
