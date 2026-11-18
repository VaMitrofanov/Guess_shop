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
  // 📊 Посещение (18.11.2026): своя лёгкая аналитика без сторонних сервисов —
  // тип устройства, встроенный браузер, источник, анонимный id посетителя.
  z.object({
    type: z.literal("visit"),
    route: RouteSchema,
    device: z.enum(["phone", "tablet", "desktop"]),
    app: z.enum(["browser", "telegram", "vk", "instagram", "other"]),
    ref: z.enum(["direct", "wb", "vk", "telegram", "yandex", "google", "internal", "other"]),
    visitor: z.string().regex(/^[a-f0-9]{8}$/),
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
  if (signal.type === "visit") return `visit ${signal.device}/${signal.app} from ${signal.ref} on ${signal.route}`;
  if (signal.type === "web-vital") {
    return `${signal.name}=${Math.round(signal.value * 100) / 100} (${signal.rating}) on ${signal.route}`;
  }
  return `${signal.kind} #${signal.fingerprint} on ${signal.route}`;
}
