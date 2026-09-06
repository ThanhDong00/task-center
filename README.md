# TaskCenter

Lightweight Jira-inspired task and team app (spec: issue #1).

## Boot

```sh
pnpm install     # link workspace
pnpm stack:up    # podman-compose up -d (postgres + five logical DBs)
pnpm verify      # skeleton checks: files, contracts, DataSources, DBs
pnpm typecheck   # tsc --noEmit across apps/* and packages/*

# Auth end-to-end (issue #3): one terminal per service, then verify
pnpm dev:auth    # auth-service :3001 (register/login/refresh/me)
pnpm dev:gateway # gateway :3000 (JWT verify + proxy /api/auth/*)
pnpm verify:auth # gateway REST checks: register, login, refresh, me, 401s
```

Requires: node 24, pnpm 11, podman + podman-compose (or `docker compose up -d`).

## Layout

- `apps/api-gateway` → `gateway_db` (stateless in v1: REST routing + JWT verify)
- `apps/auth-service` → `auth_db` (owns User)
- `apps/group-service` → `group_db` (owns Group, membership, Invitation)
- `apps/task-service` → `task_db` (owns Task, comments)
- `apps/notification-service` → `notification_db` (owns Notification)
- `packages/contracts` → strict shared RabbitMQ event types
- `db/init.sql` → creates the five logical databases (ADR-0003)
