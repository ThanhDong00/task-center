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
  lastNote: Notification | null;
  markRead: (id: string) => void;
} {
  const { call, token } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [lastNote, setLastNote] = useState<Notification | null>(null);

  useEffect(() => {
    let sock: Socket | null = null;
    let live = true;
    (async () => {
      const r = await call("/notifications");
      if (r.ok && live) setItems((await readJson<Notification[]>(r)) ?? []);
      if (token && live) {
        sock = io(NOTIF_URL, { auth: { token } });
        sock.on("notification", (n: Notification) => {
          setLastNote(n); // other panes reload off this (no page refresh)
          setItems((prev) =>
            prev.some((p) => p.id === n.id) ? prev : [n, ...prev],
          );
        });
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

  return {
    items,
    unread: items.filter((n) => !n.read).length,
    lastNote,
    markRead,
  };
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

function icon(n: Notification): { glyph: string; cls: string } {
  switch (n.type) {
    case "task.created":
      return { glyph: "+", cls: "bg-done text-white" };
    case "task.updated":
      return { glyph: "~", cls: "bg-signal text-white" };
    case "group.member.added":
      return { glyph: "o", cls: "bg-doing text-white" };
    case "group.invitation.created":
      return { glyph: "v", cls: "bg-ink text-white" };
    default:
      return { glyph: "!", cls: "bg-faint text-white" };
  }
}

function ago(iso: string): string {
  const s = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000),
  );
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
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
    <div className="rounded-2xl border border-line bg-slip p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-base font-bold tracking-tight">
        Signals
        {unread > 0 ? (
          <span className="rounded-full bg-signal px-2 py-0.5 text-xs font-semibold tabular-nums text-white shadow-sm">
            {unread} unread
          </span>
        ) : (
          <span className="rounded-full border border-line bg-todowash px-2 py-0.5 text-xs font-semibold tabular-nums text-faint">
            all read
          </span>
        )}
      </h3>
      {items.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-line bg-todowash/50 p-4 text-center">
          <p className="text-sm font-semibold">Quiet for now</p>
          <p className="mt-0.5 text-[13px] font-light text-faint">
            Task and group updates will land here.
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((n) => {
            const ic = icon(n);
            return (
              <li
                key={n.id}
                title={new Date(n.createdAt).toLocaleString()}
                className={`flex gap-2.5 rounded-xl border p-3 text-sm transition hover:shadow-md ${
                  n.read
                    ? "border-line bg-slip opacity-70 hover:opacity-100"
                    : "border-l-4 border-signal border-y-line border-r-line border-t-line bg-signalwash/60 shadow-xs"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ic.cls}`}
                >
                  {ic.glyph}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={n.read ? "font-normal" : "font-semibold"}>
                    {describe(n)}
                  </p>
                  <p className="mt-0.5 text-xs font-light tabular-nums text-faint">
                    {ago(n.createdAt)}
                  </p>
                  {!n.read && (
                    <button
                      className="mt-1.5 rounded-md bg-slip px-2 py-0.5 text-[13px] font-medium text-signal shadow-xs ring-1 ring-signal/25 transition hover:bg-signal hover:text-white"
                      onClick={() => markRead(n.id)}
                    >
                      Mark read
                    </button>
                  )}
                </div>
                {!n.read && (
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-2 shrink-0 rounded-full bg-signal"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
