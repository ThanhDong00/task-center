# TaskCenter

Lightweight Jira-inspired task and team app (spec: issue #1).

## Boot

```sh
pnpm install     # link workspace
pnpm stack:up    # podman-compose up -d (postgres + five logical DBs)
pnpm verify      # skeleton checks: files, contracts, DataSources, DBs
pnpm typecheck   # tsc --noEmit across apps/* and packages/*
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
