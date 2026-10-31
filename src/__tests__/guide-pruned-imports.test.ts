/**
 * Сборка Guide (`Dockerfile.guide`) вырезает часть `src/app`. Если оставшийся
 * файл импортирует вырезанный путь, Guide не собирается — так 30–31.10.2026
 * `/api/twa/{buyers,risks}` реэкспортировали `@/app/api/admin/...`, и восемь
 * выкаток Guide подряд упали на «Module not found».
 */
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");

function prunedDirs(): string[] {
  const docker = fs.readFileSync(path.join(root, "Dockerfile.guide"), "utf8");
  const block = docker.match(/RUN rm -rf \\\n([\s\S]*?)&& rm -f/);
  if (!block) throw new Error("не нашёл блок rm -rf в Dockerfile.guide");
  return block[1]
    .split("\n")
    .map((l) => l.replace(/\\$/, "").trim())
    .filter((l) => l.startsWith("src/"));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("Guide: оставшиеся файлы не тянут вырезанные маршруты", () => {
  const pruned = prunedDirs();

  it("список вырезаемых папок прочитан", () => {
    expect(pruned).toContain("src/app/api/admin");
  });

  it("нет импортов из вырезанных папок", () => {
    const offenders: string[] = [];
    // Next компилирует каждый оставшийся файл src/app; компоненты вне src/app
    // попадают в сборку, только если их кто-то импортирует.
    for (const file of walk(path.join(root, "src/app"))) {
      const rel = path.relative(root, file);
      if (pruned.some((p) => rel === p || rel.startsWith(p + "/"))) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/from\s+["']@\/([^"']+)["']/g)) {
        const target = "src/" + m[1];
        if (pruned.some((p) => target === p || target.startsWith(p + "/"))) {
          offenders.push(`${rel} → @/${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
