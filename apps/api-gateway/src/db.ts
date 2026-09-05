import { DataSource } from 'typeorm';

// Reserved: gateway is stateless in v1 (REST routing + JWT verify only).
// DataSource exists so ownership stays 1:1 per ADR-0003, no queries yet.
export const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  username: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'gateway_db',
});
