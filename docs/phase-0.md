# Phase 0 — Bootstrap (what's done & how to run local infra)

This doc captures the state of the repo at the end of Phase 0 of the Splitwise-clone build, plus everything you need to know to bring up the local Docker infra (Postgres + Redis + MinIO) from a fresh terminal.

---

## 1. What's done so far

### Monorepo scaffold

- **pnpm workspaces** (`pnpm-workspace.yaml`) covering [apps/](../apps/), [packages/](../packages/), [libs/](../libs/).
- **Turborepo** ([turbo.json](../turbo.json)) wiring `dev / build / lint / typecheck / test` across all workspaces.
- **TypeScript** strict base config at [tsconfig.base.json](../tsconfig.base.json), reused by every workspace via `@split-wise/config-tsconfig`.
- **Node 22** pinned via [.nvmrc](../.nvmrc) and `engines.node` in [package.json](../package.json).
- **Prettier** + **Husky** + **lint-staged** wired so commits auto-format.

### Workspaces created (empty skeletons, ready for Phase 1)

| Path | Purpose |
| --- | --- |
| [apps/api/](../apps/api/) | NestJS HTTP + tRPC server |
| [apps/worker/](../apps/worker/) | BullMQ background processors |
| [apps/web/](../apps/web/) | Vite + React + TanStack Router dashboard |
| [apps/mobile/](../apps/mobile/) | Expo (managed) — Android + iOS |
| [packages/shared/](../packages/shared/) | zod schemas + pure money/split/balance logic |
| [packages/config-tsconfig/](../packages/config-tsconfig/) | shared TS presets |
| [packages/config-eslint/](../packages/config-eslint/) | shared ESLint flat-config preset |
| [libs/prisma/](../libs/prisma/) | Prisma schema + generated client |

### Infra & tooling

- [infra/docker-compose.yml](../infra/docker-compose.yml) — Postgres 16, Redis 7, MinIO + a one-shot bucket-init job.
- [.env.example](../.env.example) — every URL the apps will read; already wired to the compose port mappings (`5433 / 6380 / 9002`).
- [.github/workflows/ci.yml](../.github/workflows/ci.yml) — lint + typecheck + test on every push/PR with Postgres + Redis service containers.
- Root `package.json` scripts:
  - `pnpm infra:up` / `pnpm infra:down` / `pnpm infra:logs`
  - `pnpm db:migrate` / `pnpm db:studio`
  - `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test`

### Not done yet (Phase 1+)

- Prisma schema is empty — no models, no migrations.
- Apps are skeletons — no routes, no UI, no auth wiring yet.
- No Sentry / no OAuth credentials / no email provider keys.

---

## 2. Local Docker infra — the full picture

Everything runs in **Docker Desktop on macOS** (you already have it installed). The compose file in [infra/docker-compose.yml](../infra/docker-compose.yml) defines four services:

| Service | Image | Host port → Container port | Why this host port |
| --- | --- | --- | --- |
| `postgres` | `postgres:16-alpine` | **5433** → 5432 | Avoids clashing with a local Postgres on the default 5432. |
| `redis` | `redis:7-alpine` | **6380** → 6379 | Avoids clashing with a local Redis on 6379. |
| `minio` | `minio/minio:latest` | **9002** → 9000 (S3 API), **9003** → 9001 (web console) | 9000/9001 are commonly used; we bump to avoid conflict. |
| `minio-init` | `minio/mc:latest` | _(one-shot)_ | Creates `splitwise-receipts` + `splitwise-avatars` buckets on first start. |

Named volumes `pg_data`, `redis_data`, `minio_data` keep your data across restarts.

### 2.1 Prerequisites (do this once)

1. **Install Docker Desktop** (already done) — open it once so the daemon is running. You can confirm with:
   ```bash
   docker info
   ```
   If you see an error like `Cannot connect to the Docker daemon`, just open Docker Desktop.app and wait ~10 s.

2. **Create your `.env`** so the apps will pick up the right URLs later:
   ```bash
   cp .env.example .env
   ```

That's it — no global Postgres/Redis/MinIO install needed.

### 2.2 Starting everything (the easy way)

From the repo root:

```bash
pnpm infra:up
```

That's just a shortcut for:

```bash
docker compose -f infra/docker-compose.yml up -d
```

First run will pull the images (~200 MB total) and create the volumes; subsequent runs start in a few seconds.

To verify everything is healthy:

```bash
docker compose -f infra/docker-compose.yml ps
```

You should see `postgres`, `redis`, `minio` all `running (healthy)`, and `minio-init` as `exited (0)` (it's a one-shot job — that's correct).

### 2.3 Useful day-to-day commands

```bash
# Tail logs from all services
pnpm infra:logs
#   = docker compose -f infra/docker-compose.yml logs -f

# Logs from one service only
docker compose -f infra/docker-compose.yml logs -f postgres
docker compose -f infra/docker-compose.yml logs -f redis
docker compose -f infra/docker-compose.yml logs -f minio

# Stop everything (data preserved in volumes)
pnpm infra:down
#   = docker compose -f infra/docker-compose.yml down

# Restart a single service
docker compose -f infra/docker-compose.yml restart redis

# Nuke EVERYTHING including volumes (fresh DB, fresh buckets) — destructive
docker compose -f infra/docker-compose.yml down -v
```

