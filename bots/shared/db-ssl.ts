/* ─────────────────────────────────────────────────────────────────────────────
   TLS к базе: публичный сертификат (Neon) или наш собственный CA (свой Postgres).

   До переезда (Neon) ничего не меняется: `sslmode=require` в строке
   подключения усиливается до `verify-full`, сертификат Neon проверяется по
   системным корням.

   Свой Postgres в Coolify (план `docs/infra-move-frankfurt.md`) подписан
   собственным CA Coolify — системные корни его не знают, и `verify-full`
   отказал бы. Тогда в env кладётся `DATABASE_CA` (PEM корня CA) и соединение
   проверяется по нему: доверяем ТОЛЬКО сертификатам, выпущенным нашим CA
   (закрытый ключ CA есть только на сервере базы). Имя хоста не сверяем —
   сайт ходит к базе по IP, а сертификат Coolify выписан на имя контейнера;
   подмену без закрытого ключа CA это всё равно не пропускает.

   Важно: в node-postgres параметры из строки подключения ПЕРЕБИВАЮТ объект
   `ssl`, поэтому при `DATABASE_CA` убираем `sslmode`/`sslrootcert` из строки.
   ───────────────────────────────────────────────────────────────────────── */

import type { ConnectionOptions } from "node:tls";

export interface DbConnectionConfig {
  connectionString: string;
  ssl?: ConnectionOptions;
}

/** PEM из env: допускаем «\n» вместо переносов (Coolify хранит одной строкой). */
function pemFromEnv(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const pem = value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
  return pem.includes("BEGIN CERTIFICATE") ? pem : null;
}

/**
 * Строка подключения и TLS-настройки для `pg.Pool`.
 * `rewrite` — дополнительная правка URL (у сайта — пулер Neon).
 */
export function dbConnectionConfig(
  rawUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  rewrite?: (url: URL) => void,
): DbConnectionConfig {
  const ca = pemFromEnv(env.DATABASE_CA);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { connectionString: rawUrl };
  }
  rewrite?.(url);
  if (ca) {
    url.searchParams.delete("sslmode");
    url.searchParams.delete("sslrootcert");
    url.searchParams.delete("channel_binding");
    return {
      connectionString: url.toString(),
      ssl: { ca, rejectUnauthorized: true, checkServerIdentity: () => undefined },
    };
  }
  if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
  return { connectionString: url.toString() };
}
