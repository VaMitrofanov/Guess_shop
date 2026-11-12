/* ─────────────────────────────────────────────────────────────────────────────
   Воркер разметки чатов поддержки @RobloxBank_PA (12.11.2026).

   Аккаунт подключён как ещё одно устройство (GramJS, сессия в `PA_SESSION`).
   Раз в 5 минут: личные чаты за 30 дней → покупатель по `User.tgId` → заказы
   → метка в имени контакта и папка (`bots/shared/pa-desk.ts`).

   Бот НИКОМУ НЕ ПИШЕТ — только переименовывает контакты и раскладывает чаты:
   массовые действия от пользовательского аккаунта Telegram банит, поэтому
   за проход — не больше `RENAME_CAP` переименований, с паузой.

   Включение: `PA_API_ID`, `PA_API_HASH`, `PA_SESSION` в env TG-бота;
   `PA_DESK=off` — выключить, `PA_DESK=dry` — только писать в лог, что сделал бы.
   ───────────────────────────────────────────────────────────────────────── */

import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import type { Dialog } from "telegram/tl/custom/dialog";
import { db } from "../shared/db";
import { openFlags } from "../shared/order-flags";
import { DESK_FOLDERS, deskDecision, nextContactName, type DeskFolder, type DeskOrder } from "../shared/pa-desk";

const WINDOW_DAYS = 30;
/** «Новые» — только те, кто писал за неделю: старый незнакомец уже не новый. */
const NEW_WINDOW_DAYS = 7;
const RENAME_CAP = 20;
/** Чатов в одной папке у Telegram Premium — до 200; держим запас. */
const FOLDER_CAP = 150;
/** Сколько старых чатов убираем в архив за проход. */
const ARCHIVE_CAP = 100;

type Mode = "off" | "dry" | "on";

export function paDeskMode(env: NodeJS.ProcessEnv = process.env): Mode {
  if (!env.PA_SESSION || !env.PA_API_ID || !env.PA_API_HASH) return "off";
  const flag = (env.PA_DESK ?? "").trim().toLowerCase();
  return flag === "off" ? "off" : flag === "dry" ? "dry" : "on";
}

let client: TelegramClient | null = null;

