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
# ── Почему он ещё и ЧИНИТ, а не только жалуется (03.09.2026) ────────────────
#
# Coolify по push в main поднимает Web и оба бота, а Guide — нет: у него нет
# webhook намеренно, потому что две параллельные сборки на RF-хосте валят друг
# друга (резолв `docker.io/docker/dockerfile:1.7` отваливается, инцидент 1396).
# Значит после каждой выкатки Web гейт остаётся на старом коде, пока человек не
# запустит `deploy-web-and-guide.sh --guide-only`. За месяц это дало 765
# одинаковых алертов — то есть монитор превратился в шум, а гейт неделями
# обслуживался чужим кодом.
#
# Отсюда лечение здесь же, но с двумя ограничителями, ради которых Guide и
# держали на ручном управлении:
#   * деплой ставится ТОЛЬКО когда очередь Coolify пуста — никаких параллельных
#     сборок; занятая очередь означает «жду следующего тика», а не «алерт»;
#   * повторно лечить не раньше COOLDOWN — но только ПОД ТОТ ЖЕ релиз Web: если
#     выкатка под него не помогла, проблема не в том, что её мало запускали, и
#     надо звать человека. Новый коммит паузу не ждёт (см. `heal_guide`).
# Токен Coolify для этого не нужен (он и просрочен): деплой ставится через
# artisan внутри контейнера панели — то же самое, что делает её кнопка.
#
# Установка (на хосте 89.110.94.117):
#   */5 * * * * /root/drift-watch.sh >> /var/log/drift-watch.log 2>&1
#
# Раз в 5 минут, а не в 15: пока проверка только жаловалась, частота ничего не
# меняла — гейт всё равно ждал человека. Теперь она чинит, и период задаёт то,
# сколько времени вход с Wildberries обслуживается чужим кодом. Стоимость тика —
# три curl-запроса.
#
# Exit code 0 = всё сходится, 1 = дрейф (вылечен или нет — смотри лог).
set -uo pipefail

BASE="${DRIFT_BASE:-https://robloxbank.ru}"
WEB_CONTAINER="${DRIFT_WEB_CONTAINER:-robloxbank-web}"
COOLIFY_CONTAINER="${DRIFT_COOLIFY_CONTAINER:-coolify}"
COOLIFY_DB_CONTAINER="${DRIFT_COOLIFY_DB_CONTAINER:-coolify-db}"
GUIDE_APP_NAME="${DRIFT_GUIDE_APP:-RobloxBank-Guide}"
HEAL_STATE="${DRIFT_HEAL_STATE:-/var/lib/drift-watch/last-heal}"
# Сборка Guide идёт ~4 минуты; час — это «две-три попытки подряд не помогли».
HEAL_COOLDOWN_SEC="${DRIFT_HEAL_COOLDOWN_SEC:-3600}"
# Самолечение можно выключить одним env, не трогая крон.
HEAL_ENABLED="${DRIFT_HEAL:-1}"
HEADER="x-robloxbank-guide-release"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

header_of() {
  curl -sS --max-time 20 -o /dev/null -D - "$1" 2>/dev/null \
    | tr -d '\r' | awk -v h="$HEADER" 'tolower($1) == h":" {print $2; exit}'
}

status_of() {
  curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null
}

psql_coolify() {
  docker exec "$COOLIFY_DB_CONTAINER" psql -U coolify -d coolify -tAc "$1" 2>/dev/null | tr -d '[:space:]'
}

# Телеграм с RF-хоста отвечает не всегда (в логе есть таймауты до api.telegram.org),
# поэтому отправка — best effort, а не условие работы скрипта.
notify() {
  local text="$1"
  local token chats
  token="$(docker exec "$WEB_CONTAINER" printenv TG_TOKEN 2>/dev/null || true)"
  chats="$(docker exec "$WEB_CONTAINER" printenv ADMIN_IDS 2>/dev/null || true)"
  [[ -z "$chats" ]] && chats="$(docker exec "$WEB_CONTAINER" printenv TG_CHAT_ID 2>/dev/null || true)"
  if [[ -z "$token" || -z "$chats" ]]; then
    echo "$STAMP alert skipped: нет TG_TOKEN/ADMIN_IDS в контейнере $WEB_CONTAINER"
    return 1
  fi
  local payload
  payload="$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
  local ids chat_id
  IFS=',' read -ra ids <<< "$chats"
  for chat_id in "${ids[@]}"; do
    chat_id="$(echo "$chat_id" | xargs)"
    [[ -z "$chat_id" ]] && continue
    curl -sS --max-time 20 -o /dev/null \
      -X POST "https://api.telegram.org/bot${token}/sendMessage" \
      -H "Content-Type: application/json" \
      -d "$(printf '{"chat_id":"%s","text":%s}' "$chat_id" "$payload")" \
      || echo "$STAMP alert to $chat_id failed"
  done
}

# ── Проверка ────────────────────────────────────────────────────────────────
GUIDE_URL="$BASE/guide?source=wb"

