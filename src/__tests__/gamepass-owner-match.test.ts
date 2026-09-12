import { readFileSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..");
const guide = readFileSync(path.join(ROOT, "src/app/guide/GamepassCheck.tsx"), "utf8");
const route = readFileSync(path.join(ROOT, "src/app/api/wb-code/select-gamepass/route.ts"), "utf8");

/**
 * Ручной ввод Pass ID: найденный пасс обязан принадлежать тому аккаунту, на
 * который покупатель просит робуксы.
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
  it("страница отказывает, когда владелец пасса не тот, кого назвал покупатель", () => {
    expect(guide).toContain("const owner = typeof gp.creatorName === \"string\" ? gp.creatorName.trim() : \"\"");
    expect(guide).toContain("const claimed = (account?.username ?? nick).trim()");
    expect(guide).toContain("owner.toLowerCase() !== claimed.toLowerCase()");
    expect(guide).toContain("Этот пасс принадлежит аккаунту ${owner}");
  });

  it("владелец подставляется только когда своего ника ещё нет", () => {
    // Вход по одному номеру (ник не называли) — единственный случай, где имя
    // владельца законно становится ником заказа.
    expect(guide).toContain("if (!account && owner && NICK_RE.test(owner))");
  });

  it("сервер отвечает OWNER_MISMATCH вместо тихой подмены получателя", () => {
    expect(route).toContain("NICK_RE.test(rawNick) && rawNick.toLowerCase() !== creatorName.toLowerCase()");
    expect(route).toContain('code: "OWNER_MISMATCH"');
    expect(route).toContain("Робуксы придут владельцу пасса");
  });

  it("ник по-прежнему выводится из пасса, когда покупатель его не называл", () => {
    // Ручной вход по одной ссылке приходит без ника вовсе — там подмены нет,
    // есть единственный источник.
    expect(route).toContain("nick = creatorName;");
  });
});
