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

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=256"

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs botuser

COPY --from=deps --chown=botuser:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=botuser:nodejs /app/prisma       ./prisma
COPY --from=deps --chown=botuser:nodejs /app/package.json ./package.json

COPY --chown=botuser:nodejs bots/shared      ./bots/shared
COPY --chown=botuser:nodejs bots/tg/bot.ts       ./bots/tg/bot.ts
COPY --chown=botuser:nodejs bots/tg/handlers.ts  ./bots/tg/handlers.ts
COPY --chown=botuser:nodejs bots/tg/session.ts   ./bots/tg/session.ts
COPY --chown=botuser:nodejs bots/tsconfig.json   ./bots/tsconfig.json

USER botuser

WORKDIR /app/bots/tg
CMD ["npx", "tsx", "bot.ts"]
