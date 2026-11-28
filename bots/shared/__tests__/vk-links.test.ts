/* Админ отвечает покупателю из ВК от СООБЩЕСТВА (11.11.2026): ссылки на
   `vk.com/id…` и `vk.com/im?sel=…` открывали диалог личного аккаунта. */
import fs from "node:fs";
import path from "node:path";
import { VK_COMMUNITY_ID, vkCommunityDialogUrl, vkDialogLink } from "../vk-links";

const ROOT = path.join(__dirname, "..", "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("ссылка на покупателя из ВК", () => {
  it("ведёт в «Сообщения» сообщества", () => {
    expect(vkCommunityDialogUrl(42)).toBe(`https://vk.com/gim${VK_COMMUNITY_ID}?sel=42`);
    expect(vkDialogLink("42", "Имя")).toBe(`<a href="https://vk.com/gim${VK_COMMUNITY_ID}?sel=42">Имя</a>`);
  });

  it("в коде нет ссылок на личный диалог или профиль, кроме намеренной для VK 901", () => {
    const offenders: string[] = [];
    for (const file of [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "bots"))]) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/https:\/\/vk\.com\/(id\$\{|im\?sel=)/.test(line)) return;
        // Недостижимому для сообщества (VK 901) пишут только с личного — профиль намеренно.
        if (file.endsWith("OrdersScreen.tsx") && lines.slice(Math.max(0, i - 25), i).some((l) => l.includes("vkUnreachable"))) return;
        offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
