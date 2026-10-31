/**
 * Аннулирование кода гейта — веб-сторона.
 *
 * Правила и работа с БД живут в `bots/shared/wb-code-revocation.ts`: боты не
 * умеют импортировать из `src/`, а веб из `bots/shared` умеет (так же живут
 * `order-hold.ts` и `wb-order-source.ts`). Копии правил заводить нельзя:
 * разойдутся молча, и разойдутся именно в ту сторону, где код снова начнёт
 * приниматься после возврата денег.
 */

export {
  REVOKED_CODE_REFUSAL,
  REVOKED_CODE_STATUS,
  codeActivationRefusal,
  isRevokedCode,
  restoreGateCode,
  revocationHoldReason,
  revokeGateCode,
} from "../../bots/shared/wb-code-revocation";
