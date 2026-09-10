import { DataSource } from 'typeorm';
import { NotificationSchema } from './notification.ts';

// Owns Notification. Sole writer/reader of notification_db (ADR-0003).
// ponytail: synchronize:true, migration once schema churn settles.
export const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  username: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'notification_db',
  entities: [NotificationSchema],
  synchronize: true,
});
