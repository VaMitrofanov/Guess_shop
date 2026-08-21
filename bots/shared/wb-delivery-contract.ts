import { z } from "zod";

const WbId = z.union([z.string(), z.number()]).transform(String);
const OptionalString = z.string().nullish().transform((value) => value ?? undefined);
const OptionalNumber = z.number().nullish().transform((value) => value ?? undefined);
const OptionalArray = <T extends z.ZodTypeAny>(item: T) => z.array(item).nullish().transform((value) => value ?? []);

export const WbDbsOrderSchema = z.object({
  id: WbId,
  salePrice: OptionalNumber,
  orderUid: OptionalString,
  groupId: OptionalString,
  article: OptionalString,
  rid: OptionalString,
  createdAt: OptionalString,
  deliveryType: z.string().nullish().transform((value) => value ?? "dbs"),
  nmId: z.number().int(),
  price: OptionalNumber,
  finalPrice: OptionalNumber,
  convertedFinalPrice: OptionalNumber,
  convertedPrice: OptionalNumber,
  currencyCode: OptionalNumber,
  convertedCurrencyCode: OptionalNumber,
  requiredMeta: OptionalArray(z.string()),
  supplierStatus: OptionalString,
  wbStatus: OptionalString,
}).passthrough();

export const WbDbsOrdersResponseSchema = z.object({
  orders: OptionalArray(WbDbsOrderSchema),
  next: z.union([z.string(), z.number()]).nullish().transform((value) => value == null ? undefined : String(value)),
}).passthrough();

export const WbDeliveryDatesResponseSchema = z.object({
  orders: OptionalArray(z.object({
    id: WbId,
    dDate: OptionalString,
    dTimeFrom: OptionalString,
    dTimeTo: OptionalString,
  }).passthrough()),
}).passthrough();

export const WbStatusesResponseSchema = z.object({
  orders: OptionalArray(z.object({
    orderId: WbId,
    supplierStatus: OptionalString,
    wbStatus: OptionalString,
    errors: OptionalArray(z.object({
      code: z.union([z.string(), z.number()]).optional(),
      detail: OptionalString,
    }).passthrough()),
  }).passthrough()),
}).passthrough();

/** Buyer identity for a DBS order. WB has shipped several spellings of the name
 * field, so each is optional and read through `wbBuyerName`.
 *
 * This is the one schema in this file that deliberately does NOT passthrough.
 * The live payload also carries `phone`, `replacementPhone`, `phoneCode`,
 * `additionalPhones` and `additionalPhoneCodes`; a digital handover never needs
 * any of it. Stripping at the parse boundary means that data never reaches our
 * memory, logs or error payloads at all — the strongest form of "we don't keep
 * it" (docs/wb-dbs-delivery-plan.md §5, §11). */
export const WbDbsClientResponseSchema = z.object({
  orders: OptionalArray(z.object({
    orderID: WbId.optional(),
    orderId: WbId.optional(),
    firstName: OptionalString,
    fullName: OptionalString,
    fio: OptionalString,
    name: OptionalString,
  })),
}).passthrough();

export type WbDbsClient = z.infer<typeof WbDbsClientResponseSchema>["orders"][number];

/** WB order IDs arrive as `orderID` or `orderId` depending on the endpoint. */
export function wbClientOrderId(row: WbDbsClient): string | undefined {
  return row.orderID ?? row.orderId;
}

/** Narrows any WB spelling of a name to the single token the console shows.
 * A passport-style FIO is cut to its first word, and anything that is only
 * punctuation or digits (WB has served `"-"` and phone-like strings) is
 * rejected so the queue never renders a name that is not one. */
export function wbNormalizeBuyerName(raw: string | undefined | null): string | undefined {
  const first = raw?.trim().split(/\s+/)[0];
  if (!first) return undefined;
  // A name has to contain at least one letter; `+7 926…` and `—` are not names.
  if (!/\p{L}/u.test(first)) return undefined;
  return first.slice(0, 60);
}

