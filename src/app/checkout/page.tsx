"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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
import { usePricing } from "@/hooks/usePricing";
import {
  gamepassPriceMatches,
  rankSellableGamepasses,
  robuxForGamepassPrice,
} from "@/lib/gamepass-search-view";
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
  const { loading: priceLoading, getPrice, getBreakdown } = usePricing();

  const [stage, setStage] = useState<"select" | "confirm">("select");
  const [robux, setRobux] = useState(initialAmount);
  const [amountInput, setAmountInput] = useState(String(initialAmount));
  const [searchQuery, setSearchQuery] = useState(rememberedUsername);
  const [username, setUsername] = useState(rememberedUsername);
  const [gamepasses, setGamepasses] = useState<RobloxPass[]>([]);
  const [account, setAccount] = useState<RobloxAccount | null>(null);
  const [selectedPass, setSelectedPass] = useState<RobloxPass | null>(null);
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
  const idempotencyKey = useRef(crypto.randomUUID());

  const customerRate = quote
    ? (quote.finalAmountKopecks / 100) / Math.max(1, quote.requestedRobux + quote.bonusRobux)
    : getBreakdown(robux).rubPerRobux;

  const setOrderAmount = (nextAmount: number, syncInput = true) => {
    const normalized = normalizeAmount(String(nextAmount));
    setRobux(normalized);
    if (syncInput) setAmountInput(String(normalized));
    setQuote(null);
    setError("");
    const nextPassPrice = grossPassPrice(normalized);
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
  const expectedPassPrice = useMemo(() => grossPassPrice(robux), [robux]);
  const selectedPriceMatches = !!selectedPass && gamepassPriceMatches(Number(selectedPass.price), expectedPassPrice);
  const repeatBuyerFlow = authenticated === true && knownAccounts.length > 0;
  const quickQuoteLoading = repeatBuyerFlow && quoteLoading;
  const selectedKnownAccount = knownAccounts.find((item) => item.accountId === selectedKnownAccountId)
    ?? knownAccounts.find((item) => item.selected)
    ?? knownAccounts[0]
    ?? null;
  const checkoutReturnPath = (() => {
    const params = new URLSearchParams({ amount: String(robux) });
    if (selectedKnownAccountId) params.set("accountId", selectedKnownAccountId);
    if (username || searchQuery.trim()) params.set("username", username || searchQuery.trim());
    if (selectedPass?.id) params.set("gamepassId", String(selectedPass.id));
    return `/checkout?${params.toString()}`;
  })();
  const loginHref = `/login?next=${encodeURIComponent(checkoutReturnPath)}`;
  const registerHref = `/register?next=${encodeURIComponent(checkoutReturnPath)}`;

  const lookupUsername = async (nick: string, silent = false, autoSelectMatching = false) => {
    const normalized = nick.trim();
    if (!normalized) return;
    setSearching(true);
    setError("");
    setGamepasses([]);
    setSelectedPass(null);
    setQuote(null);
    setQuoteLoading(false);
    setAccount(null);
    try {
      const res = await fetch(`/api/roblox/gamepasses?query=${encodeURIComponent(normalized)}`);
      const data = await res.json();
      if (res.ok && data.success) {
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
          setError(data.userExists === false
            ? "Такого пользователя Roblox не нашли. Проверь ник."
            : "Аккаунт найден, но геймпассов на продажу пока нет. Создай пасс по инструкции и повтори поиск.");
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
        if (data?.email) setReceiptEmail((current) => current || data.email);
        const accounts = Array.isArray(data?.robloxAccounts) ? data.robloxAccounts as KnownRobloxAccount[] : [];
        setKnownAccounts(accounts);
        const selected = accounts.find((item) => item.accountId === rememberedAccountId)
          ?? accounts.find((item) => item.username.toLowerCase() === rememberedUsername.toLowerCase())
          ?? accounts.find((item) => item.selected)
          ?? accounts[0];
        if (selected) {
          setSelectedKnownAccountId(selected.accountId);
          setSearchQuery(selected.username);
          setUsername(selected.username);
          setManualAccountMode(false);
          void lookupUsername(selected.username, true, true);
        } else if (rememberedUsername) {
          void lookupUsername(rememberedUsername, true);
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
    if (!repeatBuyerFlow || !selectedPass || !selectedPriceMatches) return;
    const controller = new AbortController();
    fetch("/api/pricing/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountRobux: robux }),
      signal: controller.signal,
    })
      .then(async (response) => ({ response, body: await response.json().catch(() => ({})) }))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(body.error || "quote failed");
        if (!gamepassPriceMatches(Number(selectedPass.price), body.gamepassPriceRobux)) {
          throw new Error("Цена геймпасса больше не совпадает с заказом.");
        }
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
  }, [repeatBuyerFlow, robux, selectedPass, selectedPriceMatches]);

  const isDirectQuery = (value: string) => {
    const query = value.trim();
    return /^\d+$/.test(query) || /game-pass(?:es)?\/\d+/i.test(query) || /catalog\/\d+/i.test(query) || /library\/\d+/i.test(query);
  };

  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (!query) return;
    if (!isDirectQuery(query)) {
      await lookupUsername(query);
      return;
    }
    setSearching(true);
    setError("");
    setGamepasses([]);
    setSelectedPass(null);
    setAccount(null);
    setUsername("");
    try {
      const res = await fetch(`/api/roblox/gamepasses?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (res.ok && data.success && data.gamepasses?.length > 0) {
        setGamepasses(data.gamepasses);
        const found = data.gamepasses[0] as RobloxPass;
        setSelectedPass(found);
        if (found.creatorName || found.sellerName) setUsername(found.creatorName || found.sellerName || "");
      } else {
        setError("Геймпасс не найден. Проверь ссылку или ID.");
      }
    } catch {
      setError("Не удалось найти геймпасс. Попробуй ещё раз.");
    } finally {
      setSearching(false);
    }
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

  const selectPass = (pass: RobloxPass) => {
    const availableRobux = robuxForGamepassPrice(Number(pass.price));
    setError("");
    setQuote(null);
    if (availableRobux && availableRobux !== robux) setOrderAmount(availableRobux);
    setSelectedPass(pass);
  };

  const prepareConfirmation = async () => {
    if (!username || !selectedPass) {
      setError("Сначала найди аккаунт и выбери геймпасс.");
      return;
    }
    if (!selectedPriceMatches) {
      setError(`У выбранного пасса должна стоять цена ${expectedPassPrice.toLocaleString("ru-RU")} R$.`);
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
        body: JSON.stringify({ amountRobux: robux }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Не удалось зафиксировать цену.");
        return;
      }
      if (!gamepassPriceMatches(Number(selectedPass.price), data.gamepassPriceRobux)) {
        setError(`Поставь цену ${data.gamepassPriceRobux.toLocaleString("ru-RU")} R$ и найди пасс снова.`);
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
          gamepassId: String(selectedPass?.id ?? ""),
          receiptEmail,
          agreedToTerms,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const data = await res.json();
      if (data.success && data.paymentUrl) window.location.href = data.paymentUrl;
      else {
        if (res.status >= 500 || (data.alreadyExists && !data.paymentUrl)) {
          idempotencyKey.current = crypto.randomUUID();
        }
        if (res.status === 401) setAuthenticated(false);
        setError(data.error || "Не удалось открыть оплату.");
      }
    } catch {
      idempotencyKey.current = crypto.randomUUID();
      setError("Ошибка сети. Попробуй ещё раз.");
    } finally {
      setPaying(false);
    }
  };

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

            <div className={selectedPass && selectedPriceMatches ? styles.quickReady : styles.quickWaiting} role="status">
              {searching ? <Loader2 size={21} className={styles.spin} /> : selectedPass && selectedPriceMatches ? <Check size={21} /> : <Gamepad2 size={21} />}
              <span>
                <strong>{searching ? "Ищем подходящий геймпасс…" : selectedPass && selectedPriceMatches ? "Геймпасс выбран автоматически" : "Подходящий геймпасс пока не найден"}</strong>
                <small>{selectedPass && selectedPriceMatches ? `${selectedPass.name} · ${Number(selectedPass.price).toLocaleString("ru-RU")} R$` : "Создай геймпасс по инструкции — повторно вводить ник не потребуется."}</small>
              </span>
              {!searching && (!selectedPass || !selectedPriceMatches) && <Link href={`/guide?source=site&amount=${robux}&username=${encodeURIComponent(username)}`}>Инструкция</Link>}
            </div>

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
            <span className={styles.kicker}>К оплате</span>
            <h2>{quote ? `${(quote.finalAmountKopecks / 100).toLocaleString("ru-RU")} ₽` : priceLoading || quickQuoteLoading ? "…" : `${price.toLocaleString("ru-RU")} ₽`}</h2>
            <div className={styles.summaryRows}>
              <div><span>Получишь</span><strong>{robux.toLocaleString("ru-RU")} R$</strong></div>
              <div><span>Аккаунт</span><strong>@{username}</strong></div>
              <div><span>Цена геймпасса</span><strong>{expectedPassPrice.toLocaleString("ru-RU")} R$</strong></div>
              <div><span>Твой курс</span><strong>{formatCustomerRate(customerRate)} ₽/R$</strong></div>
              {!!quote?.discountKopecks && <div><span>Скидка</span><strong>−{(quote.discountKopecks / 100).toLocaleString("ru-RU")} ₽</strong></div>}
            </div>
            <div className={styles.safeNote}><ShieldCheck size={19} /><span><strong>{quote ? "Цена зафиксирована" : "Готовим точную цену"}</strong><small>Пароль Roblox не нужен.</small></span></div>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={paying || quickQuoteLoading || !quote || !selectedPass || !selectedPriceMatches || !agreedToTerms || !receiptEmail || !acquiringEnabled}
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
              <p className={styles.helper}>По нику проверяем все публичные игры автоматически. По ссылке или ID — сразу открываем нужный геймпасс.</p>
              {username && !searching && <div className={styles.accountChip}>
                <span className={styles.accountAvatar}>{account?.avatarUrl ? <Image src={account.avatarUrl} width={150} height={150} alt={`Аватар ${username}`} unoptimized /> : username.slice(0,1).toUpperCase()}</span>
                <div><small>Аккаунт найден</small><strong>{account?.displayName || username}</strong>{account?.displayName && account.displayName !== username && <em>@{username}</em>}</div><Check size={18} />
              </div>}
            </div>

            {gamepasses.length > 0 && (
              <div className={styles.panel}>
                <div className={styles.panelHeading}><span className={styles.panelIcon}><WalletCards size={21} /></span><div><span>Шаг 2 · найдено {gamepasses.length}</span><h2>Все геймпассы на продажу</h2></div></div>
                <p className={styles.resultLead}>Подходящие для {robux.toLocaleString("ru-RU")} R$ уже наверху. Если готов только один — мы выбрали его автоматически.</p>
                <div className={styles.passGrid}>
                    {gamepasses.map((pass) => {
                      const matches = gamepassPriceMatches(Number(pass.price), expectedPassPrice);
                      const active = String(selectedPass?.id ?? "") === String(pass.id);
                      const passRobux = robuxForGamepassPrice(Number(pass.price));
                      return <button type="button" key={String(pass.id)} onClick={() => selectPass(pass)} className={active ? styles.passSelected : styles.passCard}>
                        <span className={styles.passImage}>{pass.image ? <Image src={pass.image} width={150} height={150} alt="" unoptimized /> : <WalletCards size={22} />}</span>
                        <span className={styles.passInfo}><strong>{pass.name}</strong><small>Цена пасса · {Number(pass.price).toLocaleString("ru-RU")} R$</small><em className={matches ? styles.priceOk : passRobux ? styles.priceAlternative : styles.priceWrong}>{matches ? `Получишь ${robux.toLocaleString("ru-RU")} R$` : passRobux ? `Купить ${passRobux.toLocaleString("ru-RU")} R$ через этот пасс` : "Вне доступного диапазона"}</em></span>
                        {active && <Check size={19} />}
                      </button>;
                    })}
                  </div>
              </div>
            )}

            {error && <div className={styles.errorBox} role="alert"><CircleAlert size={20} /><span>{error}<Link href={`/guide?source=site&amount=${robux}&username=${encodeURIComponent(username || searchQuery.trim())}`}>Открыть пошаговую инструкцию →</Link></span></div>}
          </section>

          <aside className={styles.summaryCard}>
            <span className={styles.kicker}>Твой заказ</span>
            <h2>{robux.toLocaleString("ru-RU")} R$</h2>
            <div className={styles.summaryRows}>
              <div><span>Стоимость</span><strong>{priceLoading ? "…" : `${price.toLocaleString("ru-RU")} ₽`}</strong></div>
              <div><span>Цена геймпасса</span><strong>{expectedPassPrice.toLocaleString("ru-RU")} R$</strong></div>
              <div><span>Аккаунт</span><strong>{username || "Не выбран"}</strong></div>
              <div><span>Геймпасс</span><strong>{selectedPass?.name || "Не выбран"}</strong></div>
            </div>
            <div className={styles.safeNote}><ShieldCheck size={19} /><span><strong>Пароль не нужен</strong><small>Покупаем только выбранный геймпасс.</small></span></div>
            <button type="button" className={styles.primaryButton} disabled={!selectedPass || !selectedPriceMatches || quoteLoading} onClick={() => void prepareConfirmation()}>{quoteLoading ? <Loader2 size={19} className={styles.spin} /> : <>Продолжить <ArrowRight size={18} /></>}</button>
            <Link href={`/guide?source=site&amount=${robux}&username=${encodeURIComponent(username || searchQuery.trim())}`} className={styles.guideLink}>Нужна инструкция по геймпассу?</Link>
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
                <span className={styles.passImage}>{selectedPass?.image ? <Image src={selectedPass.image} width={150} height={150} alt={`Геймпасс ${selectedPass.name}`} unoptimized /> : <WalletCards size={22} />}</span>
                <div><small>Геймпасс для покупки</small><strong>{selectedPass?.name}</strong><span>{selectedPass?.price.toLocaleString("ru-RU")} R$ · ID {selectedPass?.id}</span></div>
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
