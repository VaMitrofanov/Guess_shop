#!/usr/bin/env bash
# Перенос базы Neon → свой Postgres (Coolify) и сверка. План: docs/infra-move-frankfurt.md
#
# Запускать НА СЕРВЕРЕ НОВОЙ БАЗЫ (Франкфурт), от root. Адреса и пароли — только в
# /root/db-move.env (репозиторий публичный):
#   SOURCE_URL='postgresql://…neon.tech/neondb?sslmode=require'   # прямой адрес Neon, НЕ -pooler
#   PG_CONTAINER='postgres-xxxx'      # имя контейнера Postgres из Coolify (docker ps)
#   PG_USER='rb'  PG_DB='robloxbank'
#
#   bash transfer.sh rehearsal   # репетиция: целевая база очищается и заливается заново
#   bash transfer.sh final       # окно переезда: то же, но отказ, если в цели уже есть данные
#   bash transfer.sh verify      # только сверка числа строк
set -euo pipefail
MODE="${1:-}"
ENV_FILE="${DB_MOVE_ENV:-/root/db-move.env}"
# Настройки — из окружения или из файла (окружение главнее: так репетиция не пишет пароли на диск).
if [ -z "${SOURCE_URL:-}" ]; then
  [ -r "$ENV_FILE" ] || { echo "нет $ENV_FILE и не задан SOURCE_URL — см. шапку скрипта" >&2; exit 1; }
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi
: "${SOURCE_URL:?}" "${PG_CONTAINER:?}" "${PG_USER:?}" "${PG_DB:?}"
WORK="${DB_MOVE_WORK:-/root/db-move}"; mkdir -p "$WORK"; chmod 700 "$WORK"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DUMP="$WORK/neon-$STAMP.dump"
PG_IMAGE=postgres:17   # клиент той же major-версии, что Neon (17.x)

src_psql() { docker run --rm --network host -e PGCONNECT_TIMEOUT=20 "$PG_IMAGE" psql "$SOURCE_URL" -XAtq -v ON_ERROR_STOP=1 -c "$1"; }
dst_psql() { docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -XAtq -v ON_ERROR_STOP=1 -c "$1"; }

tables() { src_psql "select tablename from pg_tables where schemaname='public' order by 1"; }

verify() {
  echo "== сверка числа строк (источник → цель)"
  local bad=0 n=0 t s d
  while IFS= read -r t; do
    [ -z "$t" ] && continue
    n=$((n + 1))
    s=$(src_psql "select count(*) from \"$t\"")
    d=$(dst_psql "select count(*) from \"$t\"" 2>/dev/null || echo "нет")
    if [ "$s" != "$d" ]; then bad=$((bad + 1)); printf '  ✗ %-32s %8s → %s\n' "$t" "$s" "$d"; fi
  done < <(tables)
  local smig dmig
  smig=$(src_psql "select count(*) from _prisma_migrations where finished_at is not null")
  dmig=$(dst_psql "select count(*) from _prisma_migrations where finished_at is not null" 2>/dev/null || echo "нет")
  echo "  миграции Prisma: $smig → $dmig"
  [ "$smig" = "$dmig" ] || bad=$((bad + 1))
  if [ "$bad" -eq 0 ]; then echo "✅ все $n таблиц совпали"; else echo "❌ расхождений: $bad"; return 1; fi
}

transfer() {
  local existing
  existing=$(dst_psql "select count(*) from pg_tables where schemaname='public'")
  if [ "$existing" != "0" ]; then
    if [ "$MODE" = final ]; then echo "в целевой базе уже $existing таблиц — final только в пустую базу" >&2; exit 1; fi
    echo "== репетиция: очищаю целевую схему public ($existing таблиц)"
    dst_psql "drop schema public cascade; create schema public;"
  fi
  echo "== pg_dump из Neon → $DUMP"
  local t0=$SECONDS
  docker run --rm --network host -v "$WORK:/w" "$PG_IMAGE" \
    pg_dump "$SOURCE_URL" --format=custom --no-owner --no-privileges --file="/w/$(basename "$DUMP")"
  chmod 600 "$DUMP"
  echo "   готово за $((SECONDS - t0)) с, размер $(du -h "$DUMP" | cut -f1)"
  echo "== pg_restore в $PG_CONTAINER/$PG_DB"
  t0=$SECONDS
  docker exec -i "$PG_CONTAINER" pg_restore -U "$PG_USER" -d "$PG_DB" --no-owner --no-privileges --exit-on-error < "$DUMP"
  echo "   готово за $((SECONDS - t0)) с"
  # Сортировка у Neon — C.UTF-8; другая сортировка поменяла бы порядок строк в списках.
  local scoll dcoll
  scoll=$(src_psql "select datcollate from pg_database where datname=current_database()")
  dcoll=$(dst_psql "select datcollate from pg_database where datname=current_database()")
  echo "== сортировка: источник $scoll / цель $dcoll"
  if [ "$scoll" != "$dcoll" ]; then
    echo "❌ сортировка не совпадает — пересоздать базу в Coolify с initdb args: --locale=C.UTF-8 --encoding=UTF8" >&2
    exit 1
  fi
  verify
  # Старые дампы держим 3 последних.
  ls -1t "$WORK"/neon-*.dump 2>/dev/null | tail -n +4 | xargs -r rm -f
}

case "$MODE" in
  rehearsal|final) transfer ;;
  verify) verify ;;
  *) echo "использование: $0 rehearsal|final|verify" >&2; exit 2 ;;
esac
