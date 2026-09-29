/* ─────────────────────────────────────────────────────────────────────────────
   Прямой заказ в ботах — на том же движке, что коридор ВБ.

   До 24.09.2026 прямой заказ в TG/VK искал ОДИН пасс ровно на всю сумму: пак
   2000 требовал пасс за 2858 R$, который не может выкупить ни один донор (у
   них 1500 «чистых»), ключ создавал такой же один пасс, а уже выставленные
   пассы покупателя не засчитывались. Коридор ВБ к тому времени давно собирал
   заказ из того, что есть (`planFromOwned`), просил создать только
   недостающее и принимал пасс по одному Pass ID.

   Здесь то, чего прямому заказу не хватало, в одном месте для обоих ботов:
   • разбор аккаунта — `planFromOwned` на сумму С бонусом;
   • экран «что нужно сделать» — теми же словами, что квест ВБ
     (`questResultScreen`), но с кнопками прямого заказа;
   • приём выбранного набора — общее правило `acceptGamepasses`.

   Модуль без телеграма и ВК: кнопки описаны действиями, каждый бот рисует их
   своими callback'ами / payload'ами.
   ───────────────────────────────────────────────────────────────────────── */

import {
  createTargetsFor,
  netFromPrice,
  planFromOwned,
  type CheckPlan,
  type CreateTarget,
  type OwnedPass,
  type PlanPart,
} from "./gamepass-plan";
import { questResultScreen } from "./gamepass-quest";
import { passFitsAmount, requoteForPass } from "./direct-requote";
import { acceptGamepasses, type AcceptanceResult } from "./gamepass-acceptance";
import { getGamepassDetails } from "./roblox";
import type { GamesVisibility } from "./roblox-owned-games";

export type DirectPlanAction = "keyStored" | "key" | "guide" | "pick" | "nick" | "back" | "cancel";

export interface DirectPlanButton {
  action: DirectPlanAction;
  label: string;
  /** Для `guide` — адрес инструкции. */
  url?: string;
  /** Для `pick` — пасс, под который пересчитать заказ. */
  gamepassId?: string;
  tone?: "primary" | "positive" | "secondary";
}

export interface DirectPlanScreen {
  /** Текст с `<b>`/`<code>`; VK снимает теги `plainText`. */
  text: string;
  rows: DirectPlanButton[][];
}

/** Разбор аккаунта под сумму заказа (оплаченное + бонус). */
export function directPlan(totalAmount: number, owned: readonly OwnedPass[]): CheckPlan {
  return planFromOwned(totalAmount, owned);
}

/** Пассы, которые создаём по ключу, — эталонный набор, как у квеста ВБ. */
export function directKeyTargets(totalAmount: number): CreateTarget[] {
  return createTargetsFor(totalAmount);
}

/** Слить два списка пассов одного аккаунта; свежие сведения побеждают. */
export function mergeOwned(base: readonly OwnedPass[], fresh: readonly OwnedPass[]): OwnedPass[] {
  const byId = new Map<string, OwnedPass>();
  for (const pass of [...base, ...fresh]) byId.set(pass.gamepassId, pass);
  return [...byId.values()];
}

/** Готовый план → части. `null`, если создавать ещё что-то нужно. */
export function readyParts(plan: CheckPlan): PlanPart[] | null {
  return plan.kind === "ready" || plan.kind === "assembled" ? plan.parts : null;
}

/**
 * Экран «чего не хватает» — те же слова, что у квеста ВБ, кнопки прямого
 * заказа. Пассы не той цены предлагаются честным пересчётом («заказ на N R$»),
 * а не молчаливым «оформить не то».
 */
