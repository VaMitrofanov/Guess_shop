"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Gamepad2,
  Loader2,
  Search,
  ShieldCheck,
  UserRound,
  WalletCards,
} from "lucide-react";
import Navbar from "@/components/navbar";
import { Checkbox } from "@/components/ui/checkbox";
import { usePricing } from "@/hooks/usePricing";
import styles from "./checkout.module.css";

const MIN_ROBUX = 100;
const MAX_ROBUX = 100_000;

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

type RobloxPlace = {
  name: string;
  rootPlaceId: number | string;
  universeId: number | string;
  image?: string;
};

type RobloxPass = {
  id: number | string;
  name: string;
  price: number;
  creatorName?: string;
  image?: string;
};

const normalizeAmount = (value: string) => Math.min(MAX_ROBUX, Math.max(MIN_ROBUX, Number.parseInt(value, 10) || 1000));
const grossPassPrice = (amount: number) => Math.ceil(amount / 0.7);

function CheckoutContent() {
  const searchParams = useSearchParams();
  const initialAmount = normalizeAmount(searchParams.get("amount") ?? "1000");
  const rememberedUsername = searchParams.get("username")?.trim() ?? "";
  const { loading: priceLoading, getPrice, getBreakdown } = usePricing();

  const [stage, setStage] = useState<"select" | "confirm">("select");
  const [robux] = useState(initialAmount);
  const [searchQuery, setSearchQuery] = useState(rememberedUsername);
  const [username, setUsername] = useState(rememberedUsername);
  const [places, setPlaces] = useState<RobloxPlace[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<RobloxPlace | null>(null);
  const [gamepasses, setGamepasses] = useState<RobloxPass[]>([]);
  const [selectedPass, setSelectedPass] = useState<RobloxPass | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingPasses, setLoadingPasses] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const price = getPrice(robux);
  const breakdown = getBreakdown(robux);
  const expectedPassPrice = useMemo(() => grossPassPrice(robux), [robux]);
  const selectedPriceMatches = !!selectedPass && Math.abs(Number(selectedPass.price) - expectedPassPrice) <= 2;

  const lookupUsername = async (nick: string, silent = false) => {
    const normalized = nick.trim();
    if (!normalized) return;
    setSearching(true);
    setError("");
    setPlaces([]);
    setGamepasses([]);
    setSelectedPlace(null);
    setSelectedPass(null);
    try {
      const res = await fetch(`/api/roblox/games?username=${encodeURIComponent(normalized)}`);
      const data = await res.json();
      if (res.ok && data.success && data.games?.length > 0) {
        setUsername(normalized);
        setPlaces(data.games);
      } else if (!silent || res.ok) {
        setUsername(normalized);
        setError("Игры не найдены. Проверь ник или создай геймпасс по инструкции.");
      }
    } catch {
      setError("Не удалось выполнить поиск. Проверь соединение и попробуй ещё раз.");
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (rememberedUsername) {
      void lookupUsername(rememberedUsername, true);
      return;
    }
    fetch("/api/account/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.robloxUsername) setSearchQuery(data.robloxUsername);
      })
      .catch(() => {});
    // The URL-derived identity is the only value that should auto-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rememberedUsername]);

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
    setPlaces([]);
    setGamepasses([]);
    setSelectedPlace(null);
    setSelectedPass(null);
    try {
      const res = await fetch(`/api/roblox/gamepasses?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (res.ok && data.success && data.gamepasses?.length > 0) {
        setGamepasses(data.gamepasses);
        if (data.gamepasses[0]?.creatorName) setUsername(data.gamepasses[0].creatorName);
      } else {
        setError("Геймпасс не найден. Проверь ссылку или ID.");
      }
    } catch {
      setError("Не удалось найти геймпасс. Попробуй ещё раз.");
    } finally {
      setSearching(false);
    }
  };

  const selectPlace = async (place: RobloxPlace) => {
    setSelectedPlace(place);
    setSelectedPass(null);
    setGamepasses([]);
    setError("");
    setLoadingPasses(true);
    try {
      const res = await fetch(`/api/roblox/games?universeId=${encodeURIComponent(String(place.universeId))}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setGamepasses(data.gamepasses ?? []);
        if (!data.gamepasses?.length) setError("В этой игре пока нет геймпассов. Выбери другую игру или создай новый пасс.");
      } else {
        setError("Не удалось загрузить геймпассы этой игры.");
      }
    } catch {
      setError("Ошибка при загрузке геймпассов.");
    } finally {
      setLoadingPasses(false);
    }
  };

  const prepareConfirmation = async () => {
    if (!username || !selectedPass) {
      setError("Сначала выбери аккаунт, игру и геймпасс.");
      return;
    }
    if (!selectedPriceMatches) {
      setError(`У выбранного пасса должна стоять цена ${expectedPassPrice.toLocaleString("ru-RU")} R$.`);
      return;
    }
    setError("");
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
      if (Number(selectedPass.price) !== data.gamepassPriceRobux) {
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
          idempotencyKey,
        }),
      });
      const data = await res.json();
      if (data.success && data.paymentUrl) window.location.href = data.paymentUrl;
      else setError(data.error || "Не удалось открыть оплату.");
    } catch {
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
          <h1>{stage === "select" ? "Выбери геймпасс" : "Проверь заказ"}</h1>
          <p>{stage === "select" ? "Найдём твои игры и проверим правильную цену пасса." : "Цена зафиксирована. Осталось указать email и перейти к оплате."}</p>
        </div>
        <div className={styles.stageIndicator} aria-label={`Шаг ${stage === "select" ? 1 : 2} из 2`}>
          <span className={styles.stageActive}>1</span><i /><span className={stage === "confirm" ? styles.stageActive : ""}>2</span>
        </div>
      </div>

      {stage === "select" ? (
        <div className={styles.checkoutGrid}>
          <section className={styles.mainColumn}>
            <div className={styles.panel}>
              <div className={styles.panelHeading}>
                <span className={styles.panelIcon}><UserRound size={21} /></span>
                <div><span>Шаг 1</span><h2>Найди аккаунт Roblox</h2></div>
              </div>
              <div className={styles.searchRow}>
                <div className={styles.searchField}><Search size={19} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void handleSearch(); }} placeholder="Ник, ссылка или ID геймпасса" aria-label="Ник, ссылка или ID геймпасса" /></div>
                <button type="button" onClick={() => void handleSearch()} disabled={searching || !searchQuery.trim()}>{searching ? <Loader2 size={19} className={styles.spin} /> : <Search size={18} />} Найти</button>
              </div>
              <p className={styles.helper}>По нику покажем игры, по ссылке или ID — сразу нужный геймпасс.</p>
              {username && !searching && <div className={styles.accountChip}><span>{username.slice(0,1).toUpperCase()}</span><div><small>Аккаунт найден</small><strong>{username}</strong></div><Check size={18} /></div>}
            </div>

            {places.length > 0 && (
              <div className={styles.panel}>
                <div className={styles.panelHeading}><span className={styles.panelIcon}><Gamepad2 size={21} /></span><div><span>Шаг 2</span><h2>Выбери игру</h2></div></div>
                <div className={styles.choiceGrid}>
                  {places.map((place) => <button type="button" key={String(place.universeId)} onClick={() => void selectPlace(place)} className={selectedPlace?.universeId === place.universeId ? styles.choiceSelected : styles.choice}><span className={styles.choiceAvatar}>{place.image ? <img src={place.image} alt="" /> : <Gamepad2 size={21} />}</span><span><strong>{place.name}</strong><small>ID {place.rootPlaceId}</small></span><ArrowRight size={17} /></button>)}
                </div>
              </div>
            )}

            {(loadingPasses || gamepasses.length > 0) && (
              <div className={styles.panel}>
                <div className={styles.panelHeading}><span className={styles.panelIcon}><WalletCards size={21} /></span><div><span>Шаг 3</span><h2>Выбери геймпасс</h2></div></div>
                {loadingPasses ? <div className={styles.loadingState}><Loader2 size={20} className={styles.spin} /> Загружаем геймпассы…</div> : (
                  <div className={styles.passGrid}>
                    {gamepasses.map((pass) => {
                      const matches = Math.abs(Number(pass.price) - expectedPassPrice) <= 2;
                      const active = selectedPass?.id === pass.id;
                      return <button type="button" key={String(pass.id)} onClick={() => setSelectedPass(pass)} className={active ? styles.passSelected : styles.passCard}>
                        <span className={styles.passImage}>{pass.image ? <img src={pass.image} alt="" /> : <WalletCards size={22} />}</span>
                        <span className={styles.passInfo}><strong>{pass.name}</strong><small>{Number(pass.price).toLocaleString("ru-RU")} R$</small><em className={matches ? styles.priceOk : styles.priceWrong}>{matches ? "Цена подходит" : `Нужно ${expectedPassPrice.toLocaleString("ru-RU")} R$`}</em></span>
                        {active && <Check size={19} />}
                      </button>;
                    })}
                  </div>
                )}
              </div>
            )}

            {error && <div className={styles.errorBox} role="alert"><CircleAlert size={20} /><span>{error}</span></div>}
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
            <Link href={`/guide?source=site&amount=${robux}`} className={styles.guideLink}>Вернуться к инструкции</Link>
          </aside>
        </div>
      ) : (
        <div className={styles.confirmGrid}>
          <section className={styles.panel}>
            <button type="button" className={styles.backButton} onClick={() => { setStage("select"); setQuote(null); setError(""); }}><ArrowLeft size={17} /> Назад к выбору</button>
            <div className={styles.panelHeading}><span className={styles.panelIcon}><Check size={21} /></span><div><span>Заказ готов</span><h2>Проверь данные</h2></div></div>
            <div className={styles.confirmProduct}>
              <span className={styles.passImage}>{selectedPass?.image ? <img src={selectedPass.image} alt="" /> : <WalletCards size={22} />}</span>
              <div><small>Геймпасс</small><strong>{selectedPass?.name}</strong><span>{username} · ID {selectedPass?.id}</span></div>
            </div>
            <label className={styles.formLabel} htmlFor="receipt-email">Email для электронного чека</label>
            <input id="receipt-email" className={styles.emailInput} type="email" autoComplete="email" value={receiptEmail} onChange={(event) => setReceiptEmail(event.target.value.trim())} placeholder="you@example.com" />
            <p className={styles.helper}>Используется только для отправки электронного чека.</p>
            <label className={styles.consentBox}>
              <Checkbox checked={agreedToTerms} onChange={(event) => setAgreedToTerms(event.target.checked)} />
              <span>Я согласен с <Link href="/legal/offer" target="_blank">офертой</Link> и <Link href="/legal/policy" target="_blank">политикой конфиденциальности</Link>.</span>
            </label>
            {error && <div className={styles.errorBox} role="alert"><CircleAlert size={20} /><span>{error}</span></div>}
          </section>
          <aside className={styles.summaryCard}>
            <span className={styles.kicker}>К оплате</span>
            <h2>{quote ? `${(quote.finalAmountKopecks / 100).toLocaleString("ru-RU")} ₽` : "…"}</h2>
            <div className={styles.summaryRows}>
              <div><span>Получишь</span><strong>{quote ? (quote.requestedRobux + quote.bonusRobux).toLocaleString("ru-RU") : robux.toLocaleString("ru-RU")} R$</strong></div>
              <div><span>Цена пасса</span><strong>{quote?.gamepassPriceRobux.toLocaleString("ru-RU")} R$</strong></div>
              <div><span>Курс</span><strong>{breakdown.rubPerRobux} ₽/R$</strong></div>
              {!!quote?.discountKopecks && <div><span>Скидка</span><strong>−{(quote.discountKopecks / 100).toLocaleString("ru-RU")} ₽</strong></div>}
            </div>
            <div className={styles.safeNote}><ShieldCheck size={19} /><span><strong>Цена зафиксирована</strong><small>До окончания котировки.</small></span></div>
            <button type="button" className={styles.primaryButton} disabled={paying || !agreedToTerms || !receiptEmail || !quote} onClick={() => void handlePay()}>{paying ? <Loader2 size={19} className={styles.spin} /> : <>Перейти к оплате <ArrowRight size={18} /></>}</button>
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
