/**
 * Сценарий VoxEngine для DBS-звонка. Вставляется в редактор сценариев Voximplant
 * как есть; наш код его только запускает через Management API `StartScenarios`.
 *
 * План — docs/wb-voice-call-plan.md. Это версия для этапов Z1–Z4: она умеет
 * пройти IVR подменного номера Wildberries и проговорить одну из двух реплик.
 * Приёма кода с клавиатуры здесь НЕТ и не должно быть до отдельного решения Г5.
 *
 * Ожидаемый customData (JSON):
 *   {
 *     "phone":   "79001234567",   // куда звоним: подменный номер WB или свой для теста
 *     "ext":     "464",           // последние 3 цифры номера заказа; "" для теста без IVR
 *     "script":  "code" | "chat", // какую реплику говорить
 *     "orderId": "5514551464",    // только для вебхука и логов
 *     "webhook": "https://…",     // куда отдать исход, можно пустым при ручном тесте
 *     "sig":     "…"              // подпись вебхука
 *   }
 */
require(Modules.AMD);

const CALLER_ID = "СЮДА_НОМЕР_КУПЛЕННЫЙ_В_VOXIMPLANT";

const LINES = {
  chat:
    "Здравствуйте! Это магазин Роблокс Банк, вы оформили у нас заказ на Вайлдберриз. " +
    "Товар цифровой, ждать доставку не нужно — вы можете получить его прямо сейчас. " +
    "Откройте приложение Вайлдберриз, раздел Доставки, выберите ваш заказ и нажмите " +
    "Чат с продавцом. Мы сразу напишем вам, что делать дальше. Повторяю: приложение " +
    "Вайлдберриз, раздел Доставки, ваш заказ, кнопка Чат с продавцом. Спасибо!",
  code:
    "Здравствуйте! Это магазин Роблокс Банк, вы оформили у нас заказ на Вайлдберриз. " +
    "Товар цифровой, ждать доставку не нужно — вы можете получить его прямо сейчас. " +
    "Мы написали вам в чат Вайлдберриз. Откройте приложение, раздел Доставки, ваш заказ, " +
    "чат с продавцом — и отправьте туда код получения. Сразу после этого пришлём вам код " +
    "активации. Повторяю: отправьте код получения в чат с продавцом на Вайлдберриз. Спасибо!",
};

VoxEngine.addEventListener(AppEvents.Started, () => {
  const d = JSON.parse(VoxEngine.customData() || "{}");
  const text = LINES[d.script] || LINES.code;
  let done = false;

  const call = VoxEngine.callPSTN(d.phone, CALLER_ID);

  call.addEventListener(CallEvents.Connected, () => {
    // IVR подменного номера Wildberries просит последние три цифры номера заказа
    // и только после этого соединяет с покупателем. Даём роботу договорить, потом
    // отправляем цифры тоном. Задержка подбирается на Z1 по живой записи.
    if (d.ext) {
      setTimeout(() => call.sendDigits(String(d.ext)), 3000);
      // Речь начинаем не сразу: сначала WB должен успеть соединить с человеком.
      setTimeout(() => call.detectAnsweringMachine(), 6000);
    } else {
      call.detectAnsweringMachine();
    }
  });

  call.addEventListener(AMD.Events.DetectionComplete, (e) => {
    if (e.result === "machine") return finish("MACHINE");
    call.say(text, { language: VoiceList.Yandex.ru_RU_Filipp });
  });

  call.addEventListener(CallEvents.PlaybackFinished, () => finish("ANSWERED"));
  call.addEventListener(CallEvents.Failed, (e) => finish("FAILED_" + e.code));
  call.addEventListener(CallEvents.Disconnected, () => finish("HANGUP"));

  function finish(outcome) {
    if (done) return;
    done = true;
    Logger.write("DBS_CALL_OUTCOME " + d.orderId + " " + outcome);
    if (!d.webhook) return VoxEngine.terminate();
    Net.httpRequest(d.webhook, {
      method: "POST",
      headers: ["Content-Type: application/json"],
      postData: JSON.stringify({ orderId: d.orderId, outcome, sig: d.sig }),
    }).then(() => VoxEngine.terminate(), () => VoxEngine.terminate());
  }
});
