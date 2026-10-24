/* ─────────────────────────────────────────────────────────────────────────────
   Возраст очереди — одна шкала на все экраны TWA.

   Пороги жили копиями в `OrdersScreen` и `Dashboard`, и «ждёт 6 ч» на одном
   экране было жёлтым, а на другом оранжевым. Экраны спорили о том, что срочно,
   и оба выглядели правыми.

   Шкала считает от «сколько это ждёт человека»: до двух часов — норма рабочего
   ритма, до полусуток — стоит посмотреть, до суток — уже плохо, дальше — красное.
   ───────────────────────────────────────────────────────────────────────── */

import { C } from "./theme";

/** «6 ч 40 м», «3д 2ч» — компактно и без склонений, которые не влезают в строку. */
export function fmtAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const mins = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (mins < 1) return "< 1 мин";
  if (mins < 60) return `${Math.round(mins)} мин`;
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days === 0) return `${hours}ч`;
  const rest = hours % 24;
  return rest > 0 ? `${days}д ${rest}ч` : `${days}д`;
}

export function ageColor(iso: string | null | undefined): string {
  if (!iso) return C.textTertiary;
  const mins = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (mins < 120) return C.green;
  if (mins < 720) return C.yellow;
  if (mins < 1440) return C.orange;
  return C.red;
}
