// Owns Group, membership, Invitation (issue #5). EntitySchema (not decorators)
// so the file stays erasable and plain node can run it via type stripping.
import { EntitySchema } from 'typeorm';

export type GroupRole = 'owner' | 'admin' | 'member';

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
}

export interface MembershipRow {
  groupId: string;
  userId: string;
  role: GroupRole;
}

export type InvitationStatus = 'pending' | 'accepted' | 'declined';

export interface InvitationRow {
  id: string;
  groupId: string;
  userId: string;
  createdBy: string;
  status: InvitationStatus;
}

export interface BanRow {
  groupId: string;
  userId: string;
}

export const GroupSchema = new EntitySchema<GroupRow>({
  name: 'Group',
  tableName: 'groups',
  columns: {
    id: { type: String, primary: true },
    name: { type: String },
    description: { type: String, nullable: true },
    ownerId: { type: String },
  },
  indices: [{ columns: ['ownerId'] }],
});

export const MembershipSchema = new EntitySchema<MembershipRow>({
  name: 'Membership',
  tableName: 'memberships',
  columns: {
    groupId: { type: String, primary: true },
    userId: { type: String, primary: true },
    role: { type: String },
  },
  indices: [{ columns: ['userId'] }],
});

export const InvitationSchema = new EntitySchema<InvitationRow>({
  name: 'Invitation',
  tableName: 'invitations',
  columns: {
    id: { type: String, primary: true },
    groupId: { type: String },
    userId: { type: String },
    createdBy: { type: String },
    status: { type: String, default: 'pending' },
  },
  indices: [{ columns: ['userId', 'status'] }, { columns: ['groupId'] }],
});

export const BanSchema = new EntitySchema<BanRow>({
  name: 'Ban',
  tableName: 'group_bans',
  columns: {
    groupId: { type: String, primary: true },
    userId: { type: String, primary: true },
  },
});

export function publicGroup(g: GroupRow, role: GroupRole): {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  role: GroupRole;
} {
  return { id: g.id, name: g.name, description: g.description, ownerId: g.ownerId, role };
}

export function publicInvitation(i: InvitationRow): {
  id: string;
  groupId: string;
  userId: string;
  createdBy: string;
  status: InvitationStatus;
} {
  return { id: i.id, groupId: i.groupId, userId: i.userId, createdBy: i.createdBy, status: i.status };
}
