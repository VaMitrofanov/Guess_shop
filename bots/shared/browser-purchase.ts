import { buildGamepassPurchaseScript } from "./roblox-purchase-script";

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
  price?: number | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  ownedBefore?: boolean | null;
  ownedAfter?: boolean | null;
}

export async function purchaseGamepassInBrowser(input: BrowserPurchaseInput): Promise<BrowserPurchaseResult> {
  const url = process.env.ROBLOX_PURCHASE_SERVICE_URL?.replace(/\/$/, "");
  const token = process.env.ROBLOX_PURCHASE_SERVICE_TOKEN;
  if (!url || !token) {
    return { purchased: false, reason: "BrowserUnavailable: purchase-service не настроен" };
  }

  const script = buildGamepassPurchaseScript({
    gamepassId: input.gamepassId,
    productId: input.productId,
    expectedPrice: input.expectedPrice,
    sellerId: input.sellerId,
    buyerUserId: input.buyerUserId,
  });

  try {
    const response = await fetch(`${url}/purchase`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cookie: input.cookie,
        script,
        gamepassId: input.gamepassId,
        expectedBuyerId: input.buyerUserId,
        expectedPrice: input.expectedPrice,
      }),
      signal: AbortSignal.timeout(115_000),
    });
    const result = (await response.json().catch(() => null)) as BrowserPurchaseResult | null;
    if (!result || typeof result.purchased !== "boolean") {
      return { purchased: false, reason: `BrowserUnavailable: purchase-service вернул HTTP ${response.status}` };
    }
    return result;
  } catch (error) {
    return {
      purchased: false,
      reason: `BrowserUnavailable: ${error instanceof Error ? error.message : "purchase-service недоступен"}`,
    };
  }
}

export function isBrowserInfrastructureFailure(reason: string | null | undefined): boolean {
  return /BrowserUnavailable|NotLoggedIn|WrongAccount|TwoStepRequired|CookieInjectionFailed|QueueFull|DriverError|BalanceMismatch|BalanceUnconfirmed/i.test(
    String(reason ?? ""),
  );
}
