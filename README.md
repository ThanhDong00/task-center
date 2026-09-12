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
pnpm dev:gateway # gateway :3000 (JWT verify + proxy /api/auth/*, /api/tasks/*)
pnpm verify:auth # gateway REST checks: register, login, refresh, me, 401s

# Personal tasks (issue #4): task-service alongside the above, then verify
pnpm dev:task    # task-service :3002 (personal task CRUD)
pnpm verify:tasks # gateway REST checks: CRUD, status, priority/due date, creator-only

# Web desk (issue #8): all five services + gateway up, then the SPA
pnpm dev:web     # vite :5173 (gateway :3000, notifications WS direct :3004)
pnpm verify:web  # SPA refresh-retry client checks (no infra needed)
```

Requires: node 24, pnpm 11, podman + podman-compose (or `docker compose up -d`).

## Layout

- `apps/api-gateway` → `gateway_db` (stateless in v1: REST routing + JWT verify)
- `apps/auth-service` → `auth_db` (owns User)
- `apps/group-service` → `group_db` (owns Group, membership, Invitation)
- `apps/task-service` → `task_db` (owns Task, comments)
- `apps/notification-service` → `notification_db` (owns Notification)
- `apps/web` → React + Vite SPA (auth, tasks, groups, live signals)
- `packages/contracts` → strict shared RabbitMQ event types
- `db/init.sql` → creates the five logical databases (ADR-0003)
