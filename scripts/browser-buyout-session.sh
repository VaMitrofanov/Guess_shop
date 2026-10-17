#!/usr/bin/env bash
# Поднимает на сервере выкупа Chrome с постоянным профилем + VNC. Production donor-cookie
# инъецирует browser-purchase-service перед каждой session/preflight/purchase операцией —
# живая cookie-инъекция и официальный purchase flow подтверждены canary 17.07.2026.
# Формовый логин через VNC остаётся только диагностическим/recovery-вариантом и не должен
# создавать второй рабочий donor-контур вне service.
#
# На сервере:  bash browser-buyout-session.sh [start|stop|status]   (от root; Chrome
#              крутится под непривилегированным rbuy — песочница Chrome остаётся
#              включённой, а вместе с ней уходит и плашка --no-sandbox)
# С ноутбука:  ssh -L 5900:localhost:5900 root@<сервер>
#              затем Finder → Cmd+K → vnc://localhost:5900
#
# VNC (5900) и CDP (9222) слушают только localhost — наружу торчит лишь SSH.
#
# CDP нужен, чтобы гонять скрипт покупки в ЭТОМ же прогретом профиле. Важно: сам по себе
# --remote-debugging-port НЕ выставляет navigator.webdriver — его выставляет
# --enable-automation, которого здесь нет. Поэтому подключение puppeteer к уже
# запущенному Chrome сохраняет чистый fingerprint, в отличие от puppeteer.launch().
set -euo pipefail

DIR=/opt/roblox-buyout
PROFILE="$DIR/profile"
CHROME=${CHROME_PATH:-/usr/bin/google-chrome-stable}
export DISPLAY=:99

AS_RBUY=(setpriv --reuid=rbuy --regid=rbuy --init-groups env
  HOME=/home/rbuy XDG_RUNTIME_DIR=/run/user/1000 DISPLAY=:99)

start() {
  systemctl is-active --quiet xvfb.service || systemctl start xvfb.service

  if pgrep -f "user-data-dir=$PROFILE" >/dev/null; then
    echo "Chrome уже запущен"
  else
    mkdir -p "$PROFILE"
    chown -R rbuy:rbuy "$PROFILE"
    # WebGL-флаги обязаны совпадать с probe.mjs: fingerprint прогрева должен быть тем
    # же, что при покупке. А вот --disable-blink-features=AutomationControlled здесь не
    # нужен (он прячет navigator.webdriver, при ручном входе автоматизации нет) — без
    # него Chrome не показывает плашку "unsupported command-line flag".
    nohup "${AS_RBUY[@]}" "$CHROME" \
      --user-data-dir="$PROFILE" \
      --disable-dev-shm-usage \
      --window-size=1280,900 \
      --window-position=0,0 \
      --enable-unsafe-swiftshader \
      --use-gl=angle \
      --use-angle=swiftshader \
      --remote-debugging-port=9222 \
      --remote-debugging-address=127.0.0.1 \
      --no-first-run \
      --no-default-browser-check \
      "https://www.roblox.com/login" \
      >/tmp/chrome.log 2>&1 &
    sleep 3
    echo "Chrome запущен"
  fi

  pgrep x11vnc >/dev/null || {
    nohup "${AS_RBUY[@]}" x11vnc -display :99 -localhost -rfbport 5900 -forever -shared -nopw \
      >/tmp/x11vnc.log 2>&1 &
    sleep 2
    echo "x11vnc запущен на 127.0.0.1:5900"
  }
  status
}

stop() {
  pkill -f "user-data-dir=$PROFILE" 2>/dev/null || true
  pkill x11vnc 2>/dev/null || true
  echo "Chrome и x11vnc остановлены (профиль сохранён)"
}

status() {
  echo "--- статус ---"
  systemctl is-active xvfb.service | xargs -I{} echo "xvfb:   {}"
  pgrep -f "user-data-dir=$PROFILE" >/dev/null && echo "chrome: запущен" || echo "chrome: остановлен"
  pgrep x11vnc >/dev/null && echo "x11vnc: слушает 127.0.0.1:5900" || echo "x11vnc: остановлен"
  echo "профиль: $PROFILE ($(du -sh "$PROFILE" 2>/dev/null | cut -f1 || echo пусто))"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "Использование: $0 [start|stop|status]"; exit 1 ;;
esac
