#!/bin/bash
# Neon path switch for the RF host. Added 17.10.2026.
#
# Why: the RF -> AWS ap-southeast-1 transit degrades in episodes. On 17.10 a round
# trip to Neon went 210ms -> 590ms and the TLS handshake 1.5s -> 19.5s, which the
# connection pool turned into 500s on /admin. A plain WireGuard tunnel to our SG
# host is not an option — DPI kills it seconds after the handshake (see HANDOFF).
#
# What this does: when the direct path is bad, DNAT container traffic bound for
# Neon:5432 to the socat relay on the SG host, which sits ~2ms from Neon. TLS stays
# end-to-end: the relay only copies bytes, the client still verifies Neon's
# certificate and Neon routes by the client's SNI.
#
# Why not always on: when the transit is healthy the direct path is FASTER
# (~235ms vs ~270ms through Singapore), so the relay is failover, not a default.
#
# Only nat/PREROUTING is touched, i.e. traffic from the containers. Host-local
# traffic stays direct on purpose — that is what this script probes, so the
# measurement never runs through the relay it is deciding about.
#
# Addresses live in /etc/neon-route.conf, never here: this repo is public.
#   RELAY_HOST=<SG host>
#   RELAY_PORT=5433
#   NEON_HOSTS="<pooler endpoint> <direct endpoint>"
#
# Deploy: scp to /root/neon-route.sh on the RF host, run by neon-route.timer every
# minute. Safe to run by hand. Rollback: `bash /root/neon-route.sh off`.

set -u

CONF="${NEON_ROUTE_CONF:-/etc/neon-route.conf}"
if [ ! -r "$CONF" ]; then
  echo "neon-route: $CONF is missing — refusing to guess addresses" >&2
  exit 1
fi
# shellcheck disable=SC1090
. "$CONF"
: "${RELAY_HOST:?RELAY_HOST not set in $CONF}"
: "${RELAY_PORT:=5433}"
: "${NEON_HOSTS:?NEON_HOSTS not set in $CONF}"

CHAIN="NEON_RELAY"
STATE_DIR="/var/lib/neon-route"
STATE_FILE="$STATE_DIR/state"          # on | off
STREAK_FILE="$STATE_DIR/good_streak"
LOG="/var/log/neon-route.log"

# A round trip is ~220ms healthy. Switch to the relay above 450ms (the relay costs
# ~270ms, so below that it would make things worse), switch back below 300ms.
BAD_MS="${BAD_MS:-450}"
GOOD_MS="${GOOD_MS:-300}"
GOOD_STREAK_NEEDED="${GOOD_STREAK_NEEDED:-2}"

mkdir -p "$STATE_DIR"
[ -f "$STATE_FILE" ]  || echo off > "$STATE_FILE"
[ -f "$STREAK_FILE" ] || echo 0   > "$STREAK_FILE"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$LOG"; }

# TCP connect time in ms, or "fail".
connect_ms() {
  local host=$1 port=$2 start end
  start=$(date +%s%N)
  if timeout 4 bash -c "exec 3<>/dev/tcp/$host/$port" 2>/dev/null; then
    end=$(date +%s%N)
    echo $(( (end - start) / 1000000 ))
  else
    echo fail
  fi
}

resolve_neon() {
  local h
  for h in $NEON_HOSTS; do
    getent ahostsv4 "$h" 2>/dev/null | awk '{print $1}'
  done | sort -u
}

relay_on() {
  local ips=$1 ip
  iptables -t nat -N "$CHAIN" 2>/dev/null
  iptables -t nat -C PREROUTING -j "$CHAIN" 2>/dev/null || iptables -t nat -I PREROUTING 1 -j "$CHAIN"
  iptables -t nat -F "$CHAIN"
  for ip in $ips; do
    iptables -t nat -A "$CHAIN" -d "$ip" -p tcp --dport 5432 \
      -j DNAT --to-destination "$RELAY_HOST:$RELAY_PORT"
  done
  echo on > "$STATE_FILE"
}

relay_off() {
  iptables -t nat -F "$CHAIN" 2>/dev/null
  iptables -t nat -D PREROUTING -j "$CHAIN" 2>/dev/null
  iptables -t nat -X "$CHAIN" 2>/dev/null
  echo off > "$STATE_FILE"
}

case "${1:-auto}" in
  off)    relay_off; log "manual off"; echo "relay off"; exit 0 ;;
  on)     relay_on "$(resolve_neon)"; log "manual on"; echo "relay on"; exit 0 ;;
  status) echo "state=$(cat "$STATE_FILE") streak=$(cat "$STREAK_FILE")"
          iptables -t nat -L "$CHAIN" -n 2>/dev/null | tail -n +3; exit 0 ;;
esac

NEON_IPS=$(resolve_neon)
if [ -z "$NEON_IPS" ]; then
  log "DNS for Neon returned nothing — leaving state untouched"
  exit 0
fi
PROBE_IP=$(echo "$NEON_IPS" | head -1)

# Three probes, take the median; a failure counts as the worst case.
fails=0
samples=()
for _ in 1 2 3; do
  ms=$(connect_ms "$PROBE_IP" 5432)
  if [ "$ms" = fail ]; then fails=$((fails + 1)); samples+=(99999); else samples+=("$ms"); fi
done
median=$(printf '%s\n' "${samples[@]}" | sort -n | sed -n 2p)

state=$(cat "$STATE_FILE")
streak=$(cat "$STREAK_FILE")

relay_ms=$(connect_ms "$RELAY_HOST" "$RELAY_PORT")
relay_up=false
[ "$relay_ms" != fail ] && relay_up=true

if [ "$state" = off ]; then
  if { [ "$fails" -ge 2 ] || [ "$median" -gt "$BAD_MS" ]; } && [ "$relay_up" = true ]; then
    relay_on "$NEON_IPS"
    echo 0 > "$STREAK_FILE"
    log "ON  direct median=${median}ms fails=${fails} relay=${relay_ms}ms"
  fi
else
  if [ "$relay_up" != true ]; then
    relay_off
    echo 0 > "$STREAK_FILE"
    log "OFF relay unreachable — falling back to the direct path"
  elif [ "$fails" -eq 0 ] && [ "$median" -lt "$GOOD_MS" ]; then
    streak=$((streak + 1))
    echo "$streak" > "$STREAK_FILE"
    if [ "$streak" -ge "$GOOD_STREAK_NEEDED" ]; then
      relay_off
      echo 0 > "$STREAK_FILE"
      log "OFF direct recovered median=${median}ms (${streak} good checks)"
    fi
  else
    echo 0 > "$STREAK_FILE"
    # Keep the DNAT targets in step with whatever Neon resolves to now.
    relay_on "$NEON_IPS"
  fi
fi
