#!/usr/bin/env node
/**
 * Анонс обновлённой инструкции: «сделаем геймпасс за тебя по ключу».
 *
 * Безопасен по умолчанию: без `--publish` только печатает финальные тексты для
 * Telegram и ВКонтакте и никуда их не отправляет.
 *
 * Живая публикация проходит ТОЛЬКО через preflight — тот же приём, что у
 * `broadcast-site-launch.mjs`, где анонс невозможно отправить при выключенном
 * эквайринге. Здесь два условия, и оба про то, о чём мы собираемся объявить:
 *
 *   1. страница инструкции отдаёт `keyAutoEnabled: true` — дверь «сделаем за
 *      тебя» реально видна покупателю (флаг `GAMEPASS_AUTOCREATE` включён);
 *   2. `POST /api/roblox/gamepass-create` с заведомо неверным ключом на ник с
 *      опубликованной игрой отвечает `bad_key` — значит запрос доходит до
 *      Roblox и отвергается именно по ключу. Ответ `disabled` (метод выключен),
 *      404 (роут не выкачен) или `no_universe` (мост не дошёл до Open Cloud)
 *      публикацию запрещают: объявлять то, что не работает, нельзя.
 *
 * Preflight НЕ проверяет главного — что настоящий ключ создаёт настоящий пасс.
 * Это делается руками один раз перед анонсом (см. HANDOFF, «боевой прогон»).
 *
 * Использование:
 *   node scripts/broadcast-guide-update.mjs             # только напечатать
 *   node scripts/broadcast-guide-update.mjs --publish   # опубликовать
 *
 * Env для `--publish`: TG_TOKEN, TG_CHANNEL_ID, VK_TOKEN, VK_GROUP_ID.
 */

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const PUBLISH = process.argv.includes("--publish");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--publish");
if (unknownArgs.length) throw new Error(`Неизвестные аргументы: ${unknownArgs.join(", ")}`);

const SITE_URL = "https://robloxbank.ru/";
const GUIDE_URL = new URL("guide?source=wb&test=1", SITE_URL).toString();
const CREATE_URL = new URL("api/roblox/gamepass-create", SITE_URL).toString();
/** Ник с опубликованной игрой — иначе проверка упрётся в `no_universe` раньше Roblox. */
const PREFLIGHT_NICK = process.env.GAMEPASS_PREFLIGHT_NICK?.trim() || "KrytishVadim4ick";

const TG_TEXT = `🔑 <b>Теперь геймпасс можно не создавать — мы сделаем его за вас</b>

Друзья, мы обновили инструкцию.

Самое частое место, где застревал заказ, — создание геймпасса. Шагов много, экраны Roblox на телефоне и на компьютере разные, а ошибиться можно на любом.

Теперь этого можно не делать вовсе.

<b>Как это работает</b>

1. Открываете инструкцию и вводите свой ник Roblox.
2. Мы смотрим, что у вас уже выставлено, — часто заказ собирается из готового, и делать вообще ничего не нужно.
3. Если геймпасса не хватает — выбираете, как его сделать:

• <b>Создам сам</b> — та же пошаговая инструкция, но теперь по одному шагу за раз, с картинкой на каждое нажатие;
• <b>Сделайте за меня</b> — присылаете один ключ из Roblox, и мы создаём геймпасс нужной цены сами. Минута;
• <b>Он у меня уже есть</b> — присылаете номер геймпасса, и мы находим его, даже если игра скрыта из поиска.

<b>Про ключ — честно</b>

• <b>Пароль от Roblox не нужен</b> и никогда не понадобится. Мы его не спрашиваем ни при каких обстоятельствах.
• Ключ выпускаете вы сами в Creator Hub, за минуту, по нашим скриншотам.
• Он умеет ровно одно — создавать геймпассы на вашем аккаунте. Ни робуксов, ни покупок, ни входа в аккаунт он не даёт.
• Хранится у нас в зашифрованном виде: чтобы поправить геймпасс без вас, если что-то съедет, и чтобы в следующий заказ вам уже ничего не делать.
• Если передумали — ключ удаляется в Creator Hub в одно нажатие, там же, где вы его создали.

<b>Один раз — и больше не возвращаться</b>

Ключ можно привязать заранее, в личном кабинете на сайте. Тогда в следующий заказ вам останется <b>только оплатить</b>: мы увидим, что геймпасса не хватает, и создадим его сами — писать никому не нужно.

🔗 <a href="https://robloxbank.ru/dashboard">Привязать ключ в кабинете</a> — там же рядом лежит инструкция со скриншотами и проверка: вставили ключ, увидели «принят», и всё.

<b>Что ещё изменилось</b>

• Цена геймпасса подставляется автоматически — набирать её руками не нужно.
• Заказ на 2000 R$ с карточки Wildberries закрывается двумя геймпассами вместо одного дорогого: выкупаем быстрее, а сумма у вас ровно та же.
• Инструкция сама показывает, что именно осталось сделать, — а не всё подряд.

<b>Где посмотреть</b>

• Купили карточку на Wildberries — откройте свою инструкцию по ссылке из бота или с карточки: там сразу ваш заказ и ваш номинал.
• Покупаете на сайте — всё то же самое открывается при оформлении.
• Просто посмотреть, как это работает: <a href="https://robloxbank.ru/guide?source=site&amp;flow=order&amp;amount=1000">пример на 1000 R$</a>

💬 Поддержка: @RobloxBank_PA

Если геймпасс не получается — просто напишите нам. Разберёмся вместе. 💜`;

