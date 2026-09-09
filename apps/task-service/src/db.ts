import { DataSource } from 'typeorm';
import { CommentSchema, TaskSchema } from './task.ts';

// Owns Task, comments. Sole writer/reader of task_db (ADR-0003).
// ponytail: synchronize:true, migration once schema churn settles.
export const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  username: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'task_db',
  entities: [TaskSchema, CommentSchema],
  synchronize: true,
});
