/* ─────────────────────────────────────────────────────────────────────────────
   Ключ, который ждёт ссылку на игру.

   Когда по нику игры не видны (инвентарь закрыт настройками приватности), ключ
   покупателя годный — не хватает только адреса игры. Просить ключ заново —
   значит гнать человека второй раз через Creator Hub, поэтому ключ ждёт здесь,
   пока покупатель пришлёт ссылку следующим сообщением.

   Только память процесса и только 15 минут: в базу ключ попадает лишь после
   того, как с ним реально создан пасс (`recordAutocreateTrace`). Перезапуск
   бота ключ стирает — это нормально: человек просто пришлёт его ещё раз.
   ───────────────────────────────────────────────────────────────────────── */

export const HELD_KEY_TTL_MS = 15 * 60_000;

export interface HeldApiKeyStore {
  hold(userId: string | number, key: string): void;
  /** Ключ, если он ещё жив; просроченный стирается. */
  get(userId: string | number): string | null;
  drop(userId: string | number): void;
}

export function createHeldApiKeyStore(now: () => number = Date.now): HeldApiKeyStore {
  const held = new Map<string, { key: string; at: number }>();
  const sweep = () => {
    const edge = now() - HELD_KEY_TTL_MS;
    for (const [id, entry] of held) if (entry.at < edge) held.delete(id);
  };
  return {
    hold(userId, key) {
      sweep();
      held.set(String(userId), { key, at: now() });
    },
    get(userId) {
      const entry = held.get(String(userId));
      if (!entry) return null;
      if (now() - entry.at > HELD_KEY_TTL_MS) {
        held.delete(String(userId));
        return null;
      }
      return entry.key;
    },
    drop(userId) {
      held.delete(String(userId));
    },
  };
}
