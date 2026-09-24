import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  generateWbActivationCode,
  isDeliverableWbActivationCode,
  WB_ACTIVATION_CODE_LENGTH,
} from "../../bots/shared/wb-activation-code";

function read(relative: string) {
  return readFileSync(resolve(__dirname, "../..", relative), "utf8");
}

describe("WB activation code issued by the DBS gate", () => {
  const sample = Array.from({ length: 4_000 }, () => generateWbActivationCode());

  it("always produces a seven-character code the site route accepts", () => {
    // Mirrors the guard in src/app/api/wb-code/route.ts.
    const siteRe = /^[A-Z0-9]{7}$/;
    for (const code of sample) {
      expect(code).toHaveLength(WB_ACTIVATION_CODE_LENGTH);
      expect(siteRe.test(code)).toBe(true);
    }
  });

  /** Regression: a uniformly sampled code is all digits once in 16 384 draws,
   * and both bots ignore such a message because they require a letter. */
  it("always contains a letter so TG and VK recognise it in chat", () => {
    const botRe = /^[A-Za-z0-9]{7}$/;
    for (const code of sample) {
      expect(botRe.test(code) && /[A-Za-z]/.test(code)).toBe(true);
      expect(isDeliverableWbActivationCode(code)).toBe(true);
    }
  });

  it("never emits characters that are ambiguous when typed by hand", () => {
    for (const code of sample) expect(code).not.toMatch(/[IO01]/);
  });

  it("still varies across every position", () => {
    for (let index = 0; index < WB_ACTIVATION_CODE_LENGTH; index += 1) {
      expect(new Set(sample.map((code) => code[index])).size).toBeGreaterThan(1);
    }
    expect(new Set(sample).size).toBeGreaterThan(sample.length * 0.99);
  });

  it("keeps the bot guards this generator is written against", () => {
    for (const file of ["bots/tg/handlers.ts", "bots/vk/handlers.ts"]) {
      expect(read(file)).toContain("/^[A-Za-z0-9]{7}$/");
    }
    expect(read("src/app/api/wb-code/route.ts")).toContain("/^[A-Z0-9]{7}$/");
  });

  it("rejects codes the corridor would drop", () => {
    expect(isDeliverableWbActivationCode("2345678")).toBe(false);
    expect(isDeliverableWbActivationCode("ABC123")).toBe(false);
    expect(isDeliverableWbActivationCode("ABC12345")).toBe(false);
    expect(isDeliverableWbActivationCode("ABC-123")).toBe(false);
    expect(isDeliverableWbActivationCode("QUN5YFZ")).toBe(true);
  });
});
