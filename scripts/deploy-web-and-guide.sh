#!/usr/bin/env bash
#
# Деплой Web → Guide одной командой (ultra-review U5).
#
# Зачем: автодеплой Coolify по push в main поднимает только Web и ботов, Guide
# остаётся на старой сборке — точка входа с Wildberries начинает обслуживаться
# более старым кодом, чем сайт, и это видно только по смоуку. Скрипт убирает
# ручной шаг и сохраняет обязательный порядок (обе сборки идут на одном RF-хосте,
# параллельный запуск роняет Guide по памяти).
#
# Секретов в файле нет — всё берётся из окружения / локального .env:
#   COOLIFY_URL          (по умолчанию http://127.0.0.1:8000 при запуске на хосте)
#   COOLIFY_TOKEN        API-токен Coolify с правом Deploy
#   COOLIFY_WEB_UUID     UUID приложения RobloxBankWeb
#   COOLIFY_GUIDE_UUID   UUID приложения RobloxBank-Guide
#
# Использование:
#   scripts/deploy-web-and-guide.sh              # Web, затем Guide, затем смоук
#   scripts/deploy-web-and-guide.sh --guide-only # только Guide (Web уже уехал автодеплоем)
#   scripts/deploy-web-and-guide.sh --no-smoke
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

COOLIFY_URL="${COOLIFY_URL:-}"
: "${COOLIFY_TOKEN:?COOLIFY_TOKEN не задан (Coolify → Profile → API Tokens)}"
: "${COOLIFY_WEB_UUID:?COOLIFY_WEB_UUID не задан}"
: "${COOLIFY_GUIDE_UUID:?COOLIFY_GUIDE_UUID не задан}"
: "${COOLIFY_URL:?COOLIFY_URL не задан (адрес панели Coolify)}"

GUIDE_ONLY=0
RUN_SMOKE=1
for arg in "$@"; do
  case "$arg" in
    --guide-only) GUIDE_ONLY=1 ;;
    --no-smoke)   RUN_SMOKE=0 ;;
    *) echo "Неизвестный аргумент: $arg" >&2; exit 2 ;;
  esac
done

api() { curl -sS -H "Authorization: Bearer $COOLIFY_TOKEN" "$@"; }

# Прогресс печатается в stderr: stdout функции — это ТОЛЬКО uuid деплоя,
# который забирает вызывающий через $(...).
trigger() {
  local uuid="$1" name="$2"
  echo "→ деплой $name ($uuid)" >&2
  local response
  response=$(api -X POST "$COOLIFY_URL/api/v1/deploy?uuid=$uuid&force=true")
  local deployment
  deployment=$(printf '%s' "$response" | python3 -c \
    'import json,sys; d=json.load(sys.stdin); print(d["deployments"][0]["deployment_uuid"])')
  echo "  deployment: $deployment" >&2
  printf '%s' "$deployment"
}

wait_for() {
  local deployment="$1" name="$2"
  for _ in $(seq 1 120); do
    local status
    status=$(api "$COOLIFY_URL/api/v1/deployments/$deployment" | python3 -c \
      'import json,sys; print(json.load(sys.stdin).get("status",""))')
    case "$status" in
      finished) echo "  ✅ $name: finished"; return 0 ;;
      failed|cancelled) echo "  ❌ $name: $status" >&2; return 1 ;;
      *) sleep 10 ;;
    esac
  done
  echo "  ❌ $name: таймаут ожидания сборки" >&2
  return 1
}

if [[ "$GUIDE_ONLY" -eq 0 ]]; then
  web_deployment=$(trigger "$COOLIFY_WEB_UUID" "Web")
  wait_for "$web_deployment" "Web"
fi

# Guide — строго ПОСЛЕ завершения Web-сборки.
guide_deployment=$(trigger "$COOLIFY_GUIDE_UUID" "Guide")
wait_for "$guide_deployment" "Guide"

if [[ "$RUN_SMOKE" -eq 1 ]]; then
  echo
  echo "→ smoke-corridor (ожидаем 30/30 и совпадение release-фингерпринтов)"
  node scripts/smoke-corridor.mjs
fi
