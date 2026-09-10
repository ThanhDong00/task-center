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

// Shared auth primitives (spec #1, ticket #3): scrypt passwords + minimal HS256 JWT.
// Lives in contracts so gateway + auth-service agree by construction (drift breaks build).
// No new dependencies (node:crypto only).
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_SEC = 7 * 24 * 3600;

export interface JwtClaims {
  sub: string;
  username: string;
  type: 'access' | 'refresh';
  exp: number;
}

export function jwtSecret(): string {
  return process.env.JWT_SECRET ?? 'dev-secret-change-me';
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const probe = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return probe.length === expected.length && timingSafeEqual(probe, expected);
}

export function signJwt(
  claims: { sub: string; username: string; type: 'access' | 'refresh' },
  secret: string,
  ttlSec: number,
): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

// Shared RabbitMQ topology (issue #7): one topic exchange, routing key =
// event type. Pure constants here so gateway/auth stay dependency-free;
// services own their amqplib connect/publish/consume.
export const NOTIF_EXCHANGE = 'taskcenter';

export function rabbitUrl(): string {
  return process.env.RABBIT_URL ?? 'amqp://guest:guest@localhost:5672';
}

export function verifyJwt(token: string, secret: string): JwtClaims | null {
  const [header, body, sig] = token.split('.');
  if (!header || !body || !sig) return null;
  const want = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtClaims;
    if (claims.exp * 1000 < Date.now()) return null;
    if (claims.type !== 'access' && claims.type !== 'refresh') return null;
    return claims;
  } catch {
    return null;
  }
}
