# syntax=docker/dockerfile:1.7

# ────────────────────────────────────────────────────────────────────────────
# VK long-polling bot for RobloxBank.
#
# Build context (Coolify):
#   Base Directory:      /              (repo root)
#   Dockerfile Location: /bots/vk/Dockerfile
#
# Why context = repo root: the bot needs three separate paths from the repo:
#   • bots/vk/        — own source (bot.ts / handlers.ts / session.ts)
#   • bots/shared/    — cross-bot helpers (db.ts, admin.ts, notify.ts)
#   • prisma/         — shared schema for `prisma generate`
# Setting context to /bots/vk would cut us off from the latter two.
#
# Image layout inside the container mirrors the repo so existing relative
# imports (e.g. `../shared/db` in handlers.ts) work without any rewrites:
#   /app/bots/vk/   /app/bots/shared/   /app/prisma/   /app/node_modules/
#
# Resource budget: this image is sized for the X280 (16 GB) and the small
# 4 GB Coolify VPS. Heap capped at 256 MB — bot is I/O-bound, idles ~60 MB.
# ────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=22-bookworm-slim


# ────────────────────────────────────────────────────────────────────────────
# Stage 1 — deps: install bot's dependencies and generate the Prisma client.
# Cache key: bots/vk/package.json + prisma/schema.prisma. Re-runs only when
# either changes.
# ────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# OpenSSL is a runtime dep of the Prisma library engine on Debian.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Cap install-time memory — `prisma generate` spawns its own node process.
ENV NODE_OPTIONS="--max-old-space-size=512"

# Copy bot manifest first for max layer-cache reuse.
COPY bots/vk/package.json ./package.json

# Copy the shared Prisma schema *before* install so we can run `prisma
# generate` deterministically inside the image (matches the schema we just
# committed, not whatever was on the dev machine).
COPY prisma ./prisma

# `npm install` (not `ci`) — the per-bot lockfile may not yet be committed
# on first deploy. Switch to `npm ci` once bots/vk/package-lock.json lands.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm install --no-audit --no-fund --prefer-offline --ignore-scripts

# Generate the Prisma client against the *image's* schema path. The
# bot script's relative path (../../prisma) is meant for local dev; here
# we override with the in-image absolute path.
RUN npx prisma generate --schema ./prisma/schema.prisma


# ────────────────────────────────────────────────────────────────────────────
# Stage 2 — runner: minimal runtime image. Final size ≈ 220 MB.
# Carries node_modules (with generated Prisma engines), the schema, the
# shared helpers, the VK bot source, and tsx for on-the-fly TS execution.
# ────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    # Bot is I/O-bound; 256 MB heap is plenty and prevents runaway memory
    # in case of a handler bug holding references.
    NODE_OPTIONS="--max-old-space-size=256"

# Non-root user — defence in depth + sane volume permissions.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs botuser

# Bring over installed deps + generated client.
COPY --from=deps --chown=botuser:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=botuser:nodejs /app/prisma       ./prisma
COPY --from=deps --chown=botuser:nodejs /app/package.json ./package.json

# Bot source, preserving the on-disk repo layout. Order: shared first
# (most stable), bot-specific last (changes most often).
COPY --chown=botuser:nodejs bots/shared      ./bots/shared
COPY --chown=botuser:nodejs bots/vk/bot.ts       ./bots/vk/bot.ts
COPY --chown=botuser:nodejs bots/vk/handlers.ts  ./bots/vk/handlers.ts
COPY --chown=botuser:nodejs bots/vk/session.ts   ./bots/vk/session.ts
COPY --chown=botuser:nodejs bots/tsconfig.json   ./bots/tsconfig.json

USER botuser

# `tsx` resolves up the tree → finds /app/node_modules.
WORKDIR /app/bots/vk
CMD ["npx", "tsx", "bot.ts"]
