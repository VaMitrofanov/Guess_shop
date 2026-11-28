/** 🪪 Карточка профиля (18.11.2026): имя по выбору, проверка своего имени, приветствие. */
import {
  availableNameModes, customNameProblem, greetingFor, parseProfileStyle, shownName, validateProfileStyleInput, DEFAULT_STYLE,
} from "@/lib/profile-style";

const sources = { roblox: { displayName: "Кринж", username: "Krinj_2012" }, tg: "Вадим", vk: null };

describe("имя на карточке", () => {
  it("по умолчанию — имя из Roblox и ник под ним", () => {
    expect(shownName(DEFAULT_STYLE, sources)).toEqual({ name: "Кринж", showsRoblox: true });
  });
  it("скрытое имя и своё — без ника Roblox", () => {
    expect(shownName({ ...DEFAULT_STYLE, nameMode: "hidden" }, sources)).toEqual({ name: "Игрок", showsRoblox: false });
    expect(shownName({ ...DEFAULT_STYLE, nameMode: "custom", customName: "Вадим М." }, sources)).toEqual({ name: "Вадим М.", showsRoblox: false });
  });
  it("нет ВК — вариант «из ВК» не предлагается, а сохранённый откатывается к Roblox", () => {
    expect(availableNameModes(sources)).not.toContain("vk");
    expect(shownName({ ...DEFAULT_STYLE, nameMode: "vk" }, sources).name).toBe("Кринж");
  });
  it("без Roblox — «Игрок»", () => {
    expect(shownName(DEFAULT_STYLE, { roblox: null, tg: null, vk: null }).name).toBe("Игрок");
  });
});

describe("своё имя", () => {
  it.each(["Вадим", "Глеб", "Хлебушек", "Ребекка", "Mike_07"])("пропускает «%s»", (name) => {
    expect(customNameProblem(name)).toBeNull();
  });
  it.each(["х у й", "сосу", "t.me/xx", "@nick", "a", "<script>"])("отклоняет «%s»", (name) => {
    expect(customNameProblem(name)).not.toBeNull();
  });
});

describe("разбор и проверка", () => {
  it("мусор из базы — к умолчаниям", () => {
    expect(parseProfileStyle({ nameMode: "evil", avatarMode: 1, background: "x" })).toEqual(DEFAULT_STYLE);
    expect(parseProfileStyle({ nameMode: "custom", customName: "" }).nameMode).toBe("roblox");
  });
  it("браузер не протащит неизвестный фон и пустое своё имя", () => {
    expect(validateProfileStyleInput({ nameMode: "roblox", avatarMode: "podium", background: "gold" }).ok).toBe(false);
    expect(validateProfileStyleInput({ nameMode: "custom", avatarMode: "podium", background: "violet", customName: " " }).ok).toBe(false);
    expect(validateProfileStyleInput({ nameMode: "custom", avatarMode: "bust", background: "mint", customName: " Вадим  М. " })).toEqual({
      ok: true, style: { nameMode: "custom", customName: "Вадим М.", avatarMode: "bust", background: "mint" },
    });
  });
});

describe("приветствие по часу", () => {
  it.each([[6, "Доброе утро"], [13, "Добрый день"], [19, "Добрый вечер"], [2, "Доброй ночи"], [23, "Доброй ночи"]])("%i ч → %s", (h, text) => {
    expect(greetingFor(h as number)).toBe(text);
  });
});
