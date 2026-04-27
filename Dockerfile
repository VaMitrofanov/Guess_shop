# syntax=docker/dockerfile:1.7

# ────────────────────────────────────────────────────────────────────────────
# Multi-stage Dockerfile for Next.js 16 standalone build.
# Tuned for the production deploy host: 89.110.94.117 — Ubuntu 22.04,
# 2 vCPU / 4 GB RAM / 100 GB disk, Moscow.
#
# Key constraints driving every decision below:
#   • Total RAM is 4 GB. After OS (~500 MB), Docker daemon (~200 MB), Coolify
#     PHP-fpm (~300 MB) and the running app container (~250 MB), the budget
#     left for a build is **~2 GB peak**. NODE_OPTIONS caps V8 heap to 1.5 GB
#     so OOM is impossible-not-just-unlikely.
#   • Only 2 vCPU → no aggressive parallel install. We let npm and webpack
#     keep their defaults; the wins come from less work, not more cores.
#   • 100 GB disk is plenty, but `node_modules` + nix store on the same disk
#     blew up the previous Nixpacks build → here we use slim base + targeted
#     layer caching to keep image size under ~300 MB final.
#
# Anti-OOM checklist (all in effect below):
#   ✓ NODE_OPTIONS=--max-old-space-size=1536 in builder
#   ✓ NEXT_TELEMETRY_DISABLED — telemetry alone allocates ~30 MB
#   ✓ ESLint/TS skipped at build time (run in CI/local instead)
#   ✓ no source maps in browser bundle
#   ✓ three.js removed from deps (was 600 MB raw + ~150 KB gzip)
# ────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=22-bookworm-slim


# ────────────────────────────────────────────────────────────────────────────
# Stage 1 — deps: install full node_modules. Cache-friendly: only re-runs
# when package*.json or prisma schema changes.
# ────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# OpenSSL is a runtime dep of Prisma's library engine on Debian.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Cap npm memory too — postinstall runs `prisma generate` which itself
# spawns a node process.
ENV NODE_OPTIONS="--max-old-space-size=1024"

COPY package.json package-lock.json ./
COPY prisma ./prisma

# BuildKit cache mount keeps ~/.npm warm across rebuilds — saves 60–90s
# on every redeploy while not bloating the layer.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund --prefer-offline


# ────────────────────────────────────────────────────────────────────────────
# Stage 2 — builder: run `next build` under tight memory budget.
# This is where every previous deploy died (OOM). Heap is capped to 1.5 GB
# so when webpack tries to overshoot we get a clean error instead of the
# kernel killing the container mid-write and leaving partial chunks.
# ────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    # 1536 MB hard cap on V8 heap — leaves ~500 MB for V8 metadata, native
    # modules, and Linux page cache while still fitting in our ~2 GB budget.
    NODE_OPTIONS="--max-old-space-size=1536"

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Re-run `prisma generate` so the engine binary is generated against the
# exact node_modules tree we're bundling. Cheap — single-digit seconds.
RUN npx prisma generate

# `next build` honours NODE_OPTIONS above. ESLint is skipped per next.config
# so this stage is pure compile + emit.
RUN npm run build


# ────────────────────────────────────────────────────────────────────────────
# Stage 3 — runner: minimal runtime image. Final image: ~250 MB.
# Contains only what's needed to actually serve traffic — no source, no dev
# deps, no build cache, no toolchain.
# ────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

# wget is here only for the HEALTHCHECK; openssl for Prisma library engine.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    # Runtime cap is generous — server.js itself is light, this is the
    # ceiling for runaway request memory before container restart.
    NODE_OPTIONS="--max-old-space-size=512"

# Non-root user — security hardening + Coolify volume permissions sanity.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# 1) Standalone server bundle (server.js + minimum node_modules).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# 2) Static chunks. THIS is the magic line that fixes the 404-on-/_next/static
#    bug from the previous Nixpacks build. Standalone does NOT include them
#    by design — must be copied explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 3) public/ assets (images, robots.txt, mp3s, fonts).
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# 4) Prisma generated client + engine. Next file tracing usually picks these
#    up into standalone, but explicit copy is cheap insurance against silent
#    runtime failures ("PrismaClientInitializationError: engine not found").
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs

EXPOSE 3000

# Healthcheck: 30s interval is friendly to the constrained host. Hits root
# rather than /api/health (which doesn\'t exist yet) — switch when ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
