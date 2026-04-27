# syntax=docker/dockerfile:1.7

# ────────────────────────────────────────────────────────────────────────────
# Telegram bot for RobloxBank.
#
# Build context (Coolify):
#   Base Directory:      /              (repo root)
#   Dockerfile Location: /bots/tg/Dockerfile
#
# Architecture mirrors the VK bot — see bots/vk/Dockerfile for the rationale
# on context selection, image layout, and resource caps. The only differences
# below are the dependency set (telegraf instead of vk-io) and the entry
# point (bots/tg/bot.ts).
# ────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=22-bookworm-slim


# ────────────────────────────────────────────────────────────────────────────
# Stage 1 — deps
# ────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_OPTIONS="--max-old-space-size=512"

COPY bots/tg/package.json ./package.json
COPY prisma ./prisma

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm install --no-audit --no-fund --prefer-offline --ignore-scripts

RUN npx prisma generate --schema ./prisma/schema.prisma


# ────────────────────────────────────────────────────────────────────────────
# Stage 2 — runner
# ────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Build-time defaults only.
#
# Coolify injects DATABASE_URL, TG_TOKEN, ADMIN_IDS, TG_CHAT_ID, TG_CHANNEL_ID
# (optional gating), VK_TOKEN (optional cross-platform user lookup) at runtime.
# They reach the process automatically; declaring them here would silently
# overwrite Coolify's values with empty strings.
#
# HOME and NPM_CONFIG_CACHE are set so any tooling that touches the npm cache
# (transitive `npm config` lookups, prisma engine extraction) writes to a
# directory the unprivileged user owns, instead of crashing on `mkdir
# /home/botuser` at runtime.
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

# Bring over installed deps + generated client. Per-COPY --chown removed in
# favour of a single explicit `chown -R` after all COPYs (deterministic
# across multi-stage caching).
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma       ./prisma
COPY --from=deps /app/package.json ./package.json

COPY bots/shared            ./bots/shared
COPY bots/tg/bot.ts         ./bots/tg/bot.ts
COPY bots/tg/handlers.ts    ./bots/tg/handlers.ts
COPY bots/tg/session.ts     ./bots/tg/session.ts
COPY bots/tsconfig.json     ./bots/tsconfig.json

# Explicit ownership transfer for the entire app tree AFTER all COPYs.
# /home/botuser is also handed over so HOME-rooted writes (npm cache, prisma
# engine extraction, dotfiles created by node libs) succeed at runtime.
RUN chown -R botuser:nodejs /app /home/botuser

USER botuser

WORKDIR /app/bots/tg

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
CMD ["../../node_modules/.bin/tsx", "bot.ts"]
