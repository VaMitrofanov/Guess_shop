import { z } from "zod";

const WbId = z.union([z.string(), z.number()]).transform(String);
const OptionalString = z.string().nullish().transform((value) => value ?? undefined);
const OptionalNumber = z.number().nullish().transform((value) => value ?? undefined);

export const WbDbsOrderSchema = z.object({
  id: WbId,
  salePrice: OptionalNumber,
  orderUid: OptionalString,
  groupId: OptionalString,
  article: OptionalString,
  rid: OptionalString,
  createdAt: OptionalString,
  deliveryType: z.string().optional().default("dbs"),
  nmId: z.number().int(),
  price: OptionalNumber,
  finalPrice: OptionalNumber,
  convertedFinalPrice: OptionalNumber,
  convertedPrice: OptionalNumber,
  currencyCode: OptionalNumber,
  convertedCurrencyCode: OptionalNumber,
  requiredMeta: z.array(z.string()).optional().default([]),
  supplierStatus: OptionalString,
  wbStatus: OptionalString,
}).passthrough();

export const WbDbsOrdersResponseSchema = z.object({
  orders: z.array(WbDbsOrderSchema).optional().default([]),
  next: z.union([z.string(), z.number()]).optional().transform((value) => value == null ? undefined : String(value)),
}).passthrough();

export const WbDeliveryDatesResponseSchema = z.object({
  orders: z.array(z.object({
    id: WbId,
    dDate: OptionalString,
    dTimeFrom: OptionalString,
    dTimeTo: OptionalString,
  }).passthrough()).optional().default([]),
}).passthrough();

export const WbStatusesResponseSchema = z.object({
  orders: z.array(z.object({
    orderId: WbId,
    supplierStatus: OptionalString,
    wbStatus: OptionalString,
    errors: z.array(z.object({
      code: z.union([z.string(), z.number()]).optional(),
      detail: OptionalString,
    }).passthrough()).optional().default([]),
  }).passthrough()).optional().default([]),
}).passthrough();

const GoodCardSchema = z.object({
  rid: OptionalString,
  nmID: OptionalNumber,
  price: OptionalNumber,
  priceCurrency: OptionalString,
}).passthrough();

export const WbChatsResponseSchema = z.object({
  result: z.array(z.object({
    chatID: z.string(),
    replySign: OptionalString,
    goodCard: GoodCardSchema.optional(),
    lastMessage: z.object({ text: OptionalString }).passthrough().optional(),
  }).passthrough()).optional().default([]),
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
      files: z.array(z.unknown()).optional().default([]),
      images: z.array(z.unknown()).optional().default([]),
    }).passthrough().optional(),
  }).passthrough().optional().default({ text: undefined }),
  source: OptionalString,
  addTimestamp: z.number().optional(),
  addTime: OptionalString,
  replySign: OptionalString,
  sender: z.string().optional().default("unknown"),
}).passthrough();

export const WbChatEventsResponseSchema = z.object({
  result: z.object({
    next: z.union([z.string(), z.number()]).optional().transform((value) => value == null ? undefined : String(value)),
    totalEvents: z.number().optional().default(0),
    newestEventTime: OptionalString,
    oldestEventTime: OptionalString,
    events: z.array(WbChatEventSchema).optional().default([]),
  }).passthrough(),
}).passthrough();

const BulkResultSchema = z.object({
  orderId: WbId,
  isError: z.boolean().optional().default(false),
  errors: z.array(z.object({
    code: z.union([z.string(), z.number()]).optional(),
    detail: OptionalString,
  }).passthrough()).optional().default([]),
}).passthrough();

export const WbBulkMutationResponseSchema = z.object({
  requestId: OptionalString,
  results: z.array(BulkResultSchema).optional().default([]),
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
