-- One Postgres container, five logical databases (ADR-0003).
-- Runs once on first init. Per-service ownership is enforced by
-- separate TypeORM DataSources (apps/*/src/db.ts), not by containers.
CREATE DATABASE auth_db;
CREATE DATABASE gateway_db;
CREATE DATABASE group_db;
CREATE DATABASE task_db;
CREATE DATABASE notification_db;
