import { buildGamepassPurchaseScript } from "@/lib/roblox-purchase-script";

export interface BrowserPurchaseInput {
  cookie: string;
  gamepassId: string | number;
  productId: string | number;
  expectedPrice: number;
  sellerId: string | number;
  buyerUserId: string | number;
}

export interface BrowserPurchaseResult {
  purchased: boolean;
  reason: string;
  code?: string;
  price?: number | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  ownedBefore?: boolean | null;
  ownedAfter?: boolean | null;
}

export interface BrowserSessionResult {
  ok: boolean;
  code: string;
  reason?: string;
  session?: { accountId: number; accountName: string; balance: number };
}

export interface BrowserGamepassPreflightResult extends BrowserSessionResult {
  gamepass?: {
    gamepassId: number;
    productId: number;
    name: string;
    price: number;
    basePriceInRobux: number;
    priceDiscountDetails: Array<{ Type?: string; AmountInRobux?: number; Percent?: number; EndTime?: string | null }>;
    sellerName: string;
    sellerId: number;
    isForSale: boolean;
    owned: boolean | null;
  };
}

const nextRequestId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function browserServiceRequest<T extends { code?: string; reason?: string }>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<T | { code: string; reason: string }> {
  const url = process.env.ROBLOX_PURCHASE_SERVICE_URL?.replace(/\/$/, "");
  const token = process.env.ROBLOX_PURCHASE_SERVICE_TOKEN;
  if (!url || !token) {
    return { code: "BROWSER_SERVICE_UNAVAILABLE", reason: "BrowserUnavailable: purchase-service не настроен" };
  }
  try {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: nextRequestId(), source: "web", ...body }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const result = (await response.json().catch(() => null)) as T | null;
    if (!result || typeof result !== "object") {
      return { code: "BROWSER_SERVICE_UNAVAILABLE", reason: `BrowserUnavailable: purchase-service вернул HTTP ${response.status}` };
    }
    return result;
  } catch (error) {
    return {
      code: "BROWSER_SERVICE_UNAVAILABLE",
      reason: `BrowserUnavailable: ${error instanceof Error ? error.message : "purchase-service недоступен"}`,
    };
  }
}

let sessionInFlight: { cookie: string; timeoutMs: number; promise: Promise<BrowserSessionResult> } | null = null;

export function getBrowserSession(cookie: string, timeoutMs = 70_000): Promise<BrowserSessionResult> {
  if (sessionInFlight?.cookie === cookie && sessionInFlight.timeoutMs === timeoutMs) return sessionInFlight.promise;
  const promise = browserServiceRequest<BrowserSessionResult>("/session", { cookie }, timeoutMs)
    .then((result) => {
      if ("ok" in result && result.ok && result.session) return result;
      return { ok: false, code: result.code ?? "BROWSER_SERVICE_UNAVAILABLE", reason: result.reason };
    });
  sessionInFlight = { cookie, timeoutMs, promise };
  void promise.finally(() => {
    if (sessionInFlight?.promise === promise) sessionInFlight = null;
  });
  return promise;
}

export async function getBrowserGamepassPreflight(
  cookie: string,
  gamepassId: string | number,
): Promise<BrowserGamepassPreflightResult> {
  const result = await browserServiceRequest<BrowserGamepassPreflightResult>(
    "/gamepass-preflight",
    { cookie, gamepassId },
    70_000,
  );
  if ("ok" in result && result.ok && result.session && result.gamepass) return result;
  return { ok: false, code: result.code ?? "BROWSER_SERVICE_UNAVAILABLE", reason: result.reason };
}

export async function purchaseGamepassInBrowser(input: BrowserPurchaseInput): Promise<BrowserPurchaseResult> {
  const script = buildGamepassPurchaseScript({
    gamepassId: input.gamepassId,
    productId: input.productId,
    expectedPrice: input.expectedPrice,
    sellerId: input.sellerId,
    buyerUserId: input.buyerUserId,
  });
  const result = await browserServiceRequest<BrowserPurchaseResult>("/purchase", {
    cookie: input.cookie,
    script,
    gamepassId: input.gamepassId,
    expectedBuyerId: input.buyerUserId,
    expectedPrice: input.expectedPrice,
  }, 115_000);
  if ("purchased" in result && typeof result.purchased === "boolean") return result;
  return {
    purchased: false,
    code: result.code ?? "BROWSER_SERVICE_UNAVAILABLE",
    reason: result.reason ?? "BrowserUnavailable: purchase-service недоступен",
  };
}

export function browserFailureMessage(reason: string | null | undefined, code?: string | null): string {
  const value = `${code ?? ""} ${reason ?? ""}`;
  if (/DONOR_COOKIE_INVALID|NotLoggedIn/i.test(value))
    return "Cookie донора не авторизует серверный браузер. Обнови cookie в «Аккаунт → 🔑» после проверки входа.";
  if (/WRONG_DONOR_ACCOUNT|WrongAccount/i.test(value))
    return "В серверном браузере открыт другой Roblox-аккаунт. Покупка остановлена.";
  if (/TWO_STEP_REQUIRED|TwoStepRequired/i.test(value))
    return "Roblox запросил двухэтапное подтверждение покупки. Для автоматического выкупа нужен donor без 2FA.";
  if (/BROWSER_BUSY|QueueFull/i.test(value))
    return "Серверный браузер занят другой операцией. Заказ оставлен в очереди — повтори позже.";
  if (/BALANCE_MISMATCH|BALANCE_UNCONFIRMED/i.test(value))
    return "Roblox не подтвердил точное списание. Заказ оставлен без завершения — нужна ручная сверка баланса и владения.";
  if (/ROBLOX_(?:SESSION|PRECHECK)_UNAVAILABLE|CurrencyUnavailable|ProductInfoUnavailable/i.test(value))
    return "Roblox временно не отдал данные аккаунта или геймпасса. Заказ оставлен в очереди — повтори позже.";
  if (/BROWSER_SERVICE_UNAVAILABLE|BrowserUnavailable|DriverError|CookieInjectionFailed/i.test(value))
    return "Браузерный сервис выкупа недоступен. Заказ оставлен в очереди; используй ручной скрипт.";
  return reason || "Покупка не подтверждена";
}

export function isBrowserInfrastructureFailure(reason: string | null | undefined): boolean {
  return /BROWSER_|ROBLOX_(?:SESSION|PRECHECK)_UNAVAILABLE|DONOR_COOKIE_INVALID|WRONG_DONOR_ACCOUNT|TWO_STEP_REQUIRED|BrowserUnavailable|NotLoggedIn|WrongAccount|TwoStepRequired|CookieInjectionFailed|QueueFull|DriverError|BalanceMismatch|BalanceUnconfirmed/i.test(
    String(reason ?? ""),
  );
}
