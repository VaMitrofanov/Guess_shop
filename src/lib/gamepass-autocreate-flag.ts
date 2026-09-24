/**
 * Флаг метода «пасс по ключу» — веб-сторона.
 *
 * Ядро в `bots/shared/gamepass-autocreate-flag.ts`: одна и та же переменная
 * `GAMEPASS_AUTOCREATE` включает метод и на сайте, и в ветке ключа у ботов,
 * поэтому читается она из одного места.
 */

export { gamepassAutocreateEnabled } from "../../bots/shared/gamepass-autocreate-flag";
