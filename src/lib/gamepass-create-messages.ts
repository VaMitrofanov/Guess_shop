/**
 * Вердикты по ключу — веб-сторона.
 *
 * Формулировки живут в `bots/shared/gamepass-create-messages.ts`: тот же текст
 * читает ветка «пришли ключ» в TG/VK, а боты в `src/` смотреть не умеют.
 */

export { keyCreateSuccessText, keyCreateVerdict } from "../../bots/shared/gamepass-create-messages";
export type { KeyCreateVerdict } from "../../bots/shared/gamepass-create-messages";
