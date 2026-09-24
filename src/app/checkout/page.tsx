"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
// Каждая картинка Roblox на этой странице отдаётся браузеру как есть
// (`unoptimized`), и это не украшение, а единственный рабочий вариант.
// Оптимизатор Next тянет исходник СО СВОЕЙ стороны, а `tr.rbxcdn.com` с
// RF-хоста не резолвится вообще: цепочка CNAME обрывается на `trns1.rbxcdn.com`
// без A-записи, и запрос падает с `ENOTFOUND` → `/_next/image` отдаёт 500.
// У браузера покупателя тот же адрес резолвится нормально, поэтому картинку
// грузит он. По той же причине не работал и серверный прокси-роут
// `/api/account/roblox-avatar/` — он делал ровно тот же обречённый fetch.
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  CircleAlert,
  Gamepad2,
  Link2,
  Loader2,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  UserRound,
  WalletCards,
} from "lucide-react";
import Navbar from "@/components/navbar";
import { Checkbox } from "@/components/ui/checkbox";
import PaymentMethods from "@/components/payment-methods";
import CorridorNotice from "@/components/corridor-notice";
import { usePricing } from "@/hooks/usePricing";
import {
  gamepassPriceMatches,
  rankSellableGamepasses,
  robuxForGamepassPrice,
} from "@/lib/gamepass-search-view";
import { parseGamepassRef } from "@/lib/gamepass-id";
import { MAX_AUTO_PARTS, planFromOwned } from "@/lib/gamepass-plan";
import styles from "./checkout.module.css";

const MIN_ROBUX = 100;
const MAX_ROBUX = 100_000;
const AMOUNT_PRESETS = [100, 500, 1_000, 2_000, 5_000];

type PriceQuote = {
  quoteId: string;
  requestedRobux: number;
  bonusRobux: number;
  gamepassPriceRobux: number;
  baseAmountKopecks: number;
  discountKopecks: number;
  finalAmountKopecks: number;
  expiresAt: string;
};

type RobloxPass = {
  id: number | string;
  name: string;
  price: number;
  creatorName?: string;
  sellerName?: string;
  creatorId?: number | string;
  image?: string;
  isForSale?: boolean;
};

type RobloxAccount = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
};

type KnownRobloxAccount = {
  accountId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  source: "ORDER_HISTORY" | "MANUAL";
  orderCount: number;
  selected: boolean;
};

type CustomerRobloxProfileLike = KnownRobloxAccount;

const normalizeAmount = (value: string) => Math.min(MAX_ROBUX, Math.max(MIN_ROBUX, Number.parseInt(value, 10) || 1000));
const grossPassPrice = (amount: number) => Math.ceil(amount / 0.7);

/** Часть заказа на стороне страницы: пасс, его номинал и что показать человеку. */
type CheckoutPlanPart = { gamepassId: string; amount: number; name?: string; price?: number };