/** Picks the first usable human name from the DBS *client* endpoint.
 *
 * The fallback chain tests for emptiness, not for null: WB serves `firstName: ""`
 * alongside a populated `fullName` on real orders, and `??` would have stopped at
 * the empty string and reported no name at all.
 *
 * In practice this endpoint has never served a name on a live DBS order — it
 * answers with phones and empty strings — so it is only the fallback behind
 * `wbChatClientName`, which reads the name WB does publish. */
export function wbBuyerName(row: WbDbsClient): string | undefined {
  for (const candidate of [row.firstName, row.name, row.fullName, row.fio]) {
    const name = wbNormalizeBuyerName(candidate);
    if (name) return name;
  }
  return undefined;
}

/** The buyer's name as WB itself shows it above the chat. Both the chat
 * directory and every chat event carry `clientName`, which is what makes an
 * order recognisable next to a WB conversation — the marketplace order number
 * never was. */
export function wbChatClientName(row: { clientName?: string | undefined }): string | undefined {
  return wbNormalizeBuyerName(row.clientName);
}

const GoodCardSchema = z.object({
  rid: OptionalString,
  nmID: OptionalNumber,
  price: OptionalNumber,
  priceCurrency: OptionalString,
}).passthrough();

export const WbChatsResponseSchema = z.object({
  result: OptionalArray(z.object({
    chatID: z.string(),
    replySign: OptionalString,
    /** The name WB itself prints above the conversation in the seller cabinet.
     * This — not the DBS client endpoint — is where a buyer's name actually
     * comes from; see `wbChatClientName`. */
    clientName: OptionalString,
    goodCard: GoodCardSchema.optional(),
    lastMessage: z.object({ text: OptionalString }).passthrough().optional(),
  }).passthrough()),
}).passthrough();

export const WbChatEventSchema = z.object({
  chatID: z.string(),
  eventID: z.string(),
  eventType: z.string().optional().default("message"),
  isNewChat: z.boolean().optional().default(false),
  message: z.object({
    text: OptionalString,
    attachments: z.object({
      goodCard: GoodCardSchema.optional(),
      files: OptionalArray(z.unknown()),
      images: OptionalArray(z.unknown()),
    }).passthrough().optional(),
  }).passthrough().optional().default({ text: undefined }),
  source: OptionalString,
  addTimestamp: z.number().optional(),
  addTime: OptionalString,
  replySign: OptionalString,
  clientName: OptionalString,
  sender: z.string().optional().default("unknown"),
}).passthrough();

export const WbChatEventsResponseSchema = z.object({
  result: z.object({
    next: z.union([z.string(), z.number()]).nullish().transform((value) => value == null ? undefined : String(value)),
    totalEvents: z.number().optional().default(0),
    newestEventTime: OptionalString,
    oldestEventTime: OptionalString,
    events: OptionalArray(WbChatEventSchema),
  }).passthrough(),
}).passthrough();

const BulkResultSchema = z.object({
  orderId: WbId,
  isError: z.boolean().optional().default(false),
  errors: OptionalArray(z.object({
    code: z.union([z.string(), z.number()]).optional(),
    detail: OptionalString,
  }).passthrough()),
}).passthrough();

export const WbBulkMutationResponseSchema = z.object({
  requestId: OptionalString,
  results: OptionalArray(BulkResultSchema),
}).passthrough();

export type WbDbsOrder = z.infer<typeof WbDbsOrderSchema>;
export type WbChat = z.infer<typeof WbChatsResponseSchema>["result"][number];
export type WbChatEvent = z.infer<typeof WbChatEventSchema>;
export type WbBulkMutationResponse = z.infer<typeof WbBulkMutationResponseSchema>;

export function safeDate(value: string | undefined, fallback = new Date()): Date {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export function deliveryWindow(
  row: z.infer<typeof WbDeliveryDatesResponseSchema>["orders"][number] | undefined,
): { from: Date | null; to: Date | null } {
  if (!row?.dDate) return { from: null, to: null };
  const build = (time: string | undefined, endOfDay: boolean) => {
    const normalized = /^\d{2}:\d{2}$/.test(time ?? "") ? time : endOfDay ? "23:59" : "00:00";
    const date = new Date(`${row.dDate}T${normalized}:00+03:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  return { from: build(row.dTimeFrom, false), to: build(row.dTimeTo, true) };
}
