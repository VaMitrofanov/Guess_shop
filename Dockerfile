# syntax=docker/dockerfile:1.7

# ────────────────────────────────────────────────────────────────────────────
# Multi-stage Dockerfile for the Next.js 16 storefront (standalone build).
# Tuned for the production deploy host: 89.110.94.117 — Ubuntu 22.04,
# 2 vCPU / 4 GB RAM / 100 GB disk, Moscow.
#
# Monorepo context (new layout — share with bots/vk/Dockerfile, bots/tg/Dockerfile):
#   Base Directory      = /              (repo root)
#   Dockerfile Location = /Dockerfile
#   • prisma/          — shared schema, lives at the repo root and is copied
#                        into the image with the same layout the app expects.
#   • bots/            — *not* shipped in this image. The build context still
#                        carries it, but the runner stage only copies the
#                        Next.js standalone output, so bot code never lands
#                        in the final site image.
#
# Key constraints driving every decision below:
#   • Total RAM is 4 GB. After OS (~500 MB), Docker daemon (~200 MB), Coolify
#     PHP-fpm (~300 MB) and the running app container (~250 MB), the budget
#     left for a build is ~2 GB peak. NODE_OPTIONS caps V8 heap to 1.5 GB
#     so OOM is impossible-not-just-unlikely.
#   • Only 2 vCPU → no aggressive parallel install. We let npm and webpack
#     keep their defaults; the wins come from less work, not more cores.
#
# Anti-OOM checklist:
#   ✓ NODE_OPTIONS=--max-old-space-size=1536 in builder
#   ✓ NEXT_TELEMETRY_DISABLED — telemetry alone allocates ~30 MB
#   ✓ ESLint/TS skipped at build time (run in CI/local instead)
#   ✓ no source maps in browser bundle
#   ✓ three.js removed from deps
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

# Manifest first → max layer cache reuse.
COPY package.json package-lock.json ./

# Prisma schema lives at the repo root (shared with both bots). The site
# expects to find it at ./prisma/schema.prisma — no path change vs. the
# previous layout, just an explicit reminder that this folder is shared.
COPY prisma ./prisma

# BuildKit cache mount keeps ~/.npm warm across rebuilds.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --include=dev --no-audit --no-fund --prefer-offline


# ────────────────────────────────────────────────────────────────────────────
# Stage 2 — builder: run `next build` under tight memory budget.
# ────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=1536"

COPY --from=deps /app/node_modules ./node_modules

# `COPY . .` honours the universal .dockerignore at the repo root, which
# excludes /bots/<bot-source>, Python files, .git, .env, etc. The site's
# build sees only what `next build` needs. If you tighten this further,
# replace with explicit COPY src public next.config.ts tsconfig.json …
COPY . .

# Re-run `prisma generate` so the engine binary matches the node_modules
# tree we're bundling. Cheap — single-digit seconds.
RUN npx prisma generate

RUN npm run build


# ────────────────────────────────────────────────────────────────────────────
# Stage 3 — runner: minimal runtime image. Final image: ~250 MB.
# Contains only what's needed to serve traffic — no source, no dev deps,
# no build cache, no toolchain, no bot source.
# ────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NODE_OPTIONS="--max-old-space-size=512"

# Non-root user — security hardening + Coolify volume permissions sanity.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# 1) Standalone server bundle (server.js + minimum node_modules).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# 2) Static chunks. Standalone does NOT include them by design — must be
#    copied explicitly, otherwise /_next/static/* 404s.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 3) public/ assets (images, robots.txt, mp3s, fonts).
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# 4) Prisma generated client + engine. Next.js file-tracing usually picks
#    these up into standalone, but explicit copy is cheap insurance against
#    silent runtime failures ("PrismaClientInitializationError").
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma  ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma  ./node_modules/@prisma

USER nextjs

EXPOSE 3000

# Healthcheck: 30s interval is friendly to the constrained host. Hits root
# rather than /api/health (which doesn't exist yet) — switch when ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