async function getClient(): Promise<TelegramClient> {
  if (client?.connected) return client;
  client = new TelegramClient(
    new StringSession(process.env.PA_SESSION!.trim()),
    Number(process.env.PA_API_ID),
    process.env.PA_API_HASH!.trim(),
    { connectionRetries: 5, deviceModel: "RobloxBank Support Desk", appVersion: "1.0", systemVersion: "server" },
  );
  client.setLogLevel("error" as never);
  await client.connect();
  return client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const titleOf = (f: DeskFolder) => `${DESK_FOLDERS[f].emoticon} ${DESK_FOLDERS[f].title}`;

export interface PaDeskResult {
  chats: number;
  linked: number;
  renamed: number;
  folders: Record<DeskFolder, number>;
  foldersUpdated: number;
  archived: number;
}

export async function runPaDeskSweep(mode: Mode = paDeskMode()): Promise<PaDeskResult | null> {
  if (mode === "off") return null;
  const tg = await getClient();
  const now = Date.now() / 1000;
  const all = await tg.getDialogs({ limit: 1000 });
  const dialogs = all.filter((d: Dialog) =>
    d.isUser && d.entity instanceof Api.User && !d.entity.bot && !d.entity.self && d.date && now - d.date < WINDOW_DAYS * 86_400);
  // Порядок: личные чаты без сообщений больше 30 дней — в Архив. Новое сообщение
  // вернёт чат из архива само (если он не заглушён). Закреп и непрочитанное не трогаем.
  const stale = all.filter((d: Dialog) =>
    d.isUser && !d.archived && !d.pinned && !d.unreadCount && d.entity instanceof Api.User && !d.entity.self
    && d.date && now - d.date >= WINDOW_DAYS * 86_400).slice(0, ARCHIVE_CAP);

  const ids = dialogs.map((d) => String((d.entity as Api.User).id));
  const users = await db.user.findMany({ where: { tgId: { in: ids } }, select: { id: true, tgId: true, name: true } });
  const userByTg = new Map(users.map((u) => [u.tgId as string, u]));
  const orders = users.length
    ? await db.wbOrder.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
        select: { userId: true, wbCode: true, amount: true, status: true, createdAt: true, heldAt: true, flags: true },
      })
    : [];
  const ordersBy = new Map<string, DeskOrder[]>();
  for (const o of orders) {
    const list = ordersBy.get(o.userId) ?? [];
    list.push({ wbCode: o.wbCode, amount: o.amount, status: o.status, createdAt: o.createdAt, heldAt: o.heldAt, openFlags: openFlags(o).length > 0 });
    ordersBy.set(o.userId, list);
  }

  const result: PaDeskResult = { chats: dialogs.length, linked: 0, renamed: 0, folders: { NEW: 0, QUEUE: 0, PROBLEM: 0, DONE: 0 }, foldersUpdated: 0, archived: 0 };
  const members: Record<DeskFolder, Dialog[]> = { NEW: [], QUEUE: [], PROBLEM: [], DONE: [] };

  for (const d of dialogs) {
    const u = d.entity as Api.User;
    const buyer = userByTg.get(String(u.id));
    const list = buyer ? ordersBy.get(buyer.id) ?? [] : [];
    if (list.length) result.linked++;
    const decision = deskDecision(list);
    if (decision.folder !== "NEW" || now - (d.date ?? 0) < NEW_WINDOW_DAYS * 86_400) members[decision.folder].push(d);

    const current = [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
    const next = nextContactName({
      isContact: Boolean(u.contact),
      currentName: current,
      fallbackName: buyer?.name?.trim() || u.username || "Покупатель",
      tag: decision.tag,
    });
    if (!next || result.renamed >= RENAME_CAP) continue;
    result.renamed++;
    if (mode === "dry") {
      console.log(`[pa-desk] (dry) ${current ?? "?"} → ${next}`);
      continue;
    }
    try {
      await tg.invoke(new Api.contacts.AddContact({
        id: await tg.getInputEntity(u),
        firstName: next,
        lastName: "",
        phone: "",
        addPhonePrivacyException: false,
      }));
      await sleep(1500);
    } catch (error) {
      console.warn(`[pa-desk] метка не встала: ${error instanceof Error ? error.message : error}`);
    }
  }

  // Папки: пересобираем свои четыре, только если состав поменялся.
  const existing = await tg.invoke(new Api.messages.GetDialogFilters());
  const list = "filters" in existing ? existing.filters : (existing as unknown as Api.TypeDialogFilter[]);
  for (const key of Object.keys(DESK_FOLDERS) as DeskFolder[]) {
    const { id } = DESK_FOLDERS[key];
    const want = members[key].slice(0, FOLDER_CAP);
    result.folders[key] = want.length;
    const have = list.find((f) => f instanceof Api.DialogFilter && f.id === id) as Api.DialogFilter | undefined;
    const haveIds = new Set((have?.includePeers ?? []).map((p) => ("userId" in p ? String(p.userId) : "")));
    const wantIds = new Set(want.map((d) => String((d.entity as Api.User).id)));
    const same = have && haveIds.size === wantIds.size && [...wantIds].every((x) => haveIds.has(x));
    if (same || (want.length === 0 && !have)) continue;
    result.foldersUpdated++;
    if (mode === "dry") {
      console.log(`[pa-desk] (dry) папка «${titleOf(key)}»: ${want.length} чатов`);
      continue;
    }
    try {
      if (want.length === 0) {
        await tg.invoke(new Api.messages.UpdateDialogFilter({ id }));
        continue;
      }
      const includePeers = await Promise.all(want.map((d) => tg.getInputEntity(d.entity as Api.User)));
      await tg.invoke(new Api.messages.UpdateDialogFilter({
        id,
        filter: new Api.DialogFilter({
          id,
          title: new Api.TextWithEntities({ text: titleOf(key), entities: [] }),
          pinnedPeers: [],
          includePeers,
          excludePeers: [],
        }),
      }));
      await sleep(1000);
    } catch (error) {
      console.warn(`[pa-desk] папка «${titleOf(key)}» не обновилась: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (stale.length > 0) {
    result.archived = stale.length;
    if (mode === "dry") {
      console.log(`[pa-desk] (dry) в архив: ${stale.length} старых чатов`);
    } else {
      try {
        const peers = await Promise.all(stale.map((d) => tg.getInputEntity(d.entity as Api.User)));
        await tg.invoke(new Api.folders.EditPeerFolders({
          folderPeers: peers.map((peer) => new Api.InputFolderPeer({ peer, folderId: 1 })),
        }));
      } catch (error) {
        result.archived = 0;
        console.warn(`[pa-desk] архив не обновился: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
  return result;
}
