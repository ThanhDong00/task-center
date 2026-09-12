// Gateway REST client (issue #8). Erasable syntax only: plain node can
// import this for scripts/verify-web.mjs, so no React/socket imports here.
// Access token travels in memory; the refresh token rides the httpOnly
// cookie, so a 401 retries once after POST /auth/refresh.
export interface User {
  id: string;
  username: string;
  avatar: string | null;
}

export type TaskStatus = "todo" | "in-progress" | "done";
export type TaskPriority = "low" | "medium" | "high";

export interface Task {
  id: string;
  creatorId: string;
  groupId: string | null;
  assigneeId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
}

export interface TaskComment {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export type GroupRole = "owner" | "admin" | "member";

export interface Group {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  role: GroupRole;
}

export interface GroupMember {
  userId: string;
  role: GroupRole;
}

export type InvitationStatus = "pending" | "accepted" | "declined";

export interface Invitation {
  id: string;
  groupId: string;
  userId: string;
  createdBy: string;
  status: InvitationStatus;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  taskId: string | null;
  groupId: string | null;
  read: boolean;
  createdAt: string;
}

export async function apiFetch(
  base: string,
  getToken: () => string | null,
  setToken: (t: string) => void,
  path: string,
  init: RequestInit = {},
  doFetch: typeof fetch = fetch,
): Promise<Response> {
  const send = (token: string | null) =>
    doFetch(`${base}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...((init.headers as Record<string, string> | undefined) ?? {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  const first = await send(getToken());
  if (first.status !== 401) return first;
  try {
    const r = await doFetch(`${base}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!r.ok) return first;
    const body = (await r.json()) as { accessToken?: unknown };
    if (typeof body?.accessToken !== "string") return first;
    setToken(body.accessToken);
    return send(body.accessToken);
  } catch {
    return first;
  }
}

export async function readJson<T>(res: {
  json(): Promise<unknown>;
}): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
