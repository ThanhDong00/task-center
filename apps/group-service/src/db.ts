import { DataSource } from 'typeorm';
import { BanSchema, GroupSchema, InvitationSchema, MembershipSchema } from './group.ts';

// Owns Group, membership, Invitation. Sole writer/reader of group_db (ADR-0003).
// ponytail: synchronize:true, migration once schema churn settles.
export const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  username: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'group_db',
  entities: [GroupSchema, MembershipSchema, InvitationSchema, BanSchema],
  synchronize: true,
});
