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

# Build-time defaults only.
#
# Coolify injects DATABASE_URL, VK_TOKEN, VK_GROUP_ID, TG_TOKEN, ADMIN_IDS,
# TG_CHAT_ID at *runtime* — they pass through to the process automatically
# without any ENV declaration here. Listing them with empty defaults would
# silently overwrite Coolify's values on container start, so we don't.
#
# HOME and NPM_CONFIG_CACHE are set so any tooling that touches the npm cache
# (e.g. transitive `npm config` lookups, prisma engine extraction) writes to
# a directory the unprivileged user actually owns, instead of trying to
# mkdir /home/botuser at runtime and crashing with EACCES.
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=256" \
    HOME=/home/botuser \
    NPM_CONFIG_CACHE=/home/botuser/.npm

# Non-root user with a real home dir.
#   --create-home (-m): creates /home/botuser, otherwise npm/npx crash with
#                        EACCES on `mkdir /home/botuser` at first start.
#   --shell /usr/sbin/nologin: defence in depth — no interactive login.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --create-home --home-dir /home/botuser \
       --shell /usr/sbin/nologin --uid 1001 --gid nodejs botuser

# Bring over installed deps + generated client. We intentionally drop the
# per-COPY --chown flags here: a single explicit `chown -R` after all COPYs
# is deterministic across multi-stage caching and harder to accidentally skip.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma       ./prisma
COPY --from=deps /app/package.json ./package.json

# Bot source, preserving the on-disk repo layout. Order: shared first
# (most stable), bot-specific last (changes most often).
COPY bots/shared            ./bots/shared
COPY bots/vk/bot.ts         ./bots/vk/bot.ts
COPY bots/vk/handlers.ts    ./bots/vk/handlers.ts
COPY bots/vk/session.ts     ./bots/vk/session.ts
COPY bots/tsconfig.json     ./bots/tsconfig.json

# Explicit ownership transfer for the entire app tree AFTER all COPYs.
# Required because:
#   • Default COPY ownership is root:root and `USER botuser` cannot write
#     into root-owned directories (Prisma engines extract on first DB call,
#     tsx caches transpiled files, etc.).
#   • /home/botuser also handed over so HOME-rooted writes (npm cache,
#     dotfiles created by node libs) don't fail.
RUN chown -R botuser:nodejs /app /home/botuser

USER botuser

WORKDIR /app/bots/vk

# Runtime entrypoint: invoke the *local* tsx bin via its package-published
# shim. Path is relative to WORKDIR (= /app/bots/{vk,tg}), so `../..`
# climbs out to /app and lands in /app/node_modules/.bin/tsx.
#
# Why this form rather than the absolute path to dist/cli.mjs:
#   • `.bin/tsx` is the *published* entrypoint — its location is part of
#     tsx's package contract (declared in its package.json `bin` field).
#     The `dist/cli.mjs` path is an internal detail and has changed
#     between tsx 3.x and 4.x. Pinning to the bin shim insulates us from
#     future tsx upgrades.
#   • Short and self-documenting — anyone reading the Dockerfile
#     immediately sees that we're invoking a local dependency.
#
# Why not `npx tsx`:
#   • npx writes to ~/.npm before resolving the local binary; if HOME
#     isn't writable that's an immediate EACCES.
#   • If npx's local-resolution stumbles, it fetches `tsx` from
#     registry.npmjs.org — production containers should never hit the
#     registry on cold start.
CMD ["sh", "-c", "../../node_modules/.bin/tsx bot.ts"]