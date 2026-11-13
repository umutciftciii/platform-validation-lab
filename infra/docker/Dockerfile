# syntax=docker/dockerfile:1.7
# One image for all four Node services of the local stack (web-bv, web-corporate, admin, api).
# Compose picks the service by working directory and command. Local/dev use only, not a
# production deploy artifact.

ARG NODE_IMAGE=node:24.22.2-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    CI=1
# Prisma's tooling needs OpenSSL; slim images do not ship it.
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && apt-get clean \
 && corepack enable
WORKDIR /repo

# Development image (compose.dev.yaml). Holds only the toolchain: the source is bind-mounted
# and node_modules / build output live in named volumes. The mount points are created here,
# owned by `node`, so Docker seeds each new named volume with that ownership. /data/media is the
# API's media storage (PM-2, product images), a named volume of its own.
FROM base AS dev
ENV NODE_ENV=development \
    npm_config_store_dir=/pnpm-store
RUN mkdir -p /pnpm-store /repo/.turbo /repo/node_modules \
      /repo/apps/web-bv/node_modules /repo/apps/web-bv/.next \
      /repo/apps/web-corporate/node_modules /repo/apps/web-corporate/.next \
      /repo/apps/admin/node_modules /repo/apps/admin/.next \
      /repo/apps/api/node_modules /repo/apps/api/dist /repo/apps/api/src/generated \
      /repo/packages/config/node_modules /repo/packages/ui/node_modules \
      /repo/packages/contracts/node_modules /repo/packages/contracts/dist \
      /repo/packages/content-schema/node_modules /repo/packages/content-schema/dist \
      /repo/packages/test-utils/node_modules /repo/packages/test-utils/dist \
      /repo/packages/contracts/.turbo /repo/packages/content-schema/.turbo \
      /repo/packages/test-utils/.turbo \
      /repo/tools/smoke/node_modules /repo/tools/visual-qa/node_modules \
      /repo/tools/migrations/node_modules \
      /data/media \
 && chown -R node:node /pnpm-store /repo /data/media \
 && chmod 700 /data/media
USER node
# Bake pnpm into the image so containers start without a network download.
RUN corepack prepare pnpm@10.28.1 --activate

# Download every package in the lockfile once; this layer only changes with the lockfile.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=dream-petroleum-platform-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm fetch --frozen-lockfile

FROM deps AS build
COPY . .
RUN --mount=type=cache,id=dream-petroleum-platform-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile --offline
# Node heap cap per process; turbo.json limits parallel tasks to 2. BuildKit cannot hard-limit
# memory per build on Docker Desktop, so stack.sh budgets this build before starting it.
RUN NODE_OPTIONS=--max-old-space-size=1536 pnpm turbo run build

# `docker build --target check` runs the quality gate without producing a runtime image.
FROM build AS check
RUN NODE_OPTIONS=--max-old-space-size=1536 pnpm turbo run lint typecheck test

FROM build AS runtime
ENV NODE_ENV=production
# Next.js writes its image/ISR cache under .next at runtime.
RUN chown -R node:node apps/web-bv/.next apps/web-corporate/.next apps/admin/.next \
 && mkdir -p /data/media && chown node:node /data/media && chmod 700 /data/media
USER node
