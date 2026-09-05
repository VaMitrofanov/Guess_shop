import crypto from "crypto";

/**
 * Единственный список админов сервиса — Telegram ID в `ADMIN_IDS`.
 *
 * До A1 «кто админ» решалось в двух местах: `User.role` в БД (desktop `/admin`)
 * и `ADMIN_IDS` в env (TWA + боты). При трёх админах это гарантированный
 * рассинхрон, поэтому источник правды теперь один, и он же используется
 * ботами для рассылки карточек.
 *
 * Список читается **на каждый вызов**, а не один раз при импорте: роль обязана
 * выводиться из актуального состава, иначе снятие админа не действует до
 * перезапуска процесса. Разбор списка — это split строки, дешевле, чем поход
 * в БД, который и так происходит рядом.
 */
function parseList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function adminTelegramIds(): Set<string> {
  return parseList(process.env.ADMIN_IDS);
}

export function isAdminTelegramId(id: string | number | null | undefined): boolean {
  if (id === null || id === undefined || id === "") return false;
  return adminTelegramIds().has(String(id));
}

/**
 * Отпечаток состава `ADMIN_IDS`. Кладётся в выданные пропуска и сверяется при
 * каждой проверке: смена состава немедленно обесценивает все токены, не
 * дожидаясь истечения TTL.
 */
export function adminSetVersion(): string {
  return crypto
    .createHash("sha256")
    .update([...adminTelegramIds()].sort().join(","))
    .digest("hex")
    .slice(0, 12);
}

/**
 * Запасной вход владельца на случай недоступности Telegram.
 *
 * Требует **два** независимых условия: адрес перечислен в
 * `ADMIN_BREAKGLASS_EMAILS` **и** у записи стоит `role = "ADMIN"` в БД. Одной
 * роли в базе недостаточно намеренно — иначе достаточно было бы дотянуться до
 * БД, чтобы выписать себе админку в обход `ADMIN_IDS`.
 */
export function breakGlassEmails(): Set<string> {
  return parseList(process.env.ADMIN_BREAKGLASS_EMAILS?.toLowerCase());
}

export function isBreakGlassEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return breakGlassEmails().has(email.trim().toLowerCase());
}
