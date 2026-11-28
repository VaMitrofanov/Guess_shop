/* ─────────────────────────────────────────────────────────────────────────────
   Ключ, который ждёт ссылку на игру.

   Когда по нику игры не видны (инвентарь закрыт или игры ещё нет), ключ
   покупателя годный — не хватает только адреса игры. Ключ ждёт здесь, пока
   покупатель пришлёт ссылку следующим сообщением.

   С 27.11.2026 (владелец) срока у ключа в памяти нет: он живёт до привязки
   пасса, `drop` или рестарта бота. Рестарт не теряет ключ насовсем — годный
   ключ ещё и отложен в базу (`parked-key.ts`), и воркер применит его сам.
   ───────────────────────────────────────────────────────────────────────── */

interface HeldApiKeyStore {
  hold(userId: string | number, key: string): void;
  get(userId: string | number): string | null;
  drop(userId: string | number): void;
}

export function createHeldApiKeyStore(): HeldApiKeyStore {
  const held = new Map<string, string>();
  return {
    hold(userId, key) {
      held.set(String(userId), key);
    },
    get(userId) {
      return held.get(String(userId)) ?? null;
    },
    drop(userId) {
      held.delete(String(userId));
    },
  };
}
