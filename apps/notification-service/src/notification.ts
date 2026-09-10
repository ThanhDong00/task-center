// Owns Notification (issue #7). EntitySchema (not decorators) so the file
// stays erasable and plain node can run it via type stripping.
import { EntitySchema } from 'typeorm';

export interface NotificationRow {
  id: string;
  userId: string;
  type: string;
  taskId: string | null;
  groupId: string | null;
  read: boolean;
  createdAt: Date;
}

export const NotificationSchema = new EntitySchema<NotificationRow>({
  name: 'Notification',
  tableName: 'notifications',
  columns: {
    id: { type: String, primary: true },
    userId: { type: String },
    type: { type: String },
    taskId: { type: String, nullable: true },
    groupId: { type: String, nullable: true },
    read: { type: Boolean, default: false },
    createdAt: { type: 'timestamptz', createDate: true },
  },
  indices: [{ columns: ['userId', 'createdAt'] }],
});

export function publicNotification(n: NotificationRow): {
  id: string;
  userId: string;
  type: string;
  taskId: string | null;
  groupId: string | null;
  read: boolean;
  createdAt: string;
} {
  return {
    id: n.id,
    userId: n.userId,
    type: n.type,
    taskId: n.taskId,
    groupId: n.groupId,
    read: n.read,
    createdAt: new Date(n.createdAt).toISOString(),
  };
}
