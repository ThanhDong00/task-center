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
    <main className="mx-auto mt-16 max-w-sm rounded-xl border border-line bg-slip p-6">
      <h1 className="text-2xl font-bold tracking-tight">TaskCenter</h1>
      <p className="mt-1 text-sm text-faint">
        Personal tasks, group work, and live updates in one desk.
      </p>
      <div className="mt-4 space-y-2">
        <input
          className="w-full rounded-lg border border-line px-3 py-2"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-line px-3 py-2"
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
      <div className="mt-4 flex gap-2">
        <button
          className="flex-1 rounded-lg bg-ink px-4 py-2 text-white"
          onClick={() => void login(username, password)}
        >
          Sign in
        </button>
        <button
          className="flex-1 rounded-lg border border-line px-4 py-2"
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
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <h1 className="text-xl font-bold tracking-tight">
          TaskCenter
          {unread > 0 && (
            <span className="ml-2 rounded-full bg-signal px-2 py-0.5 align-middle text-xs font-normal tabular-nums text-white">
              {unread}
            </span>
          )}
        </h1>
        <p className="text-sm text-faint">
          {user?.username}{" "}
          <button className="ml-2 underline" onClick={logout}>
            Sign out
          </button>
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
        <aside aria-label="Groups">
          <GroupsRail selected={groupId} onSelect={setGroupId} signal={lastNote} />
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
