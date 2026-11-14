import { readFileSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..");
const guide = readFileSync(path.join(ROOT, "src/app/guide/GamepassCheck.tsx"), "utf8");
const route = readFileSync(path.join(ROOT, "src/app/api/wb-code/select-gamepass/route.ts"), "utf8");

/**
 * Ручной ввод Pass ID: робуксы уходят владельцу найденного пасса, и покупатель
 * обязан это увидеть.
 *
 * Робуксы уходят ВЛАДЕЛЬЦУ геймпасса — это физика Roblox, а не наше решение.
 * До 06.09.2026 расхождение проходило молча в обе стороны: страница просто
 * добавляла чужой пасс в план (владелец читался, только если аккаунт ещё не
 * был известен), а `select-gamepass` ПЕРЕБИВАЛ названный ник именем владельца.
 * Значит вставленный чужой номер превращал заказ в заказ для постороннего
 * человека, а покупатель оставался без робуксов и без объяснения.
 *
 * Что делает это реальным: `?query=715` на проде отдавал живой чужой пасс
 * (69 R$, `ROBLOXsafeguard33`, выставлен на продажу) — то есть достаточно было
 * вбить цену вместо Pass ID. Длину закрыл `BARE_ID_RE`, владельца — эти два
 * гарда.
 */
describe("ручной Pass ID — владелец против названного ника", () => {
  /* Решение владельца 21.09.2026: для выкупа нужен только Pass ID — пасс есть,
     выставлен и цена сошлась, значит заказ принимаем. Отказ «пасс другого
     аккаунта» снят, но подмена получателя НЕ тихая: страница переключает
     карточку аккаунта на владельца пасса с пометкой, сервер пишет строку в
     заметку заказа. От случая «вбил цену вместо номера» по-прежнему защищают
     `BARE_ID_RE` (длина) и сверка цены с номиналом. */
  it("страница принимает пасс и открыто переключает получателя на владельца", () => {
    expect(guide).toContain("const owner = typeof gp.creatorName === \"string\" ? gp.creatorName.trim() : \"\"");
    expect(guide).toContain("const claimed = (account?.username ?? nick).trim()");
    expect(guide).toContain("owner.toLowerCase() !== claimed.toLowerCase()");
    expect(guide).toContain("setOwnerSwitched({ from: claimed, to: owner })");
    expect(guide).toContain("робуксы придут сюда, а не на");
    expect(guide).not.toContain("Этот пасс принадлежит аккаунту ${owner}");
  });

  it("снятый с продажи пасс по номеру не принимается", () => {
    expect(guide).toContain("if (gp.isForSale === false)");
  });

  it("владелец подставляется, когда своего ника ещё нет", () => {
    expect(guide).toContain("if (!account && owner && NICK_RE.test(owner))");
  });

  // С 24.09.2026 правило живёт в общем модуле приёма — им пользуются и касса
  // сайта, и прямой заказ ботов, а гейт ВБ его только зовёт.
  const acceptance = readFileSync(path.join(ROOT, "bots/shared/gamepass-acceptance.ts"), "utf8");

  it("сервер принимает пасс другого ника и оставляет след в заметке", () => {
    expect(route).toContain("acceptGamepasses(");
    expect(route).toContain("ownerSwitchNote(");
    expect(route).not.toContain('code: "OWNER_MISMATCH"');
    expect(acceptance).toContain("owner.toLowerCase() !== claimed.toLowerCase() ? claimed : null");
    expect(acceptance).toContain("[ПАСС ДРУГОГО НИКА");
    expect(acceptance).toContain("робуксы владельцу пасса");
  });

  it("ник заказа всегда берётся у пасса — робуксы уходят его владельцу", () => {
    expect(route).toContain("const nick = accepted.recipient");
    expect(acceptance).toContain("const recipient = NICK_RE.test(owner) ? owner");
  });
});
