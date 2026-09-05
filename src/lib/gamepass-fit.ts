/* ─────────────────────────────────────────────────────────────────────────────
   «Чем ещё можно закрыть этот заказ» — раскладка пассов ника по пригодности.

   Поиск по нику и так умеет отдавать пассы аккаунта (`split-candidates`), но
   сырой список из семи строк в карточке заказа — информационный мусор: на
   вопрос «этим можно выкупить?» он не отвечает, а место занимает. Здесь один
   раз записано правило, по которому строка попадает в одну из трёх групп, и
   обе поверхности (досье сайта и карточка TWA) читают его отсюда — иначе
   «подходит» на телефоне и на ноутбуке начнёт значить разное.

   Правило цены — эталон прайс-гарда (`expectedGamepassPrice` ± `PRICE_TOL`),
   а не самостоятельная арифметика: если гард выкупа считает цену неподходящей,
   карточка не имеет права звать её подходящей.
   ───────────────────────────────────────────────────────────────────────── */

import { splitUsableAmounts } from "@/lib/order-gamepass-split";
import { PRICE_TOL, expectedGamepassPrice } from "@/lib/purchase-guard";

/** Что строка значит для ЭТОГО заказа. */
export type GamepassFitKind =
  /** Этот пасс уже стоит на заказе. */
  | "current"
  /** Цена сходится с номиналом заказа — можно закрыть им одним. */
  | "order"
  /** Одним не закрыть, но он годится в разбивку. */
  | "part"
  /** Пасс занят другим активным заказом. */
  | "busy"
  /** Цена не сходится ни с заказом, ни с частью. */
  | "mismatch";

export interface PickerPass {
  gamepassId: string;
  name: string;
  price: number;
  /** Номинал, который закрывает этот пасс: обратная сторона `ceil(x / 0.7)`. */
  amount: number;
  /** Код активного заказа, который уже стоит на этом пассе. */
  busyWith: string | null;
}

export interface FitPass extends PickerPass {
  kind: GamepassFitKind;
  /**
   * Номинал части, под которую подходит пасс — только когда разбивка уже
   * заведена. У неразбитого заказа частей ещё нет, и обещать конкретное
   * число здесь значило бы придумать его.
   */
  partAmount: number | null;
}

export interface GamepassFitGroups {
  /** Пасс, который стоит на заказе прямо сейчас (если он вообще в списке). */
  current: FitPass | null;
  /** Подходят под номинал заказа. */
  order: FitPass[];
  /** Закрывают часть — если разбивать. */
  part: FitPass[];
  /** Всё остальное: цена не сходится или пасс занят. */
  rest: FitPass[];
  /** Сколько пассов на аккаунте всего — включая тот, что уже на заказе. */
  total: number;
}

export interface SplitPartLike {
  amount: number;
  purchasedAt?: string | Date | null;
}

const fits = (price: number, amount: number) =>
  Math.abs(price - expectedGamepassPrice(amount)) <= PRICE_TOL;

/**
 * Раскладка списка по группам.
 *
 * `currentId` — пасс, который стоит на заказе: он показан в карточке выше и в
 * группах дублироваться не должен. `parts` — уже заведённая разбивка: пока она
 * есть, «часть» это КОНКРЕТНЫЙ незакрытый номинал, а не «что-нибудь поменьше».
 */
export function classifyGamepasses({
  passes,
  orderAmount,
  currentId = null,
  parts = [],
}: {
  passes: PickerPass[];
  orderAmount: number;
  currentId?: string | null;
  parts?: SplitPartLike[];
}): GamepassFitGroups {
  const open = parts.filter(part => !part.purchasedAt);
  /* Разбивки ещё нет: «годится в разбивку» — это не «дешевле номинала», а
     «остаток после него собирается точно». Иначе карточка звала бы в окно
     разбиения с пассами, которыми заказ не закрыть ни в какой комбинации. */
  const usable = open.length > 0 ? null : splitUsableAmounts(orderAmount, passes);
  const groups: GamepassFitGroups = { current: null, order: [], part: [], rest: [], total: passes.length };

  for (const pass of passes) {
    if (currentId && String(pass.gamepassId) === String(currentId)) {
      groups.current = { ...pass, kind: "current", partAmount: null };
      continue;
    }
    if (pass.busyWith) {
      groups.rest.push({ ...pass, kind: "busy", partAmount: null });
      continue;
    }
    if (fits(pass.price, orderAmount)) {
      groups.order.push({ ...pass, kind: "order", partAmount: null });
      continue;
    }
    if (open.length > 0) {
      // Разбивка заведена: годится только тот пасс, который закрывает
      // конкретную незакрытую часть. «Просто дешевле заказа» здесь не годится —
      // сумма частей обязана сойтись с номиналом, допуска нет.
      const part = open.find(item => fits(pass.price, item.amount));
      if (part) {
        groups.part.push({ ...pass, kind: "part", partAmount: part.amount });
        continue;
      }
    } else if (usable?.has(Math.trunc(Number(pass.amount)))) {
      groups.part.push({ ...pass, kind: "part", partAmount: null });
      continue;
    }
    groups.rest.push({ ...pass, kind: "mismatch", partAmount: null });
  }

  // Дешёвые сверху в «частях»: разбивку собирают от крупной части к мелкой,
  // но глазами ищут ту, что закрывает остаток.
  groups.order.sort((a, b) => a.price - b.price);
  groups.part.sort((a, b) => b.price - a.price);
  groups.rest.sort((a, b) => b.price - a.price);
  return groups;
}
