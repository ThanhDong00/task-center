// Signal rail (issue #8): missed notifications load on start (GET), live
// ones arrive direct over Socket.io (ADR-0002). Read state clears the queue.
import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { NOTIF_URL, useAuth } from "./auth.tsx";
import { readJson } from "./api.ts";
import type { Notification } from "./api.ts";

export function useNotifications(): {
  items: Notification[];
  unread: number;
  markRead: (id: string) => void;
} {
  const { call, token } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);

  useEffect(() => {
    let sock: Socket | null = null;
    let live = true;
    (async () => {
      const r = await call("/notifications");
      if (r.ok && live) setItems((await readJson<Notification[]>(r)) ?? []);
      if (token && live) {
        sock = io(NOTIF_URL, { auth: { token } });
        sock.on("notification", (n: Notification) =>
          setItems((prev) =>
            prev.some((p) => p.id === n.id) ? prev : [n, ...prev],
          ),
        );
      }
    })();
    return () => {
      live = false;
      sock?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const markRead = async (id: string) => {
    const r = await call(`/notifications/${id}/read`, { method: "PATCH" });
    if (r.ok) {
      const updated = (await readJson<Notification>(r))!;
      setItems((prev) => prev.map((n) => (n.id === id ? updated : n)));
    }
  };

  return { items, unread: items.filter((n) => !n.read).length, markRead };
}

function describe(n: Notification): string {
  switch (n.type) {
    case "task.created":
      return "Task created";
    case "task.updated":
      return "Task updated";
    case "group.member.added":
      return "Someone joined your group";
    case "group.invitation.created":
      return "You were invited to a group";
    default:
      return n.type;
  }
}

export function SignalRail({
  items,
  unread,
  markRead,
}: {
  items: Notification[];
  unread: number;
  markRead: (id: string) => void;
}) {
  return (
    <div>
      <h3 className="font-semibold">
        Signals
        <span className="ml-2 text-sm font-normal tabular-nums text-faint">
          {unread} unread
        </span>
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-faint">
          Quiet for now. Task and group updates will land here.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((n) => (
            <li
              key={n.id}
              className={`rounded-lg border p-2 text-sm ${
                n.read
                  ? "border-line bg-slip opacity-70"
                  : "border-signal bg-slip"
              }`}
            >
              <p className="font-medium">{describe(n)}</p>
              <p className="text-xs text-faint">
                {new Date(n.createdAt).toLocaleString()}
              </p>
              {!n.read && (
                <button
                  className="mt-1 underline"
                  onClick={() => markRead(n.id)}
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
