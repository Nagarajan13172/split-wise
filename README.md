# split-wise

Self-hosted Splitwise clone (with Pro features) — solo build.

## Stack

- **Backend:** NestJS + tRPC + Prisma + PostgreSQL 16 + BullMQ on Redis
- **Mobile:** Expo (managed) + Expo Router + NativeWind + TanStack Query
- **Web:** Vite + React + TanStack Router + Tailwind + shadcn/ui
- **Shared:** `packages/shared` — zod schemas + pure money/split/balance logic
- **Local dev:** Docker Desktop (postgres + redis + minio)
- **Prod:** Hetzner VPS + Docker Compose + Caddy

## Layout

```
apps/
  api/        NestJS HTTP + tRPC
  worker/     BullMQ processors
  mobile/     Expo (Android + iOS)
  web/        Vite + React dashboard
packages/
  shared/     zod schemas + pure logic
  config-*/   shared eslint/tsconfig/tailwind presets
libs/
  prisma/     schema + generated client
infra/
  docker-compose.yml, Caddyfile, scripts/
```

## Getting started

```bash
# 1. Use the right Node
nvm use            # picks Node 22 from .nvmrc

# 2. Install
pnpm install

# 3. Boot local infra (postgres + redis + minio)
pnpm infra:up

# 4. Migrate DB
cp .env.example .env
pnpm db:migrate

# 5. Run everything
pnpm dev
```

## Plan

Full 14-week phased build plan lives at `~/.claude/plans/do-you-know-about-cheerful-canyon.md`.
