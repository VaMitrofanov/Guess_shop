import "server-only";

import { prisma } from "@/lib/prisma";
import { HUMAN_WINDOW_MS, needsHuman } from "../../bots/shared/vk-dialog-labels";
import { contactQuote } from "../../bots/shared/buyer-contact";
import { VK_COMMUNITY_ID, vkCommunityDialogUrl } from "../../bots/shared/vk-links";
import type { VkNeedsHuman } from "@/types/vk-needs-human";

/* ─────────────────────────────────────────────────────────────────────────────
   «Ждут ответа в ВК» на главной ТВА — то же, что метка «Нужен человек» в
   «Сообщениях» сообщества (`bots/shared/vk-dialog-labels.ts`), и тем же
   правилом `needsHuman`: отмена, нестандартный вопрос, ошибка в нике,
   «робуксов нет» после 5 дней ожидания. Не попадают: «когда выкупят» до
   выкупа, пустые нажатия «Поддержки», скрины с робуксами «в ожидании».

   Строка уходит, как только менеджер ответил в диалоге сообщества: у его
   сообщений в `messages.getHistory` есть `admin_author_id`, у бота нет.
   Ответ кэшируется: главную опрашивают раз в 30 с, а ВК спрашиваем не чаще
   раза в 2 минуты на диалог.

   Только ВК: в Telegram менеджер пишет со своего аккаунта, и бот этого ответа
   не видит — проверить «ответили или нет» там нечем.
   ───────────────────────────────────────────────────────────────────────── */

const RECHECK_MS = 2 * 60_000;
/** Сколько строк показывать раскрытыми — дальше это уже «Сообщения» сообщества. */
const SHOW_LIMIT = 5;

type Row = {
  vkId: string; at: Date; text: string | null; contextKey: string | null; robux: boolean;
  ocr: string | null; ocrPending: unknown; orderStatus: string; orderCompletedAt: Date | null;
  wbCode: string; name: string | null;
};

/** vkId → { since: для какого обращения проверяли, replied, checkedAt }. */
const replyCache = new Map<string, { since: number; replied: boolean; checkedAt: number }>();

async function managerReplied(vkId: string, since: Date): Promise<boolean> {
  const sinceMs = since.getTime();
  const hit = replyCache.get(vkId);
  if (hit && hit.since === sinceMs && (hit.replied || Date.now() - hit.checkedAt < RECHECK_MS)) return hit.replied;
  const token = process.env.VK_TOKEN;
  if (!token) return false;
  try {
    const body = new URLSearchParams({
      group_id: String(process.env.VK_GROUP_ID ?? VK_COMMUNITY_ID), peer_id: vkId, count: "50",
      access_token: token, v: "5.199",
    });
    const res = await fetch("https://api.vk.com/method/messages.getHistory", {
      method: "POST", body, signal: AbortSignal.timeout(3_000),
    }).then((r) => r.json()) as { response?: { items?: Array<{ out?: number; date?: number; admin_author_id?: number }> } };
    const replied = (res.response?.items ?? []).some((m) =>
      m.out === 1 && Number(m.admin_author_id) > 0 && (m.date ?? 0) * 1000 > sinceMs);
    replyCache.set(vkId, { since: sinceMs, replied, checkedAt: Date.now() });
    return replied;
  } catch {
    // ВК молчит — показываем: пропустить живого человека хуже лишней строки.
    return hit?.since === sinceMs ? hit.replied : false;
  }
}

export async function loadVkNeedsHuman(): Promise<VkNeedsHuman> {
  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    select coalesce(e.payload->>'vkId', u."vkId") as "vkId",
           e."createdAt" as "at",
           e.payload->>'text' as "text",
           e.payload->>'contextKey' as "contextKey",
           coalesce((e.payload->>'robux')::boolean, false) as "robux",
           e.payload->>'ocr' as "ocr",
           (e.payload->>'ocrPending')::numeric as "ocrPending",
           w.status::text as "orderStatus",
           w."completedAt" as "orderCompletedAt",
           w."wbCode" as "wbCode",
           u.name as "name"
      from "OrderEvent" e
      join "WbOrder" w on w.id = e."orderId"
      join "User" u on u.id = w."userId"
     where e.type = 'SUPPORT_REQUEST_DELIVERED'
       and e.payload->>'via' = 'vk-bot'
       and e."createdAt" > now() - interval '${HUMAN_WINDOW_MS / 3_600_000} hours'
     order by e."createdAt" asc`);

  // Последнее «настоящее» обращение каждого диалога.
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const vkId = String(row.vkId ?? "");
    if (!/^\d+$/.test(vkId)) continue;
    const ok = needsHuman({
      at: new Date(row.at), text: row.text, contextKey: row.contextKey, robux: Boolean(row.robux),
      ocr: row.ocr, ocrPending: row.ocrPending == null ? null : Number(row.ocrPending),
      orderStatus: row.orderStatus, orderCompletedAt: row.orderCompletedAt ? new Date(row.orderCompletedAt) : null,
    });
    if (ok) latest.set(vkId, { ...row, vkId });
  }

  const checked = await Promise.all([...latest.values()].map(async (row) => ({
    row, replied: await managerReplied(row.vkId, new Date(row.at)),
  })));
  const waiting = checked.filter((c) => !c.replied).map((c) => c.row)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return {
    total: waiting.length,
    oldestAt: waiting[0] ? new Date(waiting[0].at).toISOString() : null,
    items: waiting.slice(0, SHOW_LIMIT).map((row) => ({
      vkId: row.vkId,
      name: row.name && row.name !== "VK User" ? row.name : null,
      wbCode: row.wbCode,
      quote: contactQuote(row.text, 90),
      at: new Date(row.at).toISOString(),
      dialogUrl: vkCommunityDialogUrl(row.vkId),
    })),
  };
}