const VK_TEXT = TG_TEXT
  .replaceAll(/<a href="([^"]+)">([^<]+)<\/a>/g, "$2: $1")
  .replaceAll(/<\/?b>/g, "")
  // В HTML-ссылке амперсанд обязан быть экранирован, в тексте ВК — наоборот:
  // `&amp;` в адресе сломает ссылку.
  .replaceAll("&amp;", "&");

async function preflight() {
  const problems = [];

  const guide = await fetch(GUIDE_URL, { headers: { "user-agent": "RobloxBank-preflight" } });
  const html = await guide.text().catch(() => "");
  if (!guide.ok) problems.push(`инструкция отвечает HTTP ${guide.status}`);
  else if (!html.includes("keyAutoEnabled")) problems.push("на странице нет блока «сделаем за тебя» — старая сборка");
  else if (!/keyAutoEnabled\\?":\s*true/.test(html)) problems.push("GAMEPASS_AUTOCREATE выключен — дверь ключа покупателю не видна");

  const res = await fetch(CREATE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key: "preflight-invalid-key-000000000000000000",
      nick: PREFLIGHT_NICK,
      targets: [100],
    }),
  });
  const body = await res.json().catch(() => null);
  if (res.status === 404) problems.push("роут создания выключен флагом (404)");
  else if (res.status !== 200) problems.push(`роут создания отвечает HTTP ${res.status}`);
  else if (body?.error === "no_universe") problems.push(`мост не дошёл до Open Cloud (no_universe у ${PREFLIGHT_NICK})`);
  else if (body?.error !== "bad_key") problems.push(`ожидали bad_key, получили ${JSON.stringify(body)}`);

  return problems;
}

async function tgPublish(text) {
  const token = process.env.TG_TOKEN;
  const chat = process.env.TG_CHANNEL_ID;
  if (!token || !chat) throw new Error("Нет TG_TOKEN / TG_CHANNEL_ID");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`Telegram: ${JSON.stringify(body)}`);
  return body.result.message_id;
}

async function vkPublish(text) {
  const token = process.env.VK_TOKEN;
  const group = process.env.VK_GROUP_ID;
  if (!token || !group) throw new Error("Нет VK_TOKEN / VK_GROUP_ID");
  const params = new URLSearchParams({
    owner_id: `-${group}`,
    from_group: "1",
    message: text,
    access_token: token,
    v: "5.199",
  });
  const res = await fetch("https://api.vk.com/method/wall.post", { method: "POST", body: params });
  const body = await res.json();
  if (body.error) throw new Error(`VK: ${JSON.stringify(body.error)}`);
  return body.response.post_id;
}

const problems = await preflight();

if (!PUBLISH) {
  console.log("─".repeat(72));
  console.log("TELEGRAM (HTML)\n");
  console.log(TG_TEXT);
  console.log("\n" + "─".repeat(72));
  console.log("ВКОНТАКТЕ (без разметки)\n");
  console.log(VK_TEXT);
  console.log("\n" + "─".repeat(72));
  console.log(problems.length ? `PREFLIGHT: ❌ ${problems.join("; ")}` : "PREFLIGHT: ✅ метод включён и доходит до Roblox");
  console.log("Публикация — только с --publish (и только после боевого прогона настоящим ключом).");
  process.exit(0);
}

if (problems.length) {
  console.error(`❌ Публикация отменена: ${problems.join("; ")}`);
  process.exit(1);
}

const tgId = await tgPublish(TG_TEXT);
console.log(`✅ Telegram: пост ${tgId}`);
const vkId = await vkPublish(VK_TEXT);
console.log(`✅ ВКонтакте: пост ${vkId}`);
