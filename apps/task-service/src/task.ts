// Owns Task + comments (issues #4 personal, #6 group). EntitySchema (not
// decorators) so the file stays erasable and plain node can run it via type
// stripping, no build step. Group tasks carry groupId + single assigneeId;
// personal tasks have groupId null. Comments belong to exactly one task.
import { EntitySchema } from 'typeorm';

export type TaskStatus = 'todo' | 'in-progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskRow {
  id: string;
  creatorId: string;
  groupId: string | null;
  assigneeId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
}

export interface CommentRow {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: Date;
}

export const TaskSchema = new EntitySchema<TaskRow>({
  name: 'Task',
  tableName: 'tasks',
  columns: {
    id: { type: String, primary: true },
    creatorId: { type: String },
    groupId: { type: String, nullable: true },
    assigneeId: { type: String, nullable: true },
    title: { type: String },
    description: { type: String, nullable: true },
    status: { type: String, default: 'todo' },
    priority: { type: String, default: 'medium' },
    dueDate: { type: 'timestamptz', nullable: true },
  },
  indices: [{ columns: ['creatorId'] }, { columns: ['groupId'] }],
});

export const CommentSchema = new EntitySchema<CommentRow>({
  name: 'TaskComment',
  tableName: 'task_comments',
  columns: {
    id: { type: String, primary: true },
    taskId: { type: String },
    authorId: { type: String },
    body: { type: String },
    createdAt: { type: 'timestamptz', createDate: true },
  },
  indices: [{ columns: ['taskId'] }],
});

export function publicTask(t: TaskRow): {
  id: string;
  creatorId: string;
  groupId: string | null;
  assigneeId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
} {
  return {
    id: t.id,
    creatorId: t.creatorId,
    groupId: t.groupId,
    assigneeId: t.assigneeId,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
  };
}

export function publicComment(c: CommentRow): {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
} {
  return {
    id: c.id,
    taskId: c.taskId,
    authorId: c.authorId,
    body: c.body,
    createdAt: new Date(c.createdAt).toISOString(),
  };
}