guide_status="$(status_of "$GUIDE_URL")"
web_fp="$(header_of "$BASE/")"
guide_fp="$(header_of "$GUIDE_URL")"
served_by="$(curl -sS --max-time 20 "$GUIDE_URL" 2>/dev/null | grep -o 'data-served-by="[^"]*"' | head -1 | cut -d'"' -f2)"

problem=""
stale=0
if [[ "$guide_status" != "200" ]]; then
  problem="гейт отвечает $guide_status вместо 200"
elif [[ -z "$web_fp" || -z "$guide_fp" ]]; then
  problem="не удалось прочитать заголовок $HEADER (web='$web_fp' guide='$guide_fp')"
elif [[ "$web_fp" != "$guide_fp" ]]; then
  problem="Guide отстал от Web: Web=$web_fp, Guide=$guide_fp"
  stale=1
elif [[ "$served_by" != *"Guide"* ]]; then
  problem="гейт обслуживает не Guide-контейнер (data-served-by='$served_by')"
fi

if [[ -z "$problem" ]]; then
  echo "$STAMP ok fingerprint=$web_fp served-by=$served_by"
  exit 0
fi

echo "$STAMP DRIFT $problem"

# ── Лечение: только отставший Guide и только при свободной очереди ──────────
#
# Остальные поломки (гейт не отвечает, отдаёт не тот контейнер) выкаткой не
# лечатся — их надо смотреть руками, поэтому там сразу алерт.
heal_guide() {
  local busy uuid deployment last age healed_fp
  busy="$(psql_coolify "select count(*) from application_deployment_queues where status in ('queued','in_progress');")"
  if [[ -z "$busy" ]]; then
    echo "$STAMP heal: очередь Coolify недоступна — лечение пропущено"
    return 1
  fi
  if [[ "$busy" != "0" ]]; then
    # Скорее всего это как раз выкатка Web, после которой Guide и отстал.
    echo "$STAMP heal: в очереди $busy сборок — ждём следующего тика (параллельные сборки валят RF-хост)"
    return 2
  fi

  # Пауза между выкатками считается ТОЛЬКО для того же релиза Web.
  #
  # 03.09.2026, первый же боевой прогон: в 10:15 монитор вылечил Guide сам, а в
  # 11:15 приехал новый коммит — и пауза отказалась лечить его словами «прошлая
  # выкатка не помогла», хотя та как раз помогла. Признак «не помогла» — это
  # ТОТ ЖЕ отпечаток Web, под который уже выкатывались; другой отпечаток значит
  # новый релиз, и ждать час перед ним незачем.
  if [[ -f "$HEAL_STATE" ]]; then
    read -r last healed_fp < "$HEAL_STATE" 2>/dev/null || true
    age=$(( $(date +%s) - ${last:-0} ))
    if [[ "$healed_fp" == "$web_fp" ]] && (( age < HEAL_COOLDOWN_SEC )); then
      echo "$STAMP heal: под тот же релиз ($web_fp) выкатывались $age с назад и не помогло — нужен человек"
      return 3
    fi
  fi

  uuid="$(psql_coolify "select uuid from applications where name = '$GUIDE_APP_NAME' limit 1;")"
  if [[ -z "$uuid" ]]; then
    echo "$STAMP heal: приложение '$GUIDE_APP_NAME' не найдено в Coolify"
    return 1
  fi

  # Тот же путь, которым деплоит кнопка панели. Через artisan, а не через API:
  # API требует токен, а он живёт своей жизнью и уже один раз протух молча.
  deployment="$(docker exec "$COOLIFY_CONTAINER" php artisan tinker --execute="\$app = App\Models\Application::where('uuid','$uuid')->first(); \$u = (string) new Visus\Cuid2\Cuid2(7); queue_application_deployment(application: \$app, deployment_uuid: \$u, commit: 'HEAD', force_rebuild: true, is_api: true); echo \$u;" 2>/dev/null | tail -1 | tr -d '[:space:]')"

  if [[ -z "$deployment" ]]; then
    echo "$STAMP heal: artisan не поставил деплой в очередь"
    return 1
  fi
  mkdir -p "$(dirname "$HEAL_STATE")" 2>/dev/null
  # Пишем и время, и релиз, под который лечили: следующий тик по нему отличит
  # «та же выкатка не помогла» от «приехал новый коммит».
  echo "$(date +%s) $web_fp" > "$HEAL_STATE"
  echo "$STAMP heal: Guide поставлен в очередь ($deployment)"
  return 0
}

if [[ "$stale" -eq 1 && "$HEAL_ENABLED" == "1" ]]; then
  heal_guide
  case "$?" in
    0)
      # Сообщение информационное и без просьбы что-то сделать: человеку важно
      # знать, что гейт чинится сам, а не что «опять оно».
      notify "🔧 WB-гейт: Guide отставал (Web=$web_fp, Guide=$guide_fp) — выкатка запущена автоматически.
Проверю через 15 минут; если не сойдётся, напишу ещё раз."
      exit 1
      ;;
    2)
      # Идёт сборка — молча ждём следующего тика, алерта нет намеренно.
      exit 1
      ;;
    3)
      notify "⚠️ WB-гейт: $problem

Автовыкатка Guide под этот же релиз уже была и не помогла. Нужен человек:
scripts/deploy-web-and-guide.sh --guide-only
или лог сборки в Coolify → RobloxBank-Guide."
      exit 1
      ;;
  esac
fi

notify "⚠️ WB-гейт: $problem

Точка входа с Wildberries обслуживается не тем кодом. Лечится выкаткой Guide:
scripts/deploy-web-and-guide.sh --guide-only"

exit 1
