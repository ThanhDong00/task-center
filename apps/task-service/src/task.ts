// Owns personal Task (issue #4). EntitySchema (not decorators) so the file
// stays erasable and plain node can run it via type stripping, no build step.
import { EntitySchema } from 'typeorm';

export type TaskStatus = 'todo' | 'in-progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskRow {
  id: string;
  creatorId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
}

export const TaskSchema = new EntitySchema<TaskRow>({
  name: 'Task',
  tableName: 'tasks',
  columns: {
    id: { type: String, primary: true },
    creatorId: { type: String },
    title: { type: String },
    description: { type: String, nullable: true },
    status: { type: String, default: 'todo' },
    priority: { type: String, default: 'medium' },
    dueDate: { type: 'timestamptz', nullable: true },
  },
  indices: [{ columns: ['creatorId'] }],
});

export function publicTask(t: TaskRow): {
  id: string;
  creatorId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
} {
  return {
    id: t.id,
    creatorId: t.creatorId,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
  };
}
