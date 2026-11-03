export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPaymentWorkerWatchdog } = await import("@/lib/worker-watchdog");
    startPaymentWorkerWatchdog();
  }
}
