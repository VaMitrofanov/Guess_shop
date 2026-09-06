/* ─────────────────────────────────────────────────────────────────────────────
   «Сделаем пасс за тебя» — сторона ботов.

   Ветка ключа в TG/VK делает ровно то же, что роут `POST /api/roblox/
   gamepass-create` на сайте: создаёт пассы нужных цен на аккаунте покупателя
   и оставляет след в заказе. Отдельный модуль, потому что боты не видят `src/`,
   а повторять порядок побочных эффектов в двух ботах — верный способ получить
   заказ без следа в одном из них.

   Правила, которые здесь нельзя нарушить:
   • **Ключ не логируется и не возвращается.** Ни в консоль, ни в текст ошибки,
     ни в карточку админа. В базе он живёт только зашифрованным.
   • **Пассы создаются по одному, по порядку.** `create` не идемпотентен, а
     параллельный запуск на одном ключе ловит лимиты Roblox.
   • **Ни один побочный эффект не превращает созданный пасс в ошибку.** Пасс уже
     существует на чужом аккаунте; «не записали событие» — наша проблема.
   ───────────────────────────────────────────────────────────────────────── */

import { createGamePassForUserRouted } from "./roblox";
import { auditGamepassAutocreated, type OrderAuditClient } from "./order-audit";
import { rememberRobloxApiKey, type RobloxApiKeyClient } from "./roblox-api-key-store";

/** Больше двух пассов на один заказ не бывает (разбивка номинала 2000). */
export const MAX_KEY_TARGETS = 2;
/**
 * Предел одного сообщения в Telegram и во ВКонтакте. Ключ приходит текстом, и
 * всё, что мессенджер физически способен доставить, мы обязаны принять: свой
 * лимит ниже транспортного означал бы «это не похоже на ключ» на совершенно
 * нормальном ключе.
 */
export const MAX_KEY_LEN = 4096;
/** Короче этого ключа не бывает — обрезанная вставка отсекается без похода в Roblox. */
export const MIN_KEY_LEN = 20;

export interface AutocreatedPass {
  gamePassId: number;
  priceInRobux: number;
  name?: string;
  universeId?: string;
}

export interface AutocreateOutcome {
  /** Что реально создано (может быть половина набора). */
  created: AutocreatedPass[];
  /** Машинный код отказа: `bad_key`, `bad_scope`, … Пусто — всё создано. */
  error?: string;
}

/**
 * Похоже ли присланное на ключ Open Cloud.
 *
 * Проверка нарочно грубая, и разрешённый набор символов — ВЕСЬ печатный ASCII
 * без пробелов, а не «то, что мы видели у ключей»: формат Roblox не
 * документирован и уже менялся, а отвергнутый настоящий ключ выглядит для
 * покупателя как поломка на ровном месте. Задача здесь — отсечь «привет»,
 * ссылку и код ВБ, чтобы не гонять их в Roblox; настоящий вердикт даёт Roblox.
 */
export function looksLikeApiKey(raw: string): boolean {
  const value = raw.trim();
  if (value.length < MIN_KEY_LEN || value.length > MAX_KEY_LEN) return false;
  if (/\s/.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return false;
  return /^[\x21-\x7E]+$/.test(value);
}

/**
 * Создать пассы под набор цен. Первый отказ останавливает набор: половина
 * набора лучше, чем ничего (заказ соберётся из созданного и уже выставленного),
 * но продолжать после отказа бессмысленно — причина у всех одна.
 */
export async function createPassesByKey(opts: {
  apiKey: string;
  nick: string;
  /** Цены пассов в робуксах, по порядку. */
  targets: number[];
}): Promise<AutocreateOutcome> {
  const created: AutocreatedPass[] = [];
  const targets = opts.targets
    .map((t) => Number(t))
    .filter((t) => Number.isInteger(t) && t > 0)
    .slice(0, MAX_KEY_TARGETS);

  if (targets.length === 0) return { created, error: "bad_price" };

  for (const priceInRobux of targets) {
    const res = await createGamePassForUserRouted({
      apiKey: opts.apiKey,
      priceInRobux,
      username: opts.nick,
    });
    if (!res.ok || !res.gamePassId) {
      const error = res.error ?? "roblox_error";
      console.warn(`[gamepass-autocreate] отказ: ${error} (создано ${created.length})`);
      return { created, error };
    }
    created.push({
      gamePassId: res.gamePassId,
      priceInRobux: res.priceInRobux ?? priceInRobux,
      name: res.name,
      universeId: res.universeId,
    });
  }
  console.log(`[gamepass-autocreate] создано пассов: ${created.length}`);
  return { created };
}

type TraceClient = Omit<OrderAuditClient, "wbOrder"> &
  RobloxApiKeyClient & {
    wbOrder: {
      findFirst: (args: any) => Promise<any>;
      update: (args: any) => Promise<any>;
    };
  };

/**
 * След созданного пасса: событие аудита на каждый пасс, строка в заметке заказа
 * и сохранённый ключ. Тот же набор, что пишет веб-роут, — иначе карточка выкупа
 * не поставила бы маркер 🔑 заказу, пришедшему из бота.
 */
export async function recordAutocreateTrace(
  db: TraceClient,
  opts: {
    /** Код WB; по нему находится заказ. */
    wbCode: string;
    nick: string;
    apiKey: string;
    created: AutocreatedPass[];
    /** Набор создан не целиком. */
    partial: boolean;
  },
): Promise<void> {
  if (opts.created.length === 0) return;

  const order = await db.wbOrder
    .findFirst({
      where: { wbCode: { equals: opts.wbCode, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, userId: true, adminNote: true },
    })
    .catch(() => null);

  await rememberRobloxApiKey(db, {
    key: opts.apiKey,
    robloxUsername: opts.nick,
    userId: order?.userId ?? null,
    orderId: order?.id ?? null,
    result: opts.partial ? "partial" : "ok",
    createdPasses: opts.created.length,
  });

  if (!order) return;

  for (const pass of opts.created) {
    await auditGamepassAutocreated(db as OrderAuditClient, {
      gamepassId: String(pass.gamePassId),
      price: pass.priceInRobux,
      robloxUsername: opts.nick,
      orderId: order.id,
      universeId: pass.universeId ?? null,
      via: "bot-api-key",
    });
  }

  // Заметка — то, что админ видит в карточке заказа и в TWA, не открывая ленту.
  const line = `🔑 Пасс создан по API-ключу покупателя: ${opts.created
    .map((p) => `${p.gamePassId} · ${p.priceInRobux} R$`)
    .join(", ")}`;
  const current = order.adminNote?.trim() ?? "";
  if (current.split("\n").includes(line)) return;
  await db.wbOrder
    .update({
      where: { id: order.id },
      data: { adminNote: (current ? `${current}\n${line}` : line).slice(-2000) },
    })
    .catch((err: unknown) => {
      console.warn("[gamepass-autocreate] заметка не записана:", err instanceof Error ? err.message : err);
    });
}
