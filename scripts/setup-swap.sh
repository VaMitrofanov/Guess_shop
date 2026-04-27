#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# setup-swap.sh — one-shot configure 4 GB swap on the deploy host.
#
# Why:
#   The deploy host is 89.110.94.117 (Ubuntu 22.04, 2 vCPU, 4 GB RAM, Moscow).
#   Next.js 16 build comfortably hits 1.8–2.4 GB peak memory; combined with
#   Docker daemon, Coolify\'s PHP-fpm, and the running container, total RAM
#   pressure during build can exceed 4 GB. Without swap, the kernel\'s
#   OOM-killer terminates the build container with no warning and leaves
#   Coolify with the cryptic "exit code 255" we saw in the failed deploy.
#
#   A 4 GB swap file converts those OOMs into "build is slower for 30 seconds
#   while V8 hits disk" — which is fine. Modern SSDs handle this gracefully.
#
# What it does:
#   1. Verify swap is not already configured (idempotent — safe to re-run)
#   2. Allocate /swapfile (4 GB), set mode 600, mkswap, swapon
#   3. Persist via /etc/fstab so it survives reboot
#   4. Tune vm.swappiness=10 — only swap under real pressure, not preemptively
#   5. Print swap status
#
# How to run:
#   ssh <user>@89.110.94.117
#   curl -O https://raw.githubusercontent.com/<your-org>/<repo>/main/scripts/setup-swap.sh
#   sudo bash setup-swap.sh
#
# Or, if you\'d rather not pull the script over the network, paste these
# commands directly into the SSH session (they\'re identical to what\'s below):
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: must run as root (try: sudo bash $0)" >&2
    exit 1
fi

SWAP_SIZE_GB=4
SWAP_FILE=/swapfile

# Skip if swap of any size is already active — don\'t double-allocate.
if swapon --show | grep -q .; then
    echo "✓ Swap already active:"
    swapon --show
    echo
    echo "If you want to reconfigure, first run:"
    echo "  sudo swapoff $SWAP_FILE && sudo rm $SWAP_FILE"
    exit 0
fi

echo "→ Allocating ${SWAP_SIZE_GB} GB swap file at $SWAP_FILE ..."
# fallocate is instant on ext4/xfs; dd is the slow fallback if fs doesn\'t
# support it.
if ! fallocate -l ${SWAP_SIZE_GB}G "$SWAP_FILE" 2>/dev/null; then
    echo "  fallocate failed, falling back to dd (slower) ..."
    dd if=/dev/zero of="$SWAP_FILE" bs=1M count=$((SWAP_SIZE_GB * 1024)) status=progress
fi

echo "→ Locking down permissions (only root can read swap) ..."
chmod 600 "$SWAP_FILE"

echo "→ Formatting as swap ..."
mkswap "$SWAP_FILE"

echo "→ Activating ..."
swapon "$SWAP_FILE"

echo "→ Persisting to /etc/fstab ..."
if ! grep -q "^$SWAP_FILE " /etc/fstab; then
    echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
fi

echo "→ Tuning swappiness (10 — only swap under real pressure) ..."
sysctl vm.swappiness=10
if ! grep -q "^vm.swappiness" /etc/sysctl.conf; then
    echo "vm.swappiness=10" >> /etc/sysctl.conf
fi

echo "→ Tuning vfs_cache_pressure (50 — keep fs cache around longer) ..."
sysctl vm.vfs_cache_pressure=50
if ! grep -q "^vm.vfs_cache_pressure" /etc/sysctl.conf; then
    echo "vm.vfs_cache_pressure=50" >> /etc/sysctl.conf
fi

echo
echo "✓ Done. Current memory state:"
free -h
echo
echo "✓ Swap status:"
swapon --show
