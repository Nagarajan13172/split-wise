# Splitwise API — production image.
# Strategy: install full workspace deps, generate Prisma client, run with tsx
# (no build step). tsx adds ~1-2s of cold start vs. compiled JS; acceptable
# at our self-hosted scale, and keeps the same code path as dev. Swap to a
# bundle (esbuild) later if cold start becomes a real issue.

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl curl python3 make g++
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# --- deps stage (cached) ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/config-eslint/package.json packages/config-eslint/
COPY packages/config-tsconfig/package.json packages/config-tsconfig/
COPY libs/prisma/package.json libs/prisma/
RUN pnpm install --frozen-lockfile

# --- runtime stage ---
FROM deps AS runtime
COPY packages packages
COPY libs libs
COPY apps/api apps/api
RUN pnpm --filter @split-wise/prisma generate

ENV NODE_ENV=production
EXPOSE 4000
WORKDIR /app/apps/api
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:4000/healthz || exit 1
CMD ["pnpm", "exec", "tsx", "src/main.ts"]
