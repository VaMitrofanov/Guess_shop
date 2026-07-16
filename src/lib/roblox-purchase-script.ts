/**
 * Официальный браузерный покупочный поток Roblox.
 *
 * Почему не серверный fetch. Roblox снял `economy/v1/purchases/products` 10.04.2026,
 * а живой `apis.roblox.com/game-passes/v1/game-passes/{productId}/purchase` при
 * совпадающей цене отвечает `403` + `rblx-challenge-type: chef`. Chef — это проверка
 * browser fingerprint: Roblox отдаёт scriptIdentifiers, которые должны быть реально
 * исполнены в DOM. Пройденная вручную цепочка chef → twostepverification (email-код
 * принят) → `blocksession: Denied.AutomatedTampering` → `ApplicationError` показала,
 * что подтверждение по email не заменяет fingerprint. Голый HTTP-клиент этот поток не
 * проходит ни на какой URL — см. docs/roblox-plus-buyout-plan.md, тесты 7–8.
 *
 * Что работает. `window.RobloxItemPurchase.startGamepassPurchaseFlow` — модуль самой
 * страницы roblox.com. Он ходит через httpService Roblox, который добавляет HBA-подпись
 * (`x-bound-auth-token`) и сам решает chef с повтором запроса. Проверено живой покупкой.
 *
 * Собранный здесь скрипт исполняется в браузере: сегодня — вручную менеджером в консоли,
 * в дальнейшем тем же текстом через `page.evaluate()` headless-Chrome. Один источник
 * правды на оба транспорта.
 *
 * Зеркало: bots/shared/roblox-purchase-script.ts (bots/ и src/ не импортируют друг
 * друга) — менять синхронно.
 */

export interface GamepassPurchaseScriptInput {
  /** ID из URL страницы (`/game-pass/{id}`). Для product-info и inventory. */
  gamepassId: string | number;
  /** ID из product-info. Именно его ждёт purchase API — не gamepassId. */
  productId: string | number;
  /** Цена, ожидаемая по номиналу заказа, а НЕ live-цена — [ЦЕНА-СТОП]. */
  expectedPrice: number;
  /** Продавец, подтверждённый заказом — [ПРОДАВЕЦ-СТОП]. */
  sellerId: string | number;
  /** userId донора. 0/undefined — проверку аккаунта пропустить. */
  buyerUserId?: string | number | null;
}

const num = (value: unknown, field: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`buildGamepassPurchaseScript: ${field} не число (${String(value)})`);
  return parsed;
};

/**
 * Собирает скрипт покупки для консоли браузера, залогиненного донором.
 *
 * В скрипт зашиты ТОЛЬКО числа: имя пасса и ник продавца задаёт клиент, и подстановка
 * их в текст скрипта была бы инъекцией в консоль менеджера. Всё текстовое читается из
 * product-info в рантайме.
 *
 * Гарды дублируют серверные намеренно. Purchase API нового поколения принимает в теле
 * только `expectedPrice`, поэтому Roblox больше не сверяет продавца на своей стороне:
 * [ПРОДАВЕЦ-СТОП] остаётся только за нами.
 */
export function buildGamepassPurchaseScript(input: GamepassPurchaseScriptInput): string {
  const gamepassId = num(input.gamepassId, "gamepassId");
  const productId = num(input.productId, "productId");
  const expectedPrice = num(input.expectedPrice, "expectedPrice");
  const sellerId = num(input.sellerId, "sellerId");
  const buyerUserId = input.buyerUserId ? num(input.buyerUserId, "buyerUserId") : 0;

  return [
    `(async()=>{`,
    `const GP=${gamepassId},PID=${productId},PRICE=${expectedPrice},SELLER=${sellerId},BUYER=${buyerUserId};`,
    `const no=(m)=>console.log("%c❌ "+m,"color:#e5484d;font-weight:600");`,
    `const f=(u)=>fetch(u,{credentials:"include",cache:"no-store"});`,
    `const flow=window.RobloxItemPurchase&&window.RobloxItemPurchase.startGamepassPurchaseFlow;`,
    `if(typeof flow!=="function"){no("Модуль покупки не загружен. Открой любую страницу game-pass на roblox.com и запусти скрипт там");return}`,
    `const mr=await f("https://users.roblox.com/v1/users/authenticated");`,
    `const me=await mr.json().catch(()=>null);`,
    `if(!mr.ok||!me||!me.id){no("Не залогинен в Roblox");return}`,
    `if(BUYER&&Number(me.id)!==BUYER){no("[АККАУНТ-СТОП] вошёл "+me.name+" ("+me.id+"), а нужен донор "+BUYER);return}`,
    `const ir=await f("https://apis.roblox.com/game-passes/v1/game-passes/"+GP+"/product-info");`,
    `const info=await ir.json().catch(()=>null);`,
    `if(!ir.ok||!info||!info.ProductId){no("product-info недоступен");return}`,
    `if(!info.IsForSale){no("Геймпасс снят с продажи");return}`,
    `if(Number(info.ProductId)!==PID){no("[ПАСС-СТОП] ProductId сменился: "+info.ProductId+" вместо "+PID);return}`,
    `if(Number(info.PriceInRobux)!==PRICE){no("[ЦЕНА-СТОП] цена "+info.PriceInRobux+" R$ вместо ожидаемых "+PRICE+" R$");return}`,
    `const sid=Number((info.Creator&&(info.Creator.Id||info.Creator.CreatorTargetId))||0);`,
    `if(sid!==SELLER){no("[ПРОДАВЕЦ-СТОП] продавец "+sid+" вместо "+SELLER);return}`,
    `const vr=await f("https://inventory.roblox.com/v1/users/"+me.id+"/items/GamePass/"+GP);`,
    `const inv=await vr.json().catch(()=>null);`,
    `if(inv&&inv.data&&inv.data.length){no("Уже куплен аккаунтом "+me.name+" — не покупай второй раз");return}`,
    `window.__closeGamePassPurchaseFlow=flow({`,
    `productId:PID,assetName:info.Name||("Game Pass "+GP),assetType:"Game Pass",`,
    `expectedCurrency:1,expectedPrice:PRICE,expectedSellerId:SELLER,`,
    `sellerName:(info.Creator&&info.Creator.Name)||String(SELLER),`,
    `iconAssetId:Number(info.IconImageAssetId||0),`,
    `onPurchaseSuccess:()=>console.log("%c✅ Куплено: "+(info.Name||GP)+" за "+PRICE+" R$ · аккаунт "+me.name,"color:#30a46c;font-weight:600")`,
    `});`,
    `console.log("%c🛒 Окно покупки открыто — сверь аккаунт и цену, нажми Buy","color:#0090ff;font-weight:600");`,
    `})()`,
  ].join("");
}

/** Страница, на которой у менеджера гарантированно загружен модуль покупки. */
export const gamepassPageUrl = (gamepassId: string | number): string =>
  `https://www.roblox.com/game-pass/${gamepassId}`;
