/**
 * RobloxBank / Антон — installable onEdit guard for column D.
 *
 * Setup in the spreadsheet:
 * 1. Extensions -> Apps Script, paste this file.
 * 2. Project settings -> Script properties -> RB_STATUS_OWNER_EMAILS with a
 *    comma-separated list of owner/bot-operator Google accounts.
 * 3. Triggers -> Add trigger -> antonStatusGuard -> From spreadsheet -> On edit.
 *
 * A simple trigger is not sufficient: an installable trigger is required so
 * Session.getActiveUser().getEmail() can identify workspace editors.
 */

const RB_STATUS_COLUMN = 4; // D
const RB_STATUS_PENDING = "в ожидании";
const RB_STATUS_DONE = "готово";
const RB_STATUS_ERROR = "ошибка";

function antonStatusGuard(event) {
  if (!event || !event.range || event.range.getColumn() !== RB_STATUS_COLUMN || event.range.getNumColumns() !== 1) return;

  const current = String(event.value || "").trim().toLowerCase();
  const previous = String(event.oldValue || "").trim().toLowerCase();
  if (current === previous) return;

  const actor = String(Session.getActiveUser().getEmail() || "").trim().toLowerCase();
  const owners = String(PropertiesService.getScriptProperties().getProperty("RB_STATUS_OWNER_EMAILS") || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (actor && owners.includes(actor)) return;

  // Ordinary editors may only return a corrected error row to the queue.
  const allowed = previous === RB_STATUS_ERROR && current === RB_STATUS_PENDING;
  if (allowed) return;

  event.range.setValue(event.oldValue || "");
  SpreadsheetApp.getActive().toast(
    previous === RB_STATUS_DONE
      ? "Выкупленная строка зафиксирована. Обратитесь к владельцу."
      : "Статус меняет бот. Сотруднику разрешено только: ошибка -> в ожидании.",
    "RobloxBank",
    6,
  );
}
