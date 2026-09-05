import { DataSource } from 'typeorm';

// Owns Task, comments. Sole writer/reader of task_db (ADR-0003).
export const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  username: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'task_db',
});
