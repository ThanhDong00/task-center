// Strict shared event contracts (spec #1, ticket #2).
// Producers/consumers import this package; drift breaks the build here,
// not at runtime. Erasable syntax only, so plain node can import it too.
export const EVENT_TYPES = {
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  GROUP_MEMBER_ADDED: 'group.member.added',
  GROUP_INVITATION_CREATED: 'group.invitation.created',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export interface TaskEventPayload {
  taskId: string;
  creatorId: string;
  assigneeId: string | null;
  groupId: string | null;
}

export interface GroupMemberAddedPayload {
  groupId: string;
  userId: string;
}

export interface GroupInvitationCreatedPayload {
  groupId: string;
  invitedUserId: string;
}

export type EventPayload =
  | { type: 'task.created'; data: TaskEventPayload }
  | { type: 'task.updated'; data: TaskEventPayload }
  | { type: 'group.member.added'; data: GroupMemberAddedPayload }
  | { type: 'group.invitation.created'; data: GroupInvitationCreatedPayload };
