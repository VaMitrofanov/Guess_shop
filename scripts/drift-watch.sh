#!/usr/bin/env bash
#
# Монитор дрейфа Web ↔ Guide для крона на RF-хосте (ultra-review 28.07, шаг 0.2).
#
# Зачем отдельный скрипт, а не `smoke-corridor.mjs --drift-only --alert`: на
# RF-хосте нет ни node, ни чекаута репозитория — только Docker. Этот скрипт
# обходится curl и читает секреты из окружения уже работающего контейнера, то
# есть не создаёт ещё одну копию TG_TOKEN на диске.
#
# Проверяет ровно то, из-за чего гейт молча ломается:
#   1. /guide?source=wb отвечает 200 и обслуживается Guide-контейнером;
#   2. фингерпринт релиза у Web и Guide совпадает (иначе Guide отстал).
#
# Установка (на хосте 89.110.94.117):
#   */15 * * * * /root/drift-watch.sh >> /var/log/drift-watch.log 2>&1
#
# Exit code 0 = всё сходится, 1 = дрейф или гейт недоступен.
set -uo pipefail

BASE="${DRIFT_BASE:-https://robloxbank.ru}"
WEB_CONTAINER="${DRIFT_WEB_CONTAINER:-robloxbank-web}"
HEADER="x-robloxbank-guide-release"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

header_of() {
  curl -sS --max-time 20 -o /dev/null -D - "$1" 2>/dev/null \
    | tr -d '\r' | awk -v h="$HEADER" 'tolower($1) == h":" {print $2; exit}'
}

status_of() {
  curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null
}

GUIDE_URL="$BASE/guide?source=wb"

guide_status="$(status_of "$GUIDE_URL")"
web_fp="$(header_of "$BASE/")"
guide_fp="$(header_of "$GUIDE_URL")"
served_by="$(curl -sS --max-time 20 "$GUIDE_URL" 2>/dev/null | grep -o 'data-served-by="[^"]*"' | head -1 | cut -d'"' -f2)"

problem=""
if [[ "$guide_status" != "200" ]]; then
  problem="гейт отвечает $guide_status вместо 200"
elif [[ -z "$web_fp" || -z "$guide_fp" ]]; then
  problem="не удалось прочитать заголовок $HEADER (web='$web_fp' guide='$guide_fp')"
elif [[ "$web_fp" != "$guide_fp" ]]; then
  problem="Guide отстал от Web: Web=$web_fp, Guide=$guide_fp"
elif [[ "$served_by" != *"Guide"* ]]; then
  problem="гейт обслуживает не Guide-контейнер (data-served-by='$served_by')"
fi

if [[ -z "$problem" ]]; then
  echo "$STAMP ok fingerprint=$web_fp served-by=$served_by"
  exit 0
fi

echo "$STAMP DRIFT $problem"

# Секреты берём из окружения работающего контейнера, а не из файла на диске.
TG_TOKEN="$(docker exec "$WEB_CONTAINER" printenv TG_TOKEN 2>/dev/null || true)"
CHAT_IDS="$(docker exec "$WEB_CONTAINER" printenv ADMIN_IDS 2>/dev/null || true)"
[[ -z "$CHAT_IDS" ]] && CHAT_IDS="$(docker exec "$WEB_CONTAINER" printenv TG_CHAT_ID 2>/dev/null || true)"

if [[ -z "$TG_TOKEN" || -z "$CHAT_IDS" ]]; then
  echo "$STAMP alert skipped: нет TG_TOKEN/ADMIN_IDS в контейнере $WEB_CONTAINER"
  exit 1
fi

TEXT="⚠️ WB-гейт: $problem

Точка входа с Wildberries обслуживается не тем кодом. Лечится выкаткой Guide:
scripts/deploy-web-and-guide.sh --guide-only"

IFS=',' read -ra ids <<< "$CHAT_IDS"
for chat_id in "${ids[@]}"; do
  chat_id="$(echo "$chat_id" | xargs)"
  [[ -z "$chat_id" ]] && continue
  curl -sS --max-time 20 -o /dev/null \
    -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "$(printf '{"chat_id":"%s","text":%s}' "$chat_id" \
        "$(printf '%s' "$TEXT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" \
    || echo "$STAMP alert to $chat_id failed"
done

exit 1
