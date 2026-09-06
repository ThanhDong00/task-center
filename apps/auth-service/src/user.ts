// Owns User (spec #1). EntitySchema (not decorators) so the file stays
// erasable and plain node can run it via type stripping, no build step.
import { EntitySchema } from 'typeorm';

export interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  avatar: string | null;
}

export const UserSchema = new EntitySchema<UserRow>({
  name: 'User',
  tableName: 'users',
  columns: {
    id: { type: String, primary: true },
    username: { type: String, unique: true },
    passwordHash: { type: String },
    avatar: { type: String, nullable: true },
  },
});

export function publicUser(u: UserRow): { id: string; username: string; avatar: string | null } {
  return { id: u.id, username: u.username, avatar: u.avatar };
}