/** `1976715318:1500,1980050799:500` → части. Мусор молча игнорируем. */
function parsePartsParam(raw: string | null): CheckoutPlanPart[] | null {
  if (!raw) return null;
  const parts: CheckoutPlanPart[] = [];
  for (const chunk of raw.split(",")) {
    const [id, amount] = chunk.split(":");
    const parsedAmount = Number.parseInt(amount ?? "", 10);
    if (!/^\d{3,20}$/.test(id ?? "") || !Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) return null;
    parts.push({ gamepassId: id, amount: parsedAmount });
  }
  return parts.length >= 2 && parts.length <= MAX_AUTO_PARTS ? parts : null;
}
const formatCustomerRate = (rate: number) => rate.toLocaleString("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

function CheckoutContent() {
  const searchParams = useSearchParams();
  const initialAmount = normalizeAmount(searchParams.get("amount") ?? "1000");
  const rememberedUsername = searchParams.get("username")?.trim() ?? "";
  const rememberedAccountId = searchParams.get("accountId")?.trim() ?? "";
  const rememberedGamepassId = searchParams.get("gamepassId")?.trim() ?? "";
  /**
   * Набор пассов, посчитанный инструкцией: `parts=ID:НОМИНАЛ,ID:НОМИНАЛ`.
   *
   * Так на сайт приезжает та же разбивка, что коридор ВБ давно шлёт в
   * `select-gamepass`: заказ на 2000 закрывается парой 1500 + 500, потому что
   * один пасс на 2858 R$ не может выкупить ни один донор (у них 1500 «чистых»).
   */
  const rememberedParts = parsePartsParam(searchParams.get("parts"));
  /** `bonus=0` — покупатель отказался от бонуса (в инструкции или раньше здесь). */
  const rememberedUseBonus = searchParams.get("bonus") !== "0";
  const { loading: priceLoading, getPrice, getBreakdown } = usePricing();

  const [stage, setStage] = useState<"select" | "confirm">("select");
  const [robux, setRobux] = useState(initialAmount);
  const [amountInput, setAmountInput] = useState(String(initialAmount));
  const [searchQuery, setSearchQuery] = useState(rememberedUsername);
  const [username, setUsername] = useState(rememberedUsername);
  const [gamepasses, setGamepasses] = useState<RobloxPass[]>([]);
  const [account, setAccount] = useState<RobloxAccount | null>(null);
  const [selectedPass, setSelectedPass] = useState<RobloxPass | null>(null);
  /**
   * Набор, посчитанный ИНСТРУКЦИЕЙ (`?parts=`). Только он и есть состояние:
   * всё остальное про набор — производная от ника, суммы и найденных пассов,
   * и живёт в `useMemo` ниже. Раньше здесь лежал общий `planParts`, который
   * эффект пересчитывал вслед за пассами, — лишний каскад рендеров и
   * предупреждение `react-hooks/set-state-in-effect` в критическом линте.
   */
  const [guidePlanParts, setGuidePlanParts] = useState<CheckoutPlanPart[] | null>(rememberedParts);
  const [searching, setSearching] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [accountEmailVerified, setAccountEmailVerified] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [paying, setPaying] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [knownAccounts, setKnownAccounts] = useState<KnownRobloxAccount[]>([]);
  const [selectedKnownAccountId, setSelectedKnownAccountId] = useState(rememberedAccountId);
  const [manualAccountMode, setManualAccountMode] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [acquiringEnabled, setAcquiringEnabled] = useState(false);
  // F3: принимает ли оплату САЙТ (не зависит от аккаунта). `acquiringEnabled` —
  // про конкретного пользователя, и для гостя он всегда false.
  const [acquiringAccepting, setAcquiringAccepting] = useState(true);
  const [error, setError] = useState("");
  /**
   * Заказ коридора, который ещё не собран.
   *
   * Такой покупатель УЖЕ заплатил на Wildberries, и касса ему не нужна — нужна
   * его собственная инструкция. Разбор 07.09.2026 по `JS6NQB9`: человек дошёл
   * сюда из кабинета и завёл второй заказ на те же 500 R$, зависший в ожидании
   * оплаты. Сервер такой заказ теперь не создаёт (409 `CORRIDOR_ORDER_ACTIVE`),
   * а экран говорит об этом ДО того, как человек заполнит форму.
   */
  const [corridorOrder, setCorridorOrder] = useState<{ ref: string; amount: number; href: string } | null>(null);
  /**
   * Бонус покупателя. Он меняет ЦЕНУ ПАССА (пасс закрывает оплаченное плюс
   * бонус), поэтому касса знает его до котировки и даёт от него отказаться —
   * как боты. До 24.09.2026 котировка молча добавляла весь бонус, а поиск и
   * инструкция считали без него: пасс «по инструкции» на оплате оказывался
   * «не той цены», а набор — «сумма частей ≠ сумме заказа».
   */
  const [availableBonus, setAvailableBonus] = useState(0);
  const [useBonus, setUseBonus] = useState(rememberedUseBonus);
  /** Мы сами поменяли сумму под выбранный пасс — говорим об этом, а не молча. */
  const [amountNotice, setAmountNotice] = useState("");
  // ── Запасной вход: ссылка или Pass ID геймпасса ───────────────────────────
  // Поиск по нику видит и закрытые игры (инвентарь плейсов, 21.09.2026), но
  // молчит при только что созданном пассе, лаге API или скрытом инвентаре.
  // Pass ID покупатель видит в Creator Hub — он и есть второй вход в тот же
  // заказ, ровно как в коридоре ВБ.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualRef, setManualRef] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualErr, setManualErr] = useState("");
  const [manualPass, setManualPass] = useState<RobloxPass | null>(null);
  /** Поиск по нику уже отработал и ничего не дал — открываем запасной вход сами. */
  const [nickDeadEnd, setNickDeadEnd] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (authenticated !== true) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/account/active-order");
        if (!res.ok) return;
        const data = (await res.json()) as {
          order: { ref: string; amount: number; href: string; corridor: boolean; needsGamepass: boolean } | null;
        };
        const order = data.order;
        if (alive && order?.corridor && order.needsGamepass) {
          setCorridorOrder({ ref: order.ref, amount: order.amount, href: order.href });
        }
      } catch {
        // Подсказка, а не функциональность: сервер всё равно не даст создать заказ.
      }
    })();
    return () => { alive = false; };
  }, [authenticated]);

  const customerRate = quote
    ? (quote.finalAmountKopecks / 100) / Math.max(1, quote.requestedRobux + quote.bonusRobux)
    : getBreakdown(robux).rubPerRobux;

  /** Бонус, который реально едет в этот заказ. */
  const appliedBonus = authenticated === true && useBonus ? availableBonus : 0;
  /** Сколько придёт на аккаунт: оплаченное плюс бонус. Под эту сумму делаются пассы. */
  const orderTotal = robux + appliedBonus;

  const setOrderAmount = (nextAmount: number, syncInput = true, bonus = appliedBonus) => {
    const normalized = normalizeAmount(String(nextAmount));
    setRobux(normalized);
    if (syncInput) setAmountInput(String(normalized));
    setGuidePlanParts(null); // набор посчитан под прежнюю сумму — он больше не про этот заказ
    setQuote(null);
    setError("");
    setAmountNotice("");
    const nextPassPrice = grossPassPrice(normalized + bonus);
    const ranked = rankSellableGamepasses(gamepasses, nextPassPrice);
    const repeatBuyer = authenticated === true && knownAccounts.length > 0;
    const nextSelected = selectedPass && gamepassPriceMatches(Number(selectedPass.price), nextPassPrice)
      ? selectedPass
      : repeatBuyer
        ? ranked.find((pass) => gamepassPriceMatches(Number(pass.price), nextPassPrice)) ?? null
        : null;
    setGamepasses(ranked);
    setSelectedPass(nextSelected);
    setQuoteLoading(Boolean(repeatBuyer && nextSelected));
  };

  const handleAmountInput = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setAmountInput(digits);
    const parsed = Number.parseInt(digits, 10);
    if (Number.isSafeInteger(parsed) && parsed >= MIN_ROBUX && parsed <= MAX_ROBUX) {
      setOrderAmount(parsed, false);
    }
  };

  const price = getPrice(robux);
  const expectedPassPrice = useMemo(() => grossPassPrice(orderTotal), [orderTotal]);
  const selectedPriceMatches = !!selectedPass && gamepassPriceMatches(Number(selectedPass.price), expectedPassPrice);
  /**
   * Набор из уже выставленных пассов — то же, что делает коридор ВБ.
   *
   * Пасса ровно на всю сумму может не быть, а два (1500 + 500) — быть. Раньше
   * страница в такой ситуации говорила «подходящий геймпасс не найден» и
   * отправляла человека создавать ещё один; теперь она собирает заказ из того,
   * что уже есть.
   */
  const ownedPlanParts = useMemo<CheckoutPlanPart[] | null>(() => {
    if (selectedPriceMatches) return null;
    const owned = gamepasses.map((pass) => ({
      gamepassId: String(pass.id),
      name: pass.name,
      price: Number(pass.price),
      isForSale: pass.isForSale,
    }));
    const plan = planFromOwned(orderTotal, owned);
    return plan.kind === "ready" || plan.kind === "assembled"
      ? plan.parts.map((part) => ({
          gamepassId: part.gamepassId,
          amount: part.amount,
          name: part.name,
          price: part.price,
        }))
      : null;
  }, [gamepasses, orderTotal, selectedPriceMatches]);
  /**
   * Решение инструкции старше собственного подбора — но только для ТОГО ника,
   * под который инструкция его считала. Сменил ник (или вход переключил на
   * известный аккаунт) — набор чужого аккаунта больше не наш: раньше он
   * прилипал и падал на оплате «геймпасс принадлежит другому аккаунту».
   */
  const guidePartsForNick = guidePlanParts && rememberedUsername
    && username.trim().toLowerCase() === rememberedUsername.toLowerCase()
    ? guidePlanParts
    : null;
  const rawPlanParts = guidePartsForNick ?? ownedPlanParts;
  /** Набор закрывает ровно сумму заказа — тот же инвариант, что у коридора ВБ. */
  const planCoversAmount = !!rawPlanParts && rawPlanParts.reduce((sum, part) => sum + part.amount, 0) === orderTotal;
  /** Набор из НЕСКОЛЬКИХ пассов. План из одной части — это просто выбранный пасс. */
  const planIsSet = planCoversAmount && rawPlanParts!.length > 1;
  /** Части с названиями и ценами: набор из инструкции приходит одними номерами. */
  const planParts = planIsSet
    ? rawPlanParts!.map((part) => {
        const known = gamepasses.find((pass) => String(pass.id) === part.gamepassId);
        return { ...part, name: part.name ?? known?.name, price: part.price ?? (known ? Number(known.price) : undefined) };
      })
    : null;
  /**
   * Одиночный пасс, которым платим. План «хватит одного» (несколько пассов
   * нужной цены, ни один не выбран) раньше уходил на сервер набором из одной
   * части и получал 400 — теперь это обычный выбор пасса.
   */
  const planSinglePass = !selectedPriceMatches && planCoversAmount && rawPlanParts!.length === 1
    ? gamepasses.find((pass) => String(pass.id) === rawPlanParts![0].gamepassId) ?? null
    : null;
  const effectivePass = selectedPriceMatches ? selectedPass : planSinglePass;
  /** Чем платим: одним пассом нужной цены или набором из нескольких. */
  const passReady = planIsSet || !!effectivePass;
  /** «1500 + 500» — как заказ будет собран. */
  const planSummary = planParts ? planParts.map((part) => part.amount.toLocaleString("ru-RU")).join(" + ") : "";
  /** Инструкция под ЭТОТ заказ: сумма с бонусом (под неё делаются пассы) и оплачиваемая часть. */
  const guideHref = (nick: string) => {
    const params = new URLSearchParams({ source: "site", flow: "order", amount: String(orderTotal) });
    if (appliedBonus > 0) params.set("pay", String(robux));
    params.set("bonus", useBonus ? "1" : "0");
    if (nick) params.set("username", nick);
    return `/guide?${params.toString()}`;
  };
  /**
   * Котировка обязана описывать ТОТ ЖЕ заказ, под который выбраны пассы.
   * Набор сверяется по частям на сервере — общая цена «одного пасса» к нему
   * неприменима, а сумма (с бонусом) обязана совпасть у обоих.
   */
  const quoteMismatch = useCallback((body: PriceQuote): string | null => {
    if (body.requestedRobux + body.bonusRobux !== orderTotal) {
      return "Бонус на счёте изменился — обнови страницу, чтобы пересчитать цену геймпасса.";
    }
    if (!planIsSet && effectivePass && !gamepassPriceMatches(Number(effectivePass.price), body.gamepassPriceRobux)) {
      return `У геймпасса должна стоять цена ${body.gamepassPriceRobux.toLocaleString("ru-RU")} R$. Поставь её (и выключи Managed pricing), потом найди пасс снова.`;
    }
    return null;
  }, [orderTotal, planIsSet, effectivePass]);
  const repeatBuyerFlow = authenticated === true && knownAccounts.length > 0;
  const quickQuoteLoading = repeatBuyerFlow && quoteLoading;
  /**
   * Известный аккаунт, на который оформляем. Только ТОЧНОЕ совпадение: пришёл
   * покупатель с новым ником из инструкции — карточка «подтверждён заказом»
   * чужого аккаунта врала бы о получателе.
   */
  const selectedKnownAccount = knownAccounts.find((item) => item.accountId === selectedKnownAccountId)
    ?? knownAccounts.find((item) => item.username.toLowerCase() === username.trim().toLowerCase())
    ?? null;
  const checkoutReturnPath = (() => {
    const params = new URLSearchParams({ amount: String(robux) });
    if (selectedKnownAccountId) params.set("accountId", selectedKnownAccountId);
    if (username || searchQuery.trim()) params.set("username", username || searchQuery.trim());
    const headId = planIsSet && planParts ? planParts[0].gamepassId : effectivePass?.id ?? selectedPass?.id;
    if (headId) params.set("gamepassId", String(headId));
    // Набор переживает вход в аккаунт: без него человек со скрытым плейсом
    // после логина снова видел «геймпасс не найден».
    if (planIsSet && planParts) params.set("parts", planParts.map((part) => `${part.gamepassId}:${part.amount}`).join(","));
    if (!useBonus) params.set("bonus", "0");
    return `/checkout?${params.toString()}`;
  })();
  const loginHref = `/login?next=${encodeURIComponent(checkoutReturnPath)}`;
  const registerHref = `/register?next=${encodeURIComponent(checkoutReturnPath)}`;

  const lookupUsername = async (
    nick: string,
    silent = false,
    autoSelectMatching = false,
    /** Цена пасса, когда бонус только что пришёл и в замыкании ещё старая. */
    passPriceOverride?: number,
  ) => {
    const normalized = nick.trim();
    if (!normalized) return;
    const expectedPassPrice = passPriceOverride ?? grossPassPrice(orderTotal);
    setSearching(true);
    setError("");
    setGamepasses([]);
    setSelectedPass(null);
    setQuote(null);
    setQuoteLoading(false);
    setAccount(null);
    setNickDeadEnd(false);
    setManualPass(null);
    setManualErr("");
    setAmountNotice("");
    try {
      const res = await fetch(`/api/roblox/gamepasses?query=${encodeURIComponent(normalized)}`);
      const data = await res.json();
      if (res.ok && data.success) {
        const visibility = data.gamesVisibility === "ok" || data.gamesVisibility === "hidden" || data.gamesVisibility === "none"
          ? data.gamesVisibility as "ok" | "hidden" | "none"
          : null;
        let ranked = rankSellableGamepasses<RobloxPass>(data.gamepasses ?? [], expectedPassPrice);
        // The storefront passes the exact ID it just found. If Roblox's
        // universe listing flakes between pages, verify that pass directly
        // instead of immediately telling the customer that nothing exists.
        if (ranked.length === 0 && rememberedGamepassId) {
          const directRes = await fetch(`/api/roblox/gamepasses?query=${encodeURIComponent(rememberedGamepassId)}`);
          const directData = await directRes.json().catch(() => ({}));
          const directPass = directRes.ok && directData.success ? directData.gamepasses?.[0] as RobloxPass | undefined : undefined;
          const creator = (directPass?.creatorName || directPass?.sellerName || "").toLowerCase();
          const sameOwner = creator === (data.detectedUsername || normalized).toLowerCase()
            || (directPass?.creatorId && String(directPass.creatorId) === String(data.account?.id));
          if (directPass && sameOwner) {
            ranked = rankSellableGamepasses([directPass], expectedPassPrice);
          }
        }
        setUsername(data.detectedUsername || normalized);
        setAccount(data.account ?? null);
        setGamepasses(ranked);
        const remembered = rememberedGamepassId ? ranked.find((pass) => String(pass.id) === rememberedGamepassId) : null;
        const matching = ranked.filter((pass) => gamepassPriceMatches(Number(pass.price), expectedPassPrice));
        if (remembered) {
          setSelectedPass(remembered);
          if (autoSelectMatching && gamepassPriceMatches(Number(remembered.price), expectedPassPrice)) setQuoteLoading(true);
        } else if (matching.length === 1 || (autoSelectMatching && matching.length > 0)) {
          setSelectedPass(matching[0]);
          if (autoSelectMatching) setQuoteLoading(true);
        }
        if (ranked.length === 0) {
          // Тупик поиска по нику — единственное место, где запасной вход нужен
          // прямо сейчас, поэтому он раскрывается сам, а не прячется за ссылкой.
          setNickDeadEnd(true);
          setManualOpen(true);
          // Те же три положения, что у коридора ВБ (`emptyQuestHead`): опечатка,
          // скрытые настройками игры и «игр нет вовсе» лечатся по-разному.
          setError(data.userExists === false
            ? "Такого пользователя Roblox не нашли. Проверь ник — или вставь Pass ID геймпасса ниже."
            : visibility === "hidden"
              ? "Игры этого аккаунта скрыты настройками приватности, поэтому по нику их не видно. Если геймпасс уже создан — вставь его Pass ID ниже, найдём его в любой игре."
              : visibility === "none"
                ? "У аккаунта нет ни одной игры, а геймпасс создаётся внутри игры. Открой инструкцию — там всё по шагам. Если пасс уже есть — вставь его Pass ID ниже."
                : "Аккаунт найден, но геймпасса на продажу не видно. Если он уже создан — вставь его Pass ID ниже, этого достаточно.");
        }
      } else if (!silent || res.ok) {
        setError(data.error || "Не удалось проверить геймпассы. Попробуй ещё раз.");
      }
    } catch {
      setError("Не удалось выполнить поиск. Проверь соединение и попробуй ещё раз.");
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch("/api/account/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        setAuthenticated(data?.authenticated === true);
        setAccountEmail(data?.email ?? null);
        setAccountEmailVerified(data?.emailVerified === true);
        const bonusNow = Math.max(0, Number(data?.bonusRobux) || 0);
        setAvailableBonus(bonusNow);
        const initialPassPrice = grossPassPrice(initialAmount + (rememberedUseBonus && data?.authenticated === true ? bonusNow : 0));
        if (data?.email) setReceiptEmail((current) => current || data.email);
        const accounts = Array.isArray(data?.robloxAccounts) ? data.robloxAccounts as KnownRobloxAccount[] : [];
        setKnownAccounts(accounts);
        // Ник из ссылки (инструкция, вход перед оплатой) — решение покупателя, и
        // известный аккаунт его не перебивает. До 24.09.2026 здесь срабатывал
        // `accounts[0]`: после входа заказ молча переезжал на другой ник, а
        // набор пассов из инструкции падал на оплате «чужой аккаунт».
        const selected = accounts.find((item) => item.accountId === rememberedAccountId)
          ?? (rememberedUsername
            ? accounts.find((item) => item.username.toLowerCase() === rememberedUsername.toLowerCase())
            : accounts.find((item) => item.selected) ?? accounts[0]);
        if (selected) {
          setSelectedKnownAccountId(selected.accountId);
          setSearchQuery(selected.username);
          setUsername(selected.username);
          setManualAccountMode(false);
          void lookupUsername(selected.username, true, true, initialPassPrice);
        } else if (rememberedUsername) {
          setSelectedKnownAccountId("");
          setSearchQuery(rememberedUsername);
          setUsername(rememberedUsername);
          void lookupUsername(rememberedUsername, true, accounts.length > 0, initialPassPrice);
        }
      })
      .catch(() => setAuthenticated(false));
    return () => {
      active = false;
    };
    // Account defaults are private request-time data returned by /api/account/me.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rememberedAccountId, rememberedUsername]);

  useEffect(() => {
    let active = true;
    fetch("/api/acquiring/status", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("status unavailable"))))
      .then((data) => {
        if (active) {
          setAcquiringEnabled(data.enabled === true);
          setAcquiringAccepting(data.accepting !== false);
          if (typeof data.authenticated === "boolean") setAuthenticated(data.authenticated);
        }
      })
      .catch(() => {
        if (active) {
          setAcquiringEnabled(false);
          setAcquiringAccepting(false);
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!repeatBuyerFlow || !passReady) return;
    const controller = new AbortController();
    fetch("/api/pricing/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountRobux: robux, useBonus }),
      signal: controller.signal,
    })
      .then(async (response) => ({ response, body: await response.json().catch(() => ({})) }))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(body.error || "quote failed");
        const quoteError = quoteMismatch(body);
        if (quoteError) throw new Error(quoteError);
        setQuote(body);
      })
      .catch((quoteError) => {
        if (controller.signal.aborted) return;
        setError(quoteError instanceof Error && quoteError.message !== "quote failed"
          ? quoteError.message
          : "Не удалось зафиксировать цену. Попробуй ещё раз.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuoteLoading(false);
      });
    return () => controller.abort();
  }, [repeatBuyerFlow, robux, useBonus, passReady, quoteMismatch]);

  /**
   * Проверка одной конкретной ссылки/ID. В отличие от поиска по нику ответ
   * ровно один, поэтому и рисуется он одной карточкой — вместе с причиной,
   * если пасс взять нельзя: молчаливо неактивная кнопка «Продолжить» и была
   * тем тупиком, из-за которого покупатель уходил.
   */
  const runManualLookup = async (rawInput?: string) => {
    const raw = (rawInput ?? manualRef).trim();
    const id = parseGamepassRef(raw);
    setManualPass(null);
    if (!id) {
      setManualErr("Не похоже на ссылку или номер геймпасса. Скопируй адрес страницы геймпасса целиком — например roblox.com/game-pass/1234567.");
      return;
    }
    setManualErr("");
    setManualBusy(true);
    try {
      const res = await fetch(`/api/roblox/gamepasses?query=${encodeURIComponent(id)}`);
      const data = await res.json();
      const found = (data?.gamepasses ?? [])[0] as RobloxPass | undefined;
      if (!res.ok || !data?.success || !found) {
        setManualErr("Не нашли такой геймпасс на Roblox. Проверь, что ссылка ведёт на сам Game Pass, а не на игру, и что он опубликован.");
        return;
      }
      setManualPass(found);
    } catch {
      setManualErr("Не удалось связаться с Roblox. Попробуй ещё раз через минуту.");
    } finally {
      setManualBusy(false);
    }
  };

  /**
   * Робуксы уходят ВЛАДЕЛЬЦУ геймпасса, поэтому ник заказа берём у самого пасса,
   * а не у того, что покупатель набрал в поиске: при ручном вводе ссылки он мог
   * не набирать ничего. Тот же ник потом проверяет гард заказа на сервере.
   */
  const acceptManualPass = (pass: RobloxPass) => {
    const owner = (pass.creatorName || pass.sellerName || "").trim();
    if (owner) {
      setUsername(owner);
      setSearchQuery(owner);
      setAccount(null);
    }
    setGamepasses([pass]);
    selectPass(pass);
  };

  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (!query) return;
    // Ссылку вставили в поле ника — это не опечатка, а готовый ответ. Ссылка
    // переезжает в своё поле целиком: два одинаковых инпута подряд читаются
    // как сбой, а поле ника должно остаться полем ника.
    if (parseGamepassRef(query)) {
      setError("");
      setGamepasses([]);
      setSelectedPass(null);
      setQuote(null);
      setAccount(null);
      setUsername("");
      setSearchQuery("");
      setNickDeadEnd(false);
      setManualOpen(true);
      setManualRef(query);
      await runManualLookup(query);
      return;
    }
    await lookupUsername(query);
  };

  const applyProfilePayload = (body: { profile?: CustomerRobloxProfileLike | null; accounts?: CustomerRobloxProfileLike[] }) => {
    const accounts = (body.accounts ?? []).map((item) => ({
      accountId: item.accountId,
      username: item.username,
      displayName: item.displayName,
      avatarUrl: item.avatarUrl,
      source: item.source,
      orderCount: item.orderCount,
      selected: item.selected,
    } satisfies KnownRobloxAccount));
    setKnownAccounts(accounts);
    if (body.profile) setSelectedKnownAccountId(body.profile.accountId);
    return body.profile ?? null;
  };

  const chooseKnownAccount = async (item: KnownRobloxAccount) => {
    if (profileBusy || item.accountId === selectedKnownAccountId) return;
    setProfileBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/roblox-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "select", accountId: item.accountId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.profile) throw new Error("select failed");
      const selected = applyProfilePayload(body);
      const nick = selected?.username ?? item.username;
      setUsername(nick);
      setSearchQuery(nick);
      setManualAccountMode(false);
      await lookupUsername(nick, true, true);
    } catch {
      setError("Не удалось выбрать Roblox-аккаунт. Попробуй ещё раз.");
    } finally {
      setProfileBusy(false);
    }
  };

  const addManualRobloxAccount = async () => {
    const nick = searchQuery.trim();
    if (!nick || profileBusy) return;
    setProfileBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/roblox-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: nick }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.profile) {
        setError(body.error || "Не удалось добавить Roblox-аккаунт.");
        return;
      }
      const selected = applyProfilePayload(body);
      const canonical = selected?.username ?? nick;
      setUsername(canonical);
      setSearchQuery(canonical);
      setManualAccountMode(false);
      await lookupUsername(canonical, true, true);
    } catch {
      setError("Не удалось добавить Roblox-аккаунт. Проверь соединение.");
    } finally {
      setProfileBusy(false);
    }
  };

  /**
   * Пасс не той цены — это другой объём заказа, а не ошибка (то же, что
   * «Едем на N R$» у ботов). Сумму меняем, но ГОВОРИМ об этом: раньше она
   * менялась молча, и человек платил не за то количество, которое вводил.
   */
  const selectPass = (pass: RobloxPass) => {
    const availableRobux = robuxForGamepassPrice(Number(pass.price));
    setError("");
    setQuote(null);
    if (availableRobux && availableRobux !== orderTotal) {
      const nextPay = availableRobux - appliedBonus;
      if (nextPay >= MIN_ROBUX) {
        setOrderAmount(nextPay);
        setAmountNotice(`Заказ пересчитан под этот пасс: получишь ${availableRobux.toLocaleString("ru-RU")} R$${appliedBonus > 0 ? ` (из них ${appliedBonus.toLocaleString("ru-RU")} — бонус)` : ""}.`);
      } else {
        // Бонус больше, чем несёт пасс: оплачивать было бы нечего. Бонус
        // остаётся на счёте до следующего заказа.
        setUseBonus(false);
        setOrderAmount(availableRobux, true, 0);
        setAmountNotice(`Заказ пересчитан под этот пасс: ${availableRobux.toLocaleString("ru-RU")} R$. Бонус останется на счёте — пасс его не вмещает.`);
      }
    }
    setSelectedPass(pass);
  };

  const toggleBonus = (next: boolean) => {
    setUseBonus(next);
    setQuote(null);
    setError("");
    setAmountNotice("");
  };

  const prepareConfirmation = async () => {
    if (!username || !passReady) {
      setError(selectedPass && !selectedPriceMatches
        ? `У выбранного пасса должна стоять цена ${expectedPassPrice.toLocaleString("ru-RU")} R$.`
        : "Сначала найди аккаунт и выбери геймпасс.");
      return;
    }
    setError("");
    if (!authenticated) {
      setQuote(null);
      setStage("confirm");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setQuoteLoading(true);
    try {
      const res = await fetch("/api/pricing/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountRobux: robux, useBonus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Не удалось зафиксировать цену.");
        return;
      }
      const mismatch = quoteMismatch(data);
      if (mismatch) {
        setError(mismatch);
        return;
      }
      setQuote(data);
      setStage("confirm");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Не удалось зафиксировать цену. Проверь соединение.");
    } finally {
      setQuoteLoading(false);
    }
  };

  const handlePay = async () => {
    if (!acquiringEnabled) {
      setError("Оплата временно отключена до завершения проверки банка и кассы.");
      return;
    }
    if (!quote || new Date(quote.expiresAt) <= new Date()) {
      setError("Цена заказа истекла. Вернись назад и обнови её.");
      return;
    }
    if (!receiptEmail) {
      setError("Укажи email для электронного чека.");
      return;
    }
    if (!agreedToTerms) {
      setError("Подтверди согласие с офертой и политикой конфиденциальности.");
      return;
    }
    setError("");
    setPaying(true);
    try {
      const res = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: quote.quoteId,
          username,
          gamepassId: planIsSet && planParts ? planParts[0].gamepassId : String(effectivePass?.id ?? ""),
          parts: planIsSet && planParts
            ? planParts.map((part) => ({ gamepassId: part.gamepassId, amount: part.amount }))
            : undefined,
          receiptEmail,
          agreedToTerms,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const data = await res.json();
      if (data.success && data.paymentUrl) window.location.assign(data.paymentUrl);
      else {
        if (res.status >= 500 || (data.alreadyExists && !data.paymentUrl)) {
          idempotencyKey.current = crypto.randomUUID();
        }
        if (res.status === 401) setAuthenticated(false);
        if (data.code === "CORRIDOR_ORDER_ACTIVE" && typeof data.continueHref === "string") {
          setCorridorOrder({ ref: String(data.orderRef), amount: Number(data.orderAmount), href: data.continueHref });
        }
        setError(data.error || "Не удалось открыть оплату.");
      }
    } catch {
      idempotencyKey.current = crypto.randomUUID();
      setError("Ошибка сети. Попробуй ещё раз.");
    } finally {
      setPaying(false);
    }
  };

  /* Бонус: переключатель, а не молчаливое «применили всё». Цена пасса зависит
     от него, поэтому она названа прямо в подписи. */
  const bonusToggle = authenticated === true && availableBonus > 0 ? (
    <label className={styles.consentBox}>
      <Checkbox checked={useBonus} onChange={(event) => toggleBonus(event.target.checked)} />
      <span>
        Добавить бонус <b>+{availableBonus.toLocaleString("ru-RU")} R$</b> бесплатно — придёт{" "}
        {(robux + availableBonus).toLocaleString("ru-RU")} R$, пасс нужен за{" "}
        {grossPassPrice(robux + availableBonus).toLocaleString("ru-RU")} R$
        {" "}(без бонуса — {grossPassPrice(robux).toLocaleString("ru-RU")} R$).
      </span>
    </label>
  ) : null;
  const amountNoticeEl = amountNotice
    ? <div className={styles.paymentNotice} role="status"><CircleAlert size={19} /><span><strong>Сумма изменилась</strong><small>{amountNotice}</small></span></div>
    : null;

  /* ── Запасной вход: ссылка или Pass ID геймпасса ─────────────────────────
     Раскрыт сам, когда поиск по нику зашёл в тупик; в остальное время —
     тихая ссылка под результатами. Нужен в ОБОИХ режимах: до 24.09.2026
     быстрая покупка его не показывала, хотя текст ошибки звал «вставь ниже». */
  const manualEntry = !manualOpen && !nickDeadEnd ? (
              <button type="button" className={styles.manualToggle} onClick={() => setManualOpen(true)}>
                <Link2 size={17} /> Не находит геймпасс? Вставить ссылку или ID вручную
              </button>
            ) : (
              <div className={styles.panel}>
                <div className={styles.panelHeading}>
                  <span className={styles.panelIcon}><Link2 size={21} /></span>
                  <div><span>Запасной вход</span><h2>Ссылка на геймпасс</h2></div>
                </div>
                <p className={styles.resultLead}>
                  Открой геймпасс в браузере (Creator Hub → <b>Creations</b> → игра → <b>Passes</b> → нажми на пасс) и скопируй адрес. Подойдёт и просто <b>номер</b> геймпасса.
                </p>
                <div className={styles.searchRow}>
                  <div className={styles.searchField}>
                    <Link2 size={19} />
                    <input
                      value={manualRef}
                      onChange={(event) => setManualRef(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter") void runManualLookup(); }}
                      placeholder="https://www.roblox.com/game-pass/…"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      aria-label="Ссылка на геймпасс или его номер"
                    />
                  </div>
                  <button type="button" onClick={() => void runManualLookup()} disabled={manualBusy || !manualRef.trim()}>
                    {manualBusy ? <Loader2 size={19} className={styles.spin} /> : <Check size={18} />} Проверить
                  </button>
                </div>

                {manualErr && <div className={styles.manualWarn} role="alert"><CircleAlert size={18} /><span>{manualErr}</span></div>}

                {manualPass && (() => {
                  // Одна карточка на все исходы. Взять пасс мешают ровно две
                  // вещи — он снят с продажи или его цена не сводится ни к
                  // какому заказу; обе называем словами, чтобы человек знал,
                  // что именно править, а не гадал над серой кнопкой.
                  const offsale = manualPass.isForSale === false;
                  const passRobux = robuxForGamepassPrice(Number(manualPass.price));
                  const matches = gamepassPriceMatches(Number(manualPass.price), expectedPassPrice);
                  const ready = !offsale && (matches || passRobux !== null);
                  const owner = manualPass.creatorName || manualPass.sellerName || "";
                  // Ник, который человек уже назвал сам. Если владелец пасса
                  // другой — раньше поле ника молча перезаписывалось владельцем:
                  // подмена была видна, но не спрошена, а сервер её не ловит
                  // (гард `OWNER_MISMATCH` живёт в `select-gamepass`, а покупка
                  // на сайте туда не заходит). Решение владельца 07.09.2026:
                  // не отказывать, а показать оба ника и спросить — риск берёт
                  // на себя покупатель, но осознанно.
                  const claimed = (account?.username || username || "").trim();
                  const ownerMismatch = Boolean(
                    ready && owner && claimed && owner.toLowerCase() !== claimed.toLowerCase(),
                  );
                  return (
                    <div className={styles.manualResult}>
                      {offsale && (
                        <div className={styles.manualWarn}><CircleAlert size={18} /><span>Геймпасс найден, но он <b>не выставлен на продажу</b>. Включи <b>Item for sale</b> на его странице и нажми «Проверить» снова.</span></div>
                      )}
                      {!offsale && !matches && passRobux === null && (
                        <div className={styles.manualWarn}><CircleAlert size={18} /><span>Цена пасса <b>{Number(manualPass.price).toLocaleString("ru-RU")} R$</b> вне диапазона заказа ({MIN_ROBUX.toLocaleString("ru-RU")}–{MAX_ROBUX.toLocaleString("ru-RU")} R$). Поставь <b>{expectedPassPrice.toLocaleString("ru-RU")} R$</b> и нажми «Проверить» снова.</span></div>
                      )}
                      {ready && owner && !ownerMismatch && (
                        <div className={styles.manualOk}><BadgeCheck size={18} /><span>Владелец пасса — <b>{owner}</b>. Робуксы придут именно на этот аккаунт.</span></div>
                      )}
                      {ownerMismatch && (
                        <div className={styles.manualWarn} role="alert">
                          <CircleAlert size={18} />
                          <span>
                            Ты искал аккаунт <b>{claimed}</b>, а этот геймпасс принадлежит <b>{owner}</b>.
                            Робуксы Roblox переводит <b>владельцу геймпасса</b> — они придут на <b>{owner}</b>,
                            а не на {claimed}. Если это твой второй аккаунт — всё в порядке, подтверди ниже.
                            Если нет — проверь ссылку на геймпасс.
                          </span>
                        </div>
                      )}
                      <button
                        type="button"
                        className={String(effectivePass?.id ?? selectedPass?.id ?? "") === String(manualPass.id) ? styles.passSelected : styles.passCard}
                        onClick={() => acceptManualPass(manualPass)}
                        disabled={!ready}
                      >
                        <span className={styles.passImage}>{manualPass.image ? <Image src={manualPass.image} width={150} height={150} alt="" unoptimized /> : <WalletCards size={22} />}</span>
                        <span className={styles.passInfo}>
                          <strong>{manualPass.name}</strong>
                          <small>Цена пасса · {Number(manualPass.price).toLocaleString("ru-RU")} R$</small>
                          <em className={matches ? styles.priceOk : passRobux ? styles.priceAlternative : styles.priceWrong}>
                            {matches ? `Получишь ${robux.toLocaleString("ru-RU")} R$` : passRobux ? `Купить ${passRobux.toLocaleString("ru-RU")} R$ через этот пасс` : "Вне доступного диапазона"}
                          </em>
                          {/* Последствие названо там, где палец: карточку жмут,
                              не долистав до предупреждения выше. */}
                          {ownerMismatch && <small>Нажми, чтобы оформить заказ на <b>{owner}</b></small>}
                        </span>
                        {String(effectivePass?.id ?? selectedPass?.id ?? "") === String(manualPass.id) && <Check size={19} />}
                      </button>
                    </div>
                  );
                })()}
              </div>
            );

  return (
    <div className={styles.shell}>
      <div className={styles.progressHeader}>
        <div>
          <span className={styles.kicker}>Покупка на сайте</span>
          <h1>{stage === "select" ? repeatBuyerFlow ? "Купить Robux" : "Твои геймпассы" : "Проверь заказ"}</h1>
          <p>{stage === "select"
            ? repeatBuyerFlow
              ? "Аккаунт и email уже выбраны. Укажи количество — подходящий геймпасс найдём сами."
              : "По нику сразу покажем все геймпассы на продажу и поднимем готовые по цене наверх."
            : !authenticated
              ? "Выбор сохранён. Перед оплатой войди или создай аккаунт — заказ появится в личном кабинете."
            : acquiringEnabled
              ? "Цена зафиксирована. Осталось указать email и перейти к оплате."
              : "Цена зафиксирована, но оплата пока недоступна для этого аккаунта."}</p>
        </div>
        {repeatBuyerFlow && stage === "select"
          ? <span className={styles.quickModeBadge}><BadgeCheck size={17} /> Быстрая покупка</span>
          : <div className={styles.stageIndicator} aria-label={`Шаг ${stage === "select" ? 1 : authenticated ? 3 : 2} из 3`}>
              <span className={styles.stageActive}>1</span><i /><span className={stage === "confirm" ? styles.stageActive : ""}>2</span><i /><span className={stage === "confirm" && authenticated ? styles.stageActive : ""}>3</span>
            </div>}
      </div>

      {authenticated === true && corridorOrder && (
        <div className={styles.paymentNotice} role="alert">
          <BadgeCheck size={21} />
          <span>
            <strong>Заказ {corridorOrder.ref} уже оплачен на Wildberries</strong>
            <small>
              {corridorOrder.amount.toLocaleString("ru-RU")} R$ ждут только геймпасс — платить второй раз не нужно.{" "}
              <a href={corridorOrder.href}>Закончить заказ →</a>
            </small>
          </span>
        </div>
      )}

      {stage === "select" && !authenticated && (
        <div className={styles.paymentNotice} role="status">
          <UserRound size={21} />
          <span><strong>До оплаты можно без регистрации</strong><small>Выбери ник, геймпасс и сумму. Аккаунт понадобится только перед переходом в банк.</small></span>
        </div>
      )}

      {/* F3: матрица «сайт закрыт / поэтапный запуск / всё работает». Гостя не
          пугаем: пока он не вошёл, про допуск его аккаунта сказать нечего. */}
      {stage === "select" && !acquiringAccepting && (
        <div className={styles.paymentNotice} role="status">
          <CircleAlert size={21} />
          <span><strong>Оплата временно отключена</strong><small>Заказ и списание денег сейчас не создаются.</small></span>
        </div>
      )}
      {stage === "select" && acquiringAccepting && authenticated && !acquiringEnabled && (
        <div className={styles.paymentNotice} role="status">
          <CircleAlert size={21} />
          <span><strong>Идёт поэтапный запуск</strong><small>Витрина открыта, но этот аккаунт пока не входит в тестовую группу.</small></span>
        </div>
      )}

      {stage === "select" && repeatBuyerFlow ? (
        <div className={styles.quickCheckoutGrid}>
          <section className={`${styles.panel} ${styles.quickPanel}`}>
            <div className={styles.quickProfileHead}>
              <span className={styles.quickAvatar}>
                {(account?.avatarUrl || selectedKnownAccount?.avatarUrl)
                  ? <Image src={(account?.avatarUrl || selectedKnownAccount?.avatarUrl)!} width={84} height={84} alt={`Аватар ${username}`} unoptimized />
                  : <UserRound size={31} />}
              </span>
              <div>
                <span className={styles.quickVerified}><BadgeCheck size={15} /> {selectedKnownAccount?.source === "ORDER_HISTORY" ? "Подтверждён заказом" : "Добавлен вручную"}</span>
                <h2>{account?.displayName || selectedKnownAccount?.displayName || username}</h2>
                <p>@{username}</p>
              </div>
            </div>

            {knownAccounts.length > 1 && (
              <div className={styles.quickAccounts} aria-label="Выбрать Roblox-аккаунт">
                {knownAccounts.map((item) => (
                  <button
                    key={item.accountId}
                    type="button"
                    className={item.accountId === selectedKnownAccountId ? styles.quickAccountActive : styles.quickAccount}
                    onClick={() => void chooseKnownAccount(item)}
                    disabled={profileBusy}
                    aria-pressed={item.accountId === selectedKnownAccountId}
                  >
                    {item.avatarUrl ? <Image src={item.avatarUrl} width={30} height={30} alt="" unoptimized /> : <UserRound size={16} />}
                    <span><strong>{item.displayName}</strong><small>@{item.username}</small></span>
                  </button>
                ))}
              </div>
            )}

            {manualAccountMode ? (
              <div className={styles.quickAddAccount}>
                <label className={styles.amountLabel} htmlFor="quick-new-username">Новый ник Roblox</label>
                <div className={styles.searchRow}>
                  <div className={styles.searchField}><Search size={18} /><input id="quick-new-username" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addManualRobloxAccount(); }} placeholder="Например, Builderman" /></div>
                  <button type="button" onClick={() => void addManualRobloxAccount()} disabled={profileBusy || searchQuery.trim().length < 3}>{profileBusy ? <Loader2 size={18} className={styles.spin} /> : <Plus size={18} />} Добавить</button>
                </div>
                <button type="button" className={styles.quickTextButton} onClick={() => { setManualAccountMode(false); setSearchQuery(username); setError(""); }}>Отмена</button>
              </div>
            ) : (
              <button type="button" className={styles.quickTextButton} onClick={() => { setManualAccountMode(true); setSearchQuery(""); setError(""); }}><Plus size={15} /> Добавить другой ник</button>
            )}

            <div className={styles.quickAmount}>
              <label className={styles.amountLabel} htmlFor="checkout-amount">Сколько получишь</label>
              <div className={styles.amountField}>
                <input
                  id="checkout-amount"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={amountInput}
                  onChange={(event) => handleAmountInput(event.target.value)}
                  onBlur={() => setOrderAmount(Number.parseInt(amountInput, 10) || robux)}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                  aria-describedby="checkout-amount-note"
                />
                <span>R$</span>
              </div>
              <div className={styles.amountPresets} aria-label="Быстрый выбор количества Robux">
                {AMOUNT_PRESETS.map((amount) => (
                  <button key={amount} type="button" className={robux === amount ? styles.amountPresetActive : styles.amountPreset} onClick={() => setOrderAmount(amount)}>
                    {robux === amount && <Check size={14} />} {amount.toLocaleString("ru-RU")}
                  </button>
                ))}
              </div>
              <p id="checkout-amount-note" className={styles.helper}>Можно указать любое количество от {MIN_ROBUX.toLocaleString("ru-RU")} до {MAX_ROBUX.toLocaleString("ru-RU")} R$.</p>
            </div>

            <div className={passReady ? styles.quickReady : styles.quickWaiting} role="status">
              {searching ? <Loader2 size={21} className={styles.spin} /> : passReady ? <Check size={21} /> : <Gamepad2 size={21} />}
              <span>
                <strong>
                  {searching
                    ? "Ищем подходящий геймпасс…"
                    : planIsSet
                      ? `Соберём из ${planParts?.length} геймпассов`
                      : effectivePass
                        ? "Геймпасс выбран автоматически"
                        : "Подходящий геймпасс пока не найден"}
                </strong>
                <small>
                  {planIsSet
                    ? `${planSummary} R$ — каждую часть выкупаем отдельно`
                    : effectivePass
                      ? `${effectivePass.name} · ${Number(effectivePass.price).toLocaleString("ru-RU")} R$`
                      : `Нужен геймпасс за ${expectedPassPrice.toLocaleString("ru-RU")} R$ — создай его по инструкции или вставь Pass ID ниже.`}
                </small>
              </span>
              {!searching && !passReady && <Link href={guideHref(username)}>Инструкция</Link>}
            </div>

            {bonusToggle}
            {amountNoticeEl}
            {!searching && !passReady && manualEntry}

            <div className={styles.quickReceipt}>
              <ReceiptText size={19} />
              <span>
                <strong>{accountEmail ? "Email для чека взят из личного кабинета" : "В личном кабинете нет email для чека"}</strong>
                {accountEmail
                  ? <small>{accountEmail}{!accountEmailVerified ? " · адрес ещё не подтверждён" : ""}</small>
                  : <input className={styles.quickEmailInput} type="email" inputMode="email" autoComplete="email" value={receiptEmail} onChange={(event) => setReceiptEmail(event.target.value)} placeholder="Email для электронного чека" aria-label="Email для электронного чека" />}
              </span>
            </div>

            <label className={styles.consentBox}>
              <Checkbox checked={agreedToTerms} onChange={(event) => setAgreedToTerms(event.target.checked)} />
              <span>Я согласен с <Link href="/legal/offer" target="_blank">офертой</Link> и <Link href="/legal/policy" target="_blank">политикой конфиденциальности</Link>.</span>
            </label>
            {error && <div className={styles.errorBox} role="alert"><CircleAlert size={20} /><span>{error}</span></div>}
          </section>

          <aside className={styles.summaryCard}>
            <CorridorNotice className={styles.corridorNotice} linkClassName={styles.corridorNoticeLink} />
            <span className={styles.kicker}>К оплате</span>
            <h2>{quote ? `${(quote.finalAmountKopecks / 100).toLocaleString("ru-RU")} ₽` : priceLoading || quickQuoteLoading ? "…" : `${price.toLocaleString("ru-RU")} ₽`}</h2>
            <div className={styles.summaryRows}>
              <div><span>Получишь</span><strong>{orderTotal.toLocaleString("ru-RU")} R$</strong></div>
              {appliedBonus > 0 && <div><span>Из них бонус</span><strong>+{appliedBonus.toLocaleString("ru-RU")} R$</strong></div>}
              <div><span>Аккаунт</span><strong>@{username}</strong></div>
              <div><span>Цена геймпасса</span><strong>{expectedPassPrice.toLocaleString("ru-RU")} R$</strong></div>
              <div><span>Твой курс</span><strong>{formatCustomerRate(customerRate)} ₽/R$</strong></div>
              {!!quote?.discountKopecks && <div><span>Скидка</span><strong>−{(quote.discountKopecks / 100).toLocaleString("ru-RU")} ₽</strong></div>}
            </div>
            <div className={styles.safeNote}><ShieldCheck size={19} /><span><strong>{quote ? "Цена зафиксирована" : "Готовим точную цену"}</strong><small>Пароль Roblox не нужен.</small></span></div>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={paying || quickQuoteLoading || !quote || !passReady || !agreedToTerms || !receiptEmail || !acquiringEnabled}
              onClick={() => void handlePay()}
            >
              {paying || quickQuoteLoading ? <Loader2 size={19} className={styles.spin} /> : acquiringEnabled ? <>Перейти к оплате <ArrowRight size={18} /></> : <>Оплата пока недоступна</>}
            </button>
            <PaymentMethods className={styles.paymentMethods} statusTone={!acquiringAccepting ? "closed" : !acquiringEnabled ? "limited" : undefined} />
          </aside>
        </div>
      ) : stage === "select" ? (
        <div className={styles.checkoutGrid}>
          <section className={styles.mainColumn}>
            <div className={styles.panel}>
              <div className={styles.panelHeading}>
                <span className={styles.panelIcon}><WalletCards size={21} /></span>
                <div><span>Сумма заказа</span><h2>Сколько Robux купить?</h2></div>
              </div>
              <label className={styles.amountLabel} htmlFor="checkout-amount">Получишь на аккаунт</label>
              <div className={styles.amountField}>
                <input
                  id="checkout-amount"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={amountInput}
                  onChange={(event) => handleAmountInput(event.target.value)}
                  onBlur={() => setOrderAmount(Number.parseInt(amountInput, 10) || robux)}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                  aria-describedby="checkout-amount-note"
                />
                <span>R$</span>
              </div>
              <div className={styles.amountPresets} aria-label="Быстрый выбор количества Robux">
                {AMOUNT_PRESETS.map((amount) => (
                  <button key={amount} type="button" className={robux === amount ? styles.amountPresetActive : styles.amountPreset} onClick={() => setOrderAmount(amount)}>
                    {robux === amount && <Check size={14} />} {amount.toLocaleString("ru-RU")}
                  </button>
                ))}
              </div>
              <p id="checkout-amount-note" className={styles.helper}>Можно указать любое количество от {MIN_ROBUX.toLocaleString("ru-RU")} до {MAX_ROBUX.toLocaleString("ru-RU")} R$.</p>
            </div>
            <div className={styles.panel}>
              <div className={styles.panelHeading}>
                <span className={styles.panelIcon}><UserRound size={21} /></span>
                <div><span>Шаг 1</span><h2>Найди аккаунт Roblox</h2></div>
              </div>
              <div className={styles.searchRow}>
                <div className={styles.searchField}><Search size={19} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void handleSearch(); }} placeholder="Ник, ссылка или ID геймпасса" aria-label="Ник, ссылка или ID геймпасса" /></div>
                <button type="button" onClick={() => void handleSearch()} disabled={searching || !searchQuery.trim()}>{searching ? <Loader2 size={19} className={styles.spin} /> : <Search size={18} />} Найти</button>
              </div>
              <p className={styles.helper}>По нику проверяем все игры аккаунта — открытые и закрытые. По ссылке или Pass ID — сразу открываем нужный геймпасс.</p>
              {username && !searching && <div className={styles.accountChip}>
                <span className={styles.accountAvatar}>{account?.avatarUrl ? <Image src={account.avatarUrl} width={150} height={150} alt={`Аватар ${username}`} unoptimized /> : username.slice(0,1).toUpperCase()}</span>
                <div><small>Аккаунт найден</small><strong>{account?.displayName || username}</strong>{account?.displayName && account.displayName !== username && <em>@{username}</em>}</div><Check size={18} />
              </div>}
            </div>

            {gamepasses.length > 0 && (
              <div className={styles.panel}>
                <div className={styles.panelHeading}><span className={styles.panelIcon}><WalletCards size={21} /></span><div><span>Шаг 2 · найдено {gamepasses.length}</span><h2>Все геймпассы на продажу</h2></div></div>
                <p className={styles.resultLead}>Подходящие для {orderTotal.toLocaleString("ru-RU")} R$ уже наверху. Если готов только один — мы выбрали его автоматически.{planIsSet ? ` Заказ соберём из ${planParts?.length} твоих пассов: ${planSummary} R$.` : ""}</p>
                <div className={styles.passGrid}>
                    {gamepasses.map((pass) => {
                      const matches = gamepassPriceMatches(Number(pass.price), expectedPassPrice);
                      const active = String(effectivePass?.id ?? selectedPass?.id ?? "") === String(pass.id);
                      const passRobux = robuxForGamepassPrice(Number(pass.price));
                      return <button type="button" key={String(pass.id)} onClick={() => selectPass(pass)} className={active ? styles.passSelected : styles.passCard}>
                        <span className={styles.passImage}>{pass.image ? <Image src={pass.image} width={150} height={150} alt="" unoptimized /> : <WalletCards size={22} />}</span>
                        <span className={styles.passInfo}><strong>{pass.name}</strong><small>Цена пасса · {Number(pass.price).toLocaleString("ru-RU")} R$</small><em className={matches ? styles.priceOk : passRobux ? styles.priceAlternative : styles.priceWrong}>{matches ? `Получишь ${orderTotal.toLocaleString("ru-RU")} R$` : passRobux ? `Купить ${passRobux.toLocaleString("ru-RU")} R$ через этот пасс` : "Вне доступного диапазона"}</em></span>
                        {active && <Check size={19} />}
                      </button>;
                    })}
                  </div>
              </div>
            )}

            {manualEntry}

            {bonusToggle}
            {amountNoticeEl}
            {error && <div className={styles.errorBox} role="alert"><CircleAlert size={20} /><span>{error}<Link href={guideHref(username || searchQuery.trim())}>Открыть пошаговую инструкцию →</Link></span></div>}
          </section>

          <aside className={styles.summaryCard}>
            <span className={styles.kicker}>Твой заказ</span>
            <h2>{orderTotal.toLocaleString("ru-RU")} R$</h2>
            <div className={styles.summaryRows}>
              {appliedBonus > 0 && <div><span>Из них бонус</span><strong>+{appliedBonus.toLocaleString("ru-RU")} R$</strong></div>}
              <div><span>Стоимость</span><strong>{priceLoading ? "…" : `${price.toLocaleString("ru-RU")} ₽`}</strong></div>
              <div><span>Цена геймпасса</span><strong>{expectedPassPrice.toLocaleString("ru-RU")} R$</strong></div>
              <div><span>Аккаунт</span><strong>{username || "Не выбран"}</strong></div>
              <div>
                <span>{planIsSet ? "Геймпассы" : "Геймпасс"}</span>
                <strong>{planIsSet ? `${planParts?.length} шт · ${planSummary} R$` : effectivePass?.name || "Не выбран"}</strong>
              </div>
            </div>
            <div className={styles.safeNote}><ShieldCheck size={19} /><span><strong>Пароль не нужен</strong><small>Покупаем только выбранный геймпасс.</small></span></div>
            <button type="button" className={styles.primaryButton} disabled={!passReady || quoteLoading} onClick={() => void prepareConfirmation()}>{quoteLoading ? <Loader2 size={19} className={styles.spin} /> : <>Продолжить <ArrowRight size={18} /></>}</button>
            <Link href={guideHref(username || searchQuery.trim())} className={styles.guideLink}>Нужна инструкция по геймпассу?</Link>
          </aside>
        </div>
      ) : (
        <div className={styles.confirmGrid}>
          <section className={styles.panel}>
            <button type="button" className={styles.backButton} onClick={() => { setStage("select"); setQuote(null); setError(""); }}><ArrowLeft size={17} /> Назад к выбору</button>
            <div className={styles.panelHeading}><span className={styles.panelIcon}><Check size={21} /></span><div><span>Заказ готов</span><h2>Проверь данные</h2></div></div>
            <div className={styles.confirmPair}>
              <div className={styles.confirmIdentity}>
                <span className={styles.confirmAvatar}>{account?.avatarUrl ? <Image src={account.avatarUrl} width={150} height={150} alt={`Аватар ${username}`} unoptimized /> : <UserRound size={25} />}</span>
                <div><small>Roblox-аккаунт</small><strong>{account?.displayName || username}</strong><span>@{username}</span></div>
              </div>
              <ArrowRight className={styles.confirmArrow} size={22} aria-hidden="true" />
              <div className={styles.confirmIdentity}>
                <span className={styles.passImage}>{!planIsSet && effectivePass?.image ? <Image src={effectivePass.image} width={150} height={150} alt={`Геймпасс ${effectivePass.name}`} unoptimized /> : <WalletCards size={22} />}</span>
                {planIsSet && planParts ? (
                  <div>
                    <small>Геймпассы для покупки</small>
                    <strong>{planParts.length} шт · {planSummary} R$</strong>
                    {/* Название и цена каждой части: набор из инструкции раньше
                        показывался голыми номерами, и сверить его было не с чем. */}
                    {planParts.map((part, index) => (
                      <span key={`${part.gamepassId}-${index}`}>
                        {part.name ? `«${part.name}»` : `#${part.gamepassId}`}
                        {part.price ? ` · ${part.price.toLocaleString("ru-RU")} R$` : ""} → {part.amount.toLocaleString("ru-RU")} R$
                      </span>
                    ))}
                  </div>
                ) : (
                  <div><small>Геймпасс для покупки</small><strong>{effectivePass?.name}</strong><span>{Number(effectivePass?.price ?? 0).toLocaleString("ru-RU")} R$ · ID {effectivePass?.id}</span></div>
                )}
              </div>
            </div>
            {!authenticated ? (
              <div className={styles.authGate}>
                <span className={styles.panelIcon}><ShieldCheck size={21} /></span>
                <div><strong>Сначала сохраним заказ в аккаунте</strong><p>Так статус, чек и история покупки не потеряются после перехода в банк.</p></div>
                <div className={styles.authActions}><Link href={loginHref}>Войти</Link><Link href={registerHref}>Создать аккаунт</Link></div>
              </div>
            ) : (
              <>
                <label className={styles.formLabel} htmlFor="receipt-email">Email для электронного чека</label>
                <input id="receipt-email" className={styles.emailInput} type="email" autoComplete="email" value={receiptEmail} onChange={(event) => setReceiptEmail(event.target.value.trim())} placeholder="you@example.com" />
                <p className={styles.helper}>Чек отправит банк на этот адрес после успешной оплаты.</p>
                {accountEmail && receiptEmail.toLowerCase() !== accountEmail.toLowerCase() && (
                  <div className={styles.paymentNotice} role="status"><CircleAlert size={19} /><span><strong>Email отличается от аккаунта</strong><small>Чек уйдёт на {receiptEmail || "указанный адрес"}, а вход в аккаунт останется на {accountEmail}.</small></span></div>
                )}
                {accountEmail && !accountEmailVerified && receiptEmail.toLowerCase() === accountEmail.toLowerCase() && (
                  <div className={styles.paymentNotice} role="status"><CircleAlert size={19} /><span><strong>Email аккаунта ещё не подтверждён</strong><small>Банк всё равно отправит чек; подтвердить адрес или запросить письмо повторно можно в <Link href="/dashboard">личном кабинете</Link>.</small></span></div>
                )}
                <label className={styles.consentBox}>
                  <Checkbox checked={agreedToTerms} onChange={(event) => setAgreedToTerms(event.target.checked)} />
                  <span>Я согласен с <Link href="/legal/offer" target="_blank">офертой</Link> и <Link href="/legal/policy" target="_blank">политикой конфиденциальности</Link>.</span>
                </label>
              </>
            )}
            {error && <div className={styles.errorBox} role="alert"><CircleAlert size={20} /><span>{error}</span></div>}
          </section>
          <aside className={styles.summaryCard}>
            <CorridorNotice className={styles.corridorNotice} linkClassName={styles.corridorNoticeLink} />
            <span className={styles.kicker}>К оплате</span>
            <h2>{quote ? `${(quote.finalAmountKopecks / 100).toLocaleString("ru-RU")} ₽` : "…"}</h2>
            <div className={styles.summaryRows}>
              <div><span>Получишь</span><strong>{quote ? (quote.requestedRobux + quote.bonusRobux).toLocaleString("ru-RU") : robux.toLocaleString("ru-RU")} R$</strong></div>
              <div><span>Цена пасса</span><strong>{quote?.gamepassPriceRobux.toLocaleString("ru-RU")} R$</strong></div>
              <div><span>Твой курс</span><strong>{formatCustomerRate(customerRate)} ₽/R$</strong></div>
              {!!quote?.discountKopecks && <div><span>Скидка</span><strong>−{(quote.discountKopecks / 100).toLocaleString("ru-RU")} ₽</strong></div>}
            </div>
            <div className={styles.safeNote}><ShieldCheck size={19} /><span><strong>{!authenticated ? "Выбор сохранён" : acquiringEnabled ? "Цена зафиксирована" : "Денежные операции заблокированы"}</strong><small>{!authenticated ? "После входа обновим персональную цену." : acquiringEnabled ? "До окончания котировки." : "До допуска аккаунта к оплате."}</small></span></div>
            {!authenticated ? <Link href={loginHref} className={styles.primaryButton}>Войти перед оплатой <ArrowRight size={18} /></Link> : <button type="button" className={styles.primaryButton} disabled={paying || !agreedToTerms || !receiptEmail || !quote || !acquiringEnabled} onClick={() => void handlePay()}>{paying ? <Loader2 size={19} className={styles.spin} /> : acquiringEnabled ? <>Перейти к оплате <ArrowRight size={18} /></> : <>Оплата пока недоступна</>}</button>}
            <PaymentMethods
              className={styles.paymentMethods}
              statusTone={!acquiringAccepting ? "closed" : authenticated && !acquiringEnabled ? "limited" : undefined}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <main className="min-h-screen vf-checkout">
      <Navbar />
      <Suspense fallback={<div className={styles.pageLoader}><Loader2 size={28} className={styles.spin} /></div>}>
        <CheckoutContent />
      </Suspense>
    </main>
  );
}
