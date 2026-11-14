/**
 * Разговор с менеджером во ВКонтакте: бот молчит, пока говорит человек.
 *
 * Все случаи ниже — из живого диалога `vk.com/id417408722` (10–12.09.2026), где
 * бот вклинился в переписку четыре раза подряд и зациклился на одной фразе.
 * Каждый тест закрывает конкретную причину, а не «поведение вообще».
 */

import {
  MAX_KEY_MISSES,
  SUPPORT_PAUSE_MS,
  __resetSupportPauseStateForTests,
  isSupportPaused,
  looksLikeSupportRequest,
  noteKeyMiss,
  pauseSupport,
  resetKeyMisses,
  resumeSupport,
  shouldHintSupportPause,
} from "../support-pause";

const VK_ID = 417408722;

function makeDb(stored: Date | null = null) {
  return {
    saved: undefined as Date | null | undefined,
    user: {
      findUnique: jest.fn().mockResolvedValue({ supportPausedUntil: stored }),
      updateMany: jest.fn(async (args: any) => {
        db.saved = args.data.supportPausedUntil;
        return { count: 1 };
      }),
    },
  };
}
let db: ReturnType<typeof makeDb>;

beforeEach(() => {
  __resetSupportPauseStateForTests();
  jest.useRealTimers();
  db = makeDb();
});

describe("окно паузы", () => {
  test("живёт сутки, а не полчаса: клиент отвечает менеджеру наутро", async () => {
    await pauseSupport(db as never, VK_ID, "пишет менеджер");
    const armedAt = Date.now();

    jest.useFakeTimers().setSystemTime(armedAt + 6 * 60 * 60 * 1000); // +6 часов
    expect(await isSupportPaused(db as never, VK_ID)).toBe(true);

    jest.setSystemTime(armedAt + SUPPORT_PAUSE_MS + 1000);
    expect(await isSupportPaused(db as never, VK_ID)).toBe(false);
  });

  test("переживает рестарт: после перезапуска пауза читается из БД", async () => {
    const until = new Date(Date.now() + 3 * 60 * 60 * 1000);
    __resetSupportPauseStateForTests(); // «процесс перезапустили» — память пуста
    const freshDb = makeDb(until);

    expect(await isSupportPaused(freshDb as never, VK_ID)).toBe(true);
    expect(freshDb.user.findUnique).toHaveBeenCalledTimes(1);
    // Второй вопрос отвечается из кэша — БД не дёргаем на каждое сообщение.
    expect(await isSupportPaused(freshDb as never, VK_ID)).toBe(true);
    expect(freshDb.user.findUnique).toHaveBeenCalledTimes(1);
  });

  test("протухшая запись в БД паузой не считается", async () => {
    const freshDb = makeDb(new Date(Date.now() - 60 * 1000));
    expect(await isSupportPaused(freshDb as never, VK_ID)).toBe(false);
  });

  test("«+бот» снимает паузу и в памяти, и в базе", async () => {
    await pauseSupport(db as never, VK_ID, "пишет менеджер");
    await resumeSupport(db as never, VK_ID);
    expect(db.saved).toBeNull();
    expect(await isSupportPaused(db as never, VK_ID)).toBe(false);
  });
});

describe("подсказка «бот не вмешивается»", () => {
  test("молчит, пока менеджер отвечает живо", async () => {
    await pauseSupport(db as never, VK_ID, "пишет менеджер");
    expect(shouldHintSupportPause(VK_ID)).toBe(false);
  });

  test("появляется один раз, когда менеджер замолчал надолго", async () => {
    await pauseSupport(db as never, VK_ID, "пишет менеджер");
    const armedAt = Date.now();
    jest.useFakeTimers().setSystemTime(armedAt + 3 * 60 * 60 * 1000);

    expect(shouldHintSupportPause(VK_ID)).toBe(true);
    expect(shouldHintSupportPause(VK_ID)).toBe(false); // второй раз — уже шум
  });
});

describe("просьба о человеке", () => {
  test.each([
    "оператор",
    "позовите менеджера",
    "помогите пожалуйста я не могу понять что я делаю не так",
    "support",
  ])("зовёт человека: %s", (text) => {
    expect(looksLikeSupportRequest(text.toLowerCase())).toBe(true);
  });

  test.each([
    "спасибо вам большое за помощь",
    "спасибо за помощь, всё пришло",
    "спс за помощь",
  ])("благодарность не открывает новое обращение: %s", (text) => {
    expect(looksLikeSupportRequest(text.toLowerCase())).toBe(false);
  });

  test("благодарность с бедой рядом — всё-таки просьба", () => {
    expect(looksLikeSupportRequest("спасибо, но робуксы так и не пришли, помогите".toLowerCase())).toBe(true);
  });

  test("латинский ник Support_Kid просьбой не считается", () => {
    expect(looksLikeSupportRequest("support_kid")).toBe(false);
  });
});

describe("ожидание ключа", () => {
  test("второй промах подряд заканчивает ожидание", () => {
    expect(noteKeyMiss(VK_ID)).toBe(1);
    expect(noteKeyMiss(VK_ID)).toBe(MAX_KEY_MISSES);
  });

  test("удачный ключ обнуляет счёт — следующий заказ начинается с чистого листа", () => {
    noteKeyMiss(VK_ID);
    resetKeyMisses(VK_ID);
    expect(noteKeyMiss(VK_ID)).toBe(1);
  });
});
