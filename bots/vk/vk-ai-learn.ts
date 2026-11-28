/* ─────────────────────────────────────────────────────────────────────────────
   🧠 ИИ учится на ответах менеджеров ВК (28.11.2026, владелец: «используй
   все ответы, в том числе и вк»).

   • Живое: менеджер написал из интерфейса сообщества (admin_author_id) —
     читаем хвост диалога и сохраняем пару «вопрос покупателя → ответ».
   • История: один раз (курсор `ai-examples-vk`) проходим все диалоги
     сообщества, по 200 последних сообщений, — медленно, в фоне.
   Сообщение сообщества без admin_author_id — бот или ИИ: обрывает вопрос.
   ───────────────────────────────────────────────────────────────────────── */

import { db } from "../shared/db";
import { recordOperatorExamples } from "../shared/support-ai-learn";
import { pairsFromTranscript, type TranscriptMsg } from "../shared/support-ai-pairs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VkApi = any;
interface VkMsg { date: number; out?: number; from_id?: number; admin_author_id?: number; text?: string }

const CURSOR = "ai-examples-vk";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function vkTranscript(items: VkMsg[]): TranscriptMsg[] {
  return items.map((m) => ({
    side: !m.out && (m.from_id ?? 0) > 0 ? "C" : m.admin_author_id ? "O" : "X",
    text: m.text ?? "",
    at: new Date(m.date * 1000),
  }));
}

async function peerPairs(api: VkApi, peer: number, count: number) {
  const res = await api.messages.getHistory({ peer_id: peer, count });
  return pairsFromTranscript(vkTranscript((res?.items ?? []) as VkMsg[]), "vk_bot", "менеджер ВК");
}

/** Менеджер ответил — пары из хвоста диалога (дубли библиотека отбросит). */
export async function learnFromVkManager(api: VkApi, peer: number): Promise<void> {
  try {
    const pairs = await peerPairs(api, peer, 30);
    if (pairs.length) await recordOperatorExamples(db, pairs.slice(-3));
  } catch (e) {
    console.warn("[vk-ai-learn] хвост диалога не прочитан:", e instanceof Error ? e.message : e);
  }
}

/** Однократно: вся история диалогов сообщества. */
export async function backfillVkExamples(api: VkApi): Promise<void> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: CURSOR } }).catch(() => null);
  if (row?.cursor === "done") return;
  let peers = 0;
  let found = 0;
  let added = 0;
  try {
    for (let offset = 0; offset < 5000; offset += 200) {
      const conv = await api.messages.getConversations({ offset, count: 200 });
      const items = (conv?.items ?? []) as Array<{ conversation?: { peer?: { id?: number; type?: string } } }>;
      if (!items.length) break;
      const batch: Awaited<ReturnType<typeof peerPairs>> = [];
      for (const it of items) {
        const peer = it.conversation?.peer;
        if (!peer?.id || peer.type !== "user") continue;
        peers++;
        try {
          batch.push(...await peerPairs(api, peer.id, 200));
        } catch { /* диалог закрыт/удалён */ }
        await sleep(400);
      }
      found += batch.length;
      added += await recordOperatorExamples(db, batch);
      if (items.length < 200) break;
    }
    await db.wbSyncCursor.upsert({
      where: { stream: CURSOR },
      create: { stream: CURSOR, cursor: "done", lastSuccessAt: new Date(), metadata: { peers, found, added } },
      update: { cursor: "done", lastSuccessAt: new Date(), metadata: { peers, found, added } },
    });
    console.log(`[vk-ai-learn] история: диалогов ${peers}, пар ${found}, новых ${added}`);
  } catch (e) {
    console.warn("[vk-ai-learn] история не дочитана:", e instanceof Error ? e.message : e);
  }
}