export function directNeedsScreen(opts: {
  totalAmount: number;
  nick: string;
  plan: CheckPlan;
  owned: readonly OwnedPass[];
  keyEnabled: boolean;
  storedKey: boolean;
  gamesVisibility?: GamesVisibility | null;
  bonus?: number;
  guideUrl: string;
}): DirectPlanScreen {
  const base = questResultScreen({
    amount: opts.totalAmount,
    nick: opts.nick,
    plan: opts.plan,
    keyEnabled: opts.keyEnabled,
    wbCode: "",
    gamesVisibility: opts.gamesVisibility,
  });
  const lines = [
    base.text,
    "",
    "🔢 Пасс уже есть, но поиск его не видит? Пришли его <b>Pass ID</b> или ссылку прямо сюда — найдём даже в закрытой игре.",
  ];

  // Пассы не под этот объём, но со своей честной ценой заказа. Не больше двух:
  // лимит VK — 6 рядов на клавиатуру.
  const alternatives = opts.owned
    .filter((pass) => pass.isForSale !== false && !passFitsAmount(pass.price, opts.totalAmount))
    .filter((pass) => requoteForPass({ passPrice: pass.price, bonus: opts.bonus ?? 0 }) !== null)
    .sort((a, b) => Math.abs(a.price - opts.totalAmount / 0.7) - Math.abs(b.price - opts.totalAmount / 0.7))
    .slice(0, 2);
  if (alternatives.length > 0) {
    lines.push("", "Либо возьмём то, что уже есть, — но тогда и заказ будет на другой объём:");
  }

  const targets = directKeyTargets(opts.totalAmount);
  const rows: DirectPlanButton[][] = [];
  if (opts.keyEnabled && opts.storedKey) {
    rows.push([{
      action: "keyStored",
      label: `✨ Создать за меня — ${targets.length > 1 ? `${targets.length} пасса` : "пасс"}`,
      tone: "positive",
    }]);
  } else if (opts.keyEnabled) {
    rows.push([{ action: "key", label: "🔑 Сделайте пасс за меня", tone: "positive" }]);
  }
  rows.push([{ action: "guide", label: "📖 Создам сам (инструкция)", url: opts.guideUrl }]);
  for (const pass of alternatives) {
    rows.push([{
      action: "pick",
      gamepassId: pass.gamepassId,
      label: `${pass.price} R$ → заказ на ${netFromPrice(pass.price)} R$`,
      tone: "primary",
    }]);
  }
  rows.push([
    { action: "nick", label: "✏️ Другой ник", tone: "secondary" },
    { action: "back", label: "◀️ Назад", tone: "secondary" },
    { action: "cancel", label: "❌ Отменить", tone: "secondary" },
  ]);

  return { text: lines.join("\n"), rows };
}

/** Строки итога про набор из нескольких пассов. */
export function directPartsLines(parts: readonly PlanPart[]): string[] {
  return parts.map((part, index) => {
    const repeat = part.repeat ? " · тот же пасс, купим с другого аккаунта" : "";
    return `${index + 1}. «${part.name.slice(0, 30)}» · <b>${part.price} R$</b> → ${part.amount} R$${repeat}`;
  });
}

/**
 * Последняя проверка перед заявкой — общее правило приёма. Roblox молчит —
 * принимаем: заказ ещё проверят при оплате (`createCanonicalBotOrder`) и
 * прайс-гард выкупа.
 */
export async function acceptDirectSelection(opts: {
  totalAmount: number;
  gamepassId: string;
  parts?: readonly PlanPart[] | null;
  nick: string;
}): Promise<AcceptanceResult> {
  return acceptGamepasses({
    orderAmount: opts.totalAmount,
    gamepassId: opts.gamepassId,
    parts: opts.parts && opts.parts.length > 1
      ? opts.parts.map((part) => ({ gamepassId: part.gamepassId, amount: part.amount }))
      : null,
    claimedNick: opts.nick,
    getDetails: async (id) => {
      const details = await getGamepassDetails(id).catch(() => null);
      if (!details || details.validationSkipped) return null;
      return {
        price: details.price,
        isActive: details.isActive,
        creatorId: details.creatorId,
        creatorName: details.creatorName ?? null,
      };
    },
    onUnreachable: "accept",
  });
}

/** Набор для `DirectIntent.parts` (JSON). Одиночный пасс — `undefined`. */
export function intentPartsJson(parts: readonly PlanPart[] | null | undefined) {
  return parts && parts.length > 1
    ? parts.map((part) => ({ gamepassId: part.gamepassId, amount: part.amount }))
    : undefined;
}
