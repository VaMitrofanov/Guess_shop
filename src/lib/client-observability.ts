import { z } from "zod";

// `[` `]` — клиент сам заменяет токен оплаты на `/pay/[token]`; без скобок в
// схеме всё с /pay отклонялось 400-м, и ошибки страницы оплаты терялись (18.11).
const RouteSchema = z.string().trim().regex(/^\/[A-Za-z0-9_\-./[\]]*$/).max(160);

export const ClientSignalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("web-vital"),
    route: RouteSchema,
    name: z.enum(["CLS", "FCP", "INP", "LCP", "TTFB"]),
    value: z.number().finite().nonnegative().max(600_000),
    rating: z.enum(["good", "needs-improvement", "poor"]),
  }),
  z.object({
    type: z.literal("client-error"),
    route: RouteSchema,
    kind: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/).max(80),
    fingerprint: z.string().regex(/^[a-f0-9]{8}$/),
  }),
]);

type ClientSignal = z.infer<typeof ClientSignalSchema>;

export function formatClientSignal(signal: ClientSignal): string {
  if (signal.type === "web-vital") {
    return `${signal.name}=${Math.round(signal.value * 100) / 100} (${signal.rating}) on ${signal.route}`;
  }
  return `${signal.kind} #${signal.fingerprint} on ${signal.route}`;
}