### 2.4 Connecting to each service from your terminal

**Postgres** — psql straight into the container (no local psql needed):

```bash
docker exec -it splitwise-postgres psql -U splitwise -d splitwise
# inside psql:
#   \dt    list tables
#   \q     quit
```

Or from a host-installed psql / GUI (DBeaver, TablePlus, Postico):

```
Host:     localhost
Port:     5433
User:     splitwise
Password: splitwise
DB:       splitwise
```

**Redis** — `redis-cli` inside the container:

```bash
docker exec -it splitwise-redis redis-cli
# > PING
# PONG
```

**MinIO** — web console at **http://localhost:9003**

- Username: `minio`
- Password: `minio12345`

The two buckets (`splitwise-receipts`, `splitwise-avatars`) will already be there because the `minio-init` job ran on first boot.

S3 API endpoint (what the apps use): `http://localhost:9002`

### 2.5 What if the auto-init didn't create the buckets?

Re-run just that job:

```bash
docker compose -f infra/docker-compose.yml up minio-init
```

Or do it manually with the MinIO client:

```bash
docker run --rm --network splitwise-dev_default minio/mc:latest sh -c "
  mc alias set local http://minio:9000 minio minio12345 &&
  mc mb --ignore-existing local/splitwise-receipts &&
  mc mb --ignore-existing local/splitwise-avatars
"
```

---

## 3. If you want to do it the "manual" way (without compose)

Equivalent raw `docker run` commands — useful if you ever want to spin up a single service in isolation, or you're on a machine without compose:

```bash
# --- Postgres ---
docker run -d \
  --name splitwise-postgres \
  -e POSTGRES_USER=splitwise \
  -e POSTGRES_PASSWORD=splitwise \
  -e POSTGRES_DB=splitwise \
  -p 5433:5432 \
  -v pg_data:/var/lib/postgresql/data \
  --restart unless-stopped \
  postgres:16-alpine

# --- Redis (with AOF persistence) ---
docker run -d \
  --name splitwise-redis \
  -p 6380:6379 \
  -v redis_data:/data \
  --restart unless-stopped \
  redis:7-alpine redis-server --appendonly yes

# --- MinIO ---
docker run -d \
  --name splitwise-minio \
  -e MINIO_ROOT_USER=minio \
  -e MINIO_ROOT_PASSWORD=minio12345 \
  -p 9002:9000 -p 9003:9001 \
  -v minio_data:/data \
  --restart unless-stopped \
  minio/minio:latest server /data --console-address ":9001"

# --- Create the buckets (after MinIO is up) ---
docker run --rm --link splitwise-minio:minio minio/mc:latest sh -c "
  mc alias set local http://minio:9000 minio minio12345 &&
  mc mb --ignore-existing local/splitwise-receipts &&
  mc mb --ignore-existing local/splitwise-avatars
"
```

Stop/remove later with:

```bash
docker stop splitwise-postgres splitwise-redis splitwise-minio
docker rm   splitwise-postgres splitwise-redis splitwise-minio
```

> ⚠️ **Use compose, not manual.** The raw `docker run` form is here only for understanding. For day-to-day work, always use `pnpm infra:up` — it keeps the config in one file, handles dependencies, and runs the bucket-init job for you.

---

## 4. Troubleshooting cheatsheet

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `bind: address already in use` on 5433 / 6380 / 9002 / 9003 | Another container or process is using that host port. | `lsof -iTCP:5433 -sTCP:LISTEN` to find it, then stop it — or change the host-side port in the compose file. |
| `Cannot connect to the Docker daemon` | Docker Desktop isn't running. | Open Docker Desktop.app and wait until the whale icon is steady. |
| Postgres container restart-loops | Stale `pg_data` volume from an older Postgres major version. | `docker compose -f infra/docker-compose.yml down -v` (destroys data) and start over. |
| App says `ECONNREFUSED 127.0.0.1:5433` | Containers aren't up, or you're on `5432` by mistake. | `docker compose ps` to confirm; double-check `.env` has `:5433`. |
| MinIO console asks for login | Use `minio` / `minio12345` (from the compose file). | — |
| Receipts bucket doesn't exist | `minio-init` job didn't run. | `docker compose -f infra/docker-compose.yml up minio-init`. |

---

## 5. Quick reference card

```bash
# Start            pnpm infra:up
# Stop             pnpm infra:down
# Reset (wipe)     docker compose -f infra/docker-compose.yml down -v
# Logs             pnpm infra:logs
# Status           docker compose -f infra/docker-compose.yml ps
#
# psql             docker exec -it splitwise-postgres psql -U splitwise -d splitwise
# redis-cli        docker exec -it splitwise-redis redis-cli
# MinIO console    http://localhost:9003   (minio / minio12345)
```

Next stop: **Phase 1** — Prisma schema for `User / Group / Membership / Expense / Share / Settlement`, first migration, auth scaffolding.
