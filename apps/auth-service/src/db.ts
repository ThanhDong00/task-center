import { DataSource } from 'typeorm';
import { UserSchema } from './user.ts';

// Owns User. Sole writer/reader of auth_db (ADR-0003).
// ponytail: synchronize:true, migration once schema churn settles.
export const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  username: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'auth_db',
  entities: [UserSchema],
  synchronize: true,
});
