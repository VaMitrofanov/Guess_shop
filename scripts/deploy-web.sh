#!/usr/bin/env bash
#
# Деплой Web с ожиданием webhook и смоуком коридора.
#
# С 02.11.2026 `/guide` отдаёт Web; отдельный Guide-контейнер выведен и удалён
# 11.11.2026 (раньше здесь был `deploy-web-and-guide.sh`). Push в main сам
# поднимает Web и ботов через webhook — скрипт ждёт его, а не дублирует.
#
# Секретов в файле нет — всё из окружения / локального .env:
#   COOLIFY_URL          адрес панели Coolify (см. HANDOFF.md)
#   COOLIFY_TOKEN        API-токен Coolify с правом Deploy
#   COOLIFY_WEB_UUID     UUID приложения RobloxBankWeb
#
# Использование:
#   scripts/deploy-web.sh              # дождаться webhook Web → smoke
#   scripts/deploy-web.sh --force-web  # явный аварийный deploy Web без webhook
#   scripts/deploy-web.sh --no-smoke
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
: "${COOLIFY_URL:?COOLIFY_URL не задан (адрес панели Coolify)}"

FORCE_WEB=0
RUN_SMOKE=1
for arg in "$@"; do
  case "$arg" in
    --force-web)  FORCE_WEB=1 ;;
    --no-smoke)   RUN_SMOKE=0 ;;
    *) echo "Неизвестный аргумент: $arg" >&2; exit 2 ;;
  esac
done

api() { curl -sS -H "Authorization: Bearer $COOLIFY_TOKEN" "$@"; }

# Coolify возвращает активные deployment как JSON-object с числовыми ключами.
# Ищем запись по application UUID внутри deployment_url, не по нестабильному
# внутреннему application_id. stdout — только deployment_uuid.
find_active_deployment() {
  local uuid="$1" commit="${2:-}" webhook_only="${3:-0}"
  api "$COOLIFY_URL/api/v1/deployments" | python3 -c '
import json,sys
uuid, commit, webhook_only = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
payload = json.load(sys.stdin)
rows = list(payload.values()) if isinstance(payload, dict) else payload
matches = []
for row in rows:
    if f"/application/{uuid}/" not in str(row.get("deployment_url", "")):
        continue
    if str(row.get("status", "")) not in {"queued", "in_progress"}:
        continue
    if webhook_only and not row.get("is_webhook"):
        continue
    if commit and not str(row.get("commit", "")).startswith(commit):
        continue
    matches.append(row)
matches.sort(key=lambda row: int(row.get("id", 0)), reverse=True)
if matches:
    print(matches[0].get("deployment_uuid", ""))
' "$uuid" "$commit" "$webhook_only"
}

wait_for_webhook() {
  local uuid="$1" commit="$2"
  echo "→ ждём webhook-deploy Web для commit ${commit:0:7}" >&2
  for _ in $(seq 1 24); do
    local deployment
    deployment=$(find_active_deployment "$uuid" "$commit" 1)
    if [[ -n "$deployment" ]]; then
      echo "  найден webhook deployment: $deployment" >&2
      printf '%s' "$deployment"
      return 0
    fi
    sleep 5
  done
  echo "  ❌ webhook Web не появился за 120 с; force-deploy автоматически НЕ запущен" >&2
  echo "     Проверьте GitHub/Coolify и только после этого повторите с --force-web." >&2
  return 1
}

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

if [[ "$FORCE_WEB" -eq 1 ]]; then
  web_deployment=$(find_active_deployment "$COOLIFY_WEB_UUID")
  if [[ -n "$web_deployment" ]]; then
    echo "→ Web уже queued/in_progress; explicit force не создаёт дубль ($web_deployment)" >&2
  else
    web_deployment=$(trigger "$COOLIFY_WEB_UUID" "Web (explicit force)")
  fi
else
  head_commit=$(git rev-parse HEAD)
  web_deployment=$(wait_for_webhook "$COOLIFY_WEB_UUID" "$head_commit")
fi
wait_for "$web_deployment" "Web"

if [[ "$RUN_SMOKE" -eq 1 ]]; then
  # Coolify говорит `finished` чуть раньше, чем новый контейнер принимает трафик.
  sleep 15
  echo
  echo "→ smoke-corridor"
  node scripts/smoke-corridor.mjs
fi
