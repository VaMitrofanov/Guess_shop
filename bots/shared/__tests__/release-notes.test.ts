import { existsSync } from "node:fs";
import {
  RELEASE_NOTES,
  findNote,
  formatAdminUpdate,
  tgHtmlProblems,
  visibleText,
  TG_CAPTION_LIMIT,
  unsentNotes,
  vkPostText,
  type ReleaseNote,
} from "../release-notes";

describe("release notes catalogue", () => {
  test("ids are unique, dated and stable-shaped", () => {
    const ids = RELEASE_NOTES.map((note) => note.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const note of RELEASE_NOTES) {
      expect(note.id).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
      expect(note.id.startsWith(note.date)).toBe(true);
      // callback_data Telegram ≤ 64 байт: `rn:skip:` + id.
      expect(Buffer.byteLength(`rn:skip:${note.id}`)).toBeLessThanOrEqual(64);
      expect(note.admin.length).toBeGreaterThanOrEqual(1);
      expect(note.admin.length).toBeLessThanOrEqual(5);
    }
  });

  test("admin and customer texts fit Telegram and VK limits", () => {
    for (const note of RELEASE_NOTES) {
      expect(formatAdminUpdate(note).length).toBeLessThanOrEqual(4000);
      if (note.public) {
        expect(visibleText(note.public.tgHtml).length).toBeLessThanOrEqual(TG_CAPTION_LIMIT);
        expect(tgHtmlProblems(note.public.tgHtml)).toEqual([]);
        expect(note.public.vkText).not.toMatch(/<[a-z]/i); // стена ВК без разметки
        expect(note.public.vkText.length).toBeLessThanOrEqual(4000);
        for (const row of note.public.buttons ?? []) {
          for (const b of row) expect(b.url).toMatch(/^https:\/\//);
        }
      }
    }
  });

  test("customer posts never name a Pending deadline (owner rule 26.10.2026)", () => {
    for (const note of RELEASE_NOTES) {
      if (!note.public) continue;
      expect(`${note.public.tgHtml} ${note.public.vkText}`).not.toMatch(/\d+\s*(дн|дня|дней|час)/i);
    }
  });

  test("admin message escapes HTML and shows the todo line", () => {
    const note: ReleaseNote = { id: "2026-01-01-x", date: "2026-01-01", title: "A <b>", admin: ["1 < 2 & 3"], todo: "включить флаг" };
    const html = formatAdminUpdate(note);
    expect(html).toContain("A &lt;b&gt;");
    expect(html).toContain("1 &lt; 2 &amp; 3");
    expect(html).toContain("👉 включить флаг");
    expect(html).toContain("01.01.2026");
  });

  test("only unsent notes are delivered, oldest first", () => {
    const notes: ReleaseNote[] = [
      { id: "2026-02-01-b", date: "2026-02-01", title: "b", admin: ["b"] },
      { id: "2026-01-01-a", date: "2026-01-01", title: "a", admin: ["a"] },
      { id: "2026-03-01-c", date: "2026-03-01", title: "c", admin: ["c"] },
    ];
    expect(unsentNotes(["2026-02-01-b"], notes).map((n) => n.id)).toEqual(["2026-01-01-a", "2026-03-01-c"]);
    expect(unsentNotes(notes.map((n) => n.id), notes)).toEqual([]);
    // Запись с будущей датой ждёт своего дня (15.11.2026).
    const later = [...notes, { ...notes[0], id: "2099-12-01-x", date: "2099-12-01" }];
    expect(unsentNotes([], later).map((n) => n.id)).not.toContain("2099-12-01-x");
    expect(unsentNotes([], later, new Date("2099-12-01T09:00:00Z")).map((n) => n.id)).toContain("2099-12-01-x");
  });

  test("covers referenced by notes exist in bots/shared/assets/updates", () => {
    for (const note of RELEASE_NOTES) {
      if (note.public?.cover) expect(existsSync(`${__dirname}/../assets/updates/${note.public.cover}`)).toBe(true);
    }
  });

  test("Telegram markup checker catches unknown and unclosed tags", () => {
    expect(tgHtmlProblems("<b>ok</b> <blockquote expandable>x</blockquote> <tg-spoiler>s</tg-spoiler>")).toEqual([]);
    expect(tgHtmlProblems("<div>x</div>").length).toBeGreaterThan(0);
    expect(tgHtmlProblems("<b>x").length).toBeGreaterThan(0);
    expect(visibleText("<b>a &amp; b</b>")).toBe("a & b");
    const note: ReleaseNote = { id: "2026-01-01-v", date: "2026-01-01", title: "v", admin: ["v"], public: { tgHtml: "<b>Привет</b>", vkText: "Привет" } };
    expect(vkPostText(note)).toBe("Привет");
    expect(vkPostText({ ...note, public: undefined })).toBeNull();
    expect(findNote("nope")).toBeUndefined();
  });
});
