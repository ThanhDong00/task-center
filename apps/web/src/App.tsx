import { useState } from "react";
import { AuthProvider, useAuth } from "./auth.tsx";
import { TasksView } from "./tasks.tsx";
import { GroupsRail } from "./groups.tsx";
import { SignalRail, useNotifications } from "./notifs.tsx";

function Login() {
  const { login, register, error } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <main className="mx-auto mt-16 max-w-sm rounded-2xl border border-line bg-slip p-8 shadow-sm">
      <h1 className="text-3xl font-bold tracking-tight">TaskCenter</h1>
      <p className="mt-2 text-sm leading-relaxed text-faint">
        Personal tasks, group work, and live updates in one desk.
      </p>
      <div className="mt-5 space-y-3">
        <input
          className="w-full rounded-lg border border-line bg-slip px-3.5 py-2.5 text-sm shadow-xs focus:border-signal focus:ring-2 focus:ring-signal/20 focus:outline-none"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-line bg-slip px-3.5 py-2.5 text-sm shadow-xs focus:border-signal focus:ring-2 focus:ring-signal/20 focus:outline-none"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void login(username, password);
          }}
        />
      </div>
      {error && <p className="mt-2 text-sm text-urgent">{error}</p>}
      <div className="mt-5 flex gap-2">
        <button
          className="flex-1 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-125 active:brightness-95"
          onClick={() => void login(username, password)}
        >
          Sign in
        </button>
        <button
          className="flex-1 rounded-lg border border-line bg-slip px-4 py-2.5 text-sm font-medium shadow-xs transition hover:bg-todowash"
          onClick={() => void register(username, password)}
        >
          Register
        </button>
      </div>
    </main>
  );
}

function Desk() {
  const { user, logout } = useAuth();
  const [groupId, setGroupId] = useState<string | null>(null);
  const { items, unread, lastNote, markRead } = useNotifications();

  return (
    <div className="mx-auto max-w-7xl px-6 pb-20">
      <header className="flex flex-wrap items-center justify-between gap-3 py-6">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
          TaskCenter
          {unread > 0 ? (
            <span
              className="rounded-full bg-signal px-2.5 py-0.5 align-middle text-xs font-semibold tabular-nums text-white shadow-sm"
              title={`${unread} unread signals`}
            >
              {unread}
            </span>
          ) : (
            <span className="rounded-full border border-line bg-slip px-2.5 py-0.5 align-middle text-xs font-medium tabular-nums text-faint">
              caught up
            </span>
          )}
        </h1>
        <p className="flex items-center gap-3 rounded-full border border-line bg-slip py-1.5 pr-2 pl-4 text-sm shadow-xs">
          <span className="font-medium">{user?.username}</span>
          <button
            className="rounded-full border border-line px-3 py-1 text-xs font-medium text-faint transition hover:bg-todowash hover:text-ink"
            onClick={logout}
          >
            Sign out
          </button>
        </p>
      </header>
      <div className="grid items-start gap-8 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside aria-label="Groups">
          <GroupsRail
            selected={groupId}
            onSelect={setGroupId}
            signal={lastNote}
          />
        </aside>
        <TasksView
          key={groupId ?? "personal"}
          groupId={groupId}
          signal={lastNote}
        />
        <aside aria-label="Notifications">
          <SignalRail items={items} unread={unread} markRead={markRead} />
        </aside>
      </div>
    </div>
  );
}

function Shell() {
  const { user, ready } = useAuth();
  if (!ready) return <p className="p-8 text-faint">Loading desk…</p>;
  return user ? <Desk /> : <Login />;
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
