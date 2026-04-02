/**
 * Tinkoff Merchant API Integration Mock.
 */

export async function initTinkoffPayment(orderId: string, amount: number, customerEmail?: string) {
  // Amount is in Cents for Tinkoff (multiply by 100)
  const tinkoffAmount = Math.round(amount * 100);
  
  const terminalKey = process.env.TINKOFF_TERMINAL_KEY || "dummy_terminal";
  const secretKey = process.env.TINKOFF_SECRET_KEY || "dummy_secret";

  console.log(`[Tinkoff] Init payment for order ${orderId}, amount: ${tinkoffAmount}`);

  // This is where real crypto-sign logic would go
  // ...
  
  // Mock return
  return {
    Success: true,
    PaymentId: `TNK_${Math.floor(Math.random() * 1000000)}`,
    PaymentURL: `https://securepay.tinkoff.ru/pay/mock_${orderId}`,
    Message: "OK",
  };
}

export function verifyTinkoffSignature(data: any) {
  // Real signature verification logic (Concatenate + SecretKey + SHA256)
  // For now, we assume it's always valid in mock mode.
  return true;
}
