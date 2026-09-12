/**
 * Разбор «что делать с этим заказом» — веб-сторона.
 *
 * Правила живут в `bots/shared/gamepass-plan.ts`: боты не умеют импортировать
 * из `src/`, а веб из `bots/shared` умеет, поэтому ядро там, а здесь только
 * переэкспорт. Копию правил заводить нельзя — сайт и бот разъехались бы в том,
 * какие пассы просят создать (и покупатель, начав в боте, увидел бы на сайте
 * другую цену).
 */

export {
  MAX_AUTO_PARTS,
  MIN_SPLIT_PART_ROBUX,
  SPLIT_PLANS,
  coveredRobux,
  createTargetsFor,
  expectedGamepassPrice,
  idealTargetsFor,
  netFromPrice,
  planFromOwned,
  targetsToCreate,
} from "../../bots/shared/gamepass-plan";

export type {
  CheckPlan,
  CreateTarget,
  OwnedPass,
  PlanOptions,
  PlanPart,
} from "../../bots/shared/gamepass-plan";
