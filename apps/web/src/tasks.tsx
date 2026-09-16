// Workboard (issue #8): personal tasks or one group's tasks in three
// status lanes. View-open for members, edit-narrow enforced server-side.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "./auth.tsx";
import { readJson } from "./api.ts";
import type {
  GroupMember,
  Notification,
  Task,
  TaskComment,
  TaskPriority,
  TaskStatus,
} from "./api.ts";

const LANES: {
  id: TaskStatus;
  label: string;
  edge: string;
  wash: string;
  dot: string;
  count: string;
}[] = [
  {
    id: "todo",
    label: "To do",
    edge: "border-l-todo",
    wash: "bg-todowash/60 border-line",
    dot: "bg-todo",
    count: "bg-slip text-faint border-line",
  },
  {
    id: "in-progress",
    label: "Doing",
    edge: "border-l-doing",
    wash: "bg-doingwash/60 border-doing/25",
    dot: "bg-doing",
    count: "bg-doing/10 text-doing border-doing/20",
  },
  {
    id: "done",
    label: "Done",
    edge: "border-l-done",
    wash: "bg-donewash/60 border-done/25",
    dot: "bg-done",
    count: "bg-done/10 text-done border-done/20",
  },
];

const NEXT: Record<TaskStatus, TaskStatus | null> = {
  todo: "in-progress",
  "in-progress": "done",
  done: null,
};

function priorityStyle(p: TaskPriority): string {
  const base =
    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold";
  return p === "high"
    ? `${base} border-urgent/25 bg-urgentwash text-urgent`
    : p === "medium"
      ? `${base} border-ink/30 bg-ink/10 text-ink`
      : `${base} border-line bg-todowash text-faint`;
}

function Comments({
  taskId,
  leading,
  trailing,
}: {
  taskId: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const { call } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TaskComment[]>([]);
  const [draft, setDraft] = useState("");

  const load = async () => {
    const r = await call(`/tasks/${taskId}/comments`);
    if (r.ok) setItems((await readJson<TaskComment[]>(r)) ?? []);
  };

  const post = async () => {
    if (!draft.trim()) return;
    const r = await call(`/tasks/${taskId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: draft.trim() }),
    });
    if (r.ok) {
      setDraft("");
      void load();
    }
  };

  return (
    <div className="mt-3 border-t border-line/70 pt-1.5">
      <div className="flex items-center gap-1">
        {leading}
        <button
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[13px] font-medium text-faint transition hover:bg-todowash hover:text-ink"
          title="Toggle notes"
          onClick={() => {
            setOpen(!open);
            if (!open) void load();
          }}
        >
          <span aria-hidden="true">{open ? "\u25BE" : "\u25B8"}</span>
          {open
            ? "Hide notes"
            : `Notes${items.length ? ` (${items.length})` : ""}`}
        </button>
        {trailing && (
          <span className="ml-auto flex items-center gap-1">{trailing}</span>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          {items.map((c) => (
            <p
              key={c.id}
              className="rounded-lg bg-todowash px-2.5 py-1.5 text-[13px] leading-relaxed"
            >
              {c.body}
            </p>
          ))}
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-line bg-slip px-2.5 py-1.5 text-[13px] focus:border-signal focus:ring-2 focus:ring-signal/20 focus:outline-none"
              placeholder="Add a note"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              className="rounded-lg border border-line bg-slip px-2.5 py-1.5 text-[13px] font-medium shadow-xs transition hover:bg-todowash"
              onClick={() => void post()}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Slip({
  task,
  members,
  groupId,
  onChange,
}: {
  task: Task;
  members: GroupMember[];
  groupId: string | null;
  onChange: () => void;
}) {
  const { call, user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate?.slice(0, 10) ?? "");
  const [assigneeId, setAssignee] = useState(task.assigneeId ?? "");
  const edge = LANES.find((l) => l.id === task.status)?.edge ?? "border-l-todo";

  const patch = async (body: object) => {
    const r = await call(`/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (r.ok) {
      setEditing(false);
      onChange();
    }
  };

  const remove = async () => {
    if (!confirm("Delete this task?")) return;
    const r = await call(`/tasks/${task.id}`, { method: "DELETE" });
    if (r.ok) onChange();
  };

  return (
    <article
      className={`rounded-xl border border-line bg-slip border-l-4 ${edge} p-4 shadow-sm transition hover:shadow-md`}
    >
      <div className="flex items-center gap-1">
        <h4 className="min-w-0 flex-1 text-[15px] leading-snug font-semibold">
          {task.title}
        </h4>
        <button
          className="-mr-1 shrink-0 rounded-lg p-1.5 text-faint transition hover:bg-todowash hover:text-ink"
          title={editing ? "Close editor" : "Edit task"}
          aria-label={editing ? "Close editor" : "Edit task"}
          onClick={() => setEditing(!editing)}
        >
          <span aria-hidden="true">&#9998;</span>
        </button>
      </div>
      {task.description && (
        <p className="mt-1.5 text-[13px] leading-relaxed text-faint">
          {task.description}
        </p>
      )}
      <p className="mt-2.5 flex flex-wrap items-center gap-2 text-xs font-light text-faint">
        <span className={priorityStyle(task.priority)}>{task.priority}</span>
        {task.dueDate && (
          <span className="tabular-nums">due {task.dueDate.slice(0, 10)}</span>
        )}
        {task.assigneeId && (
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block size-1.5 rounded-full bg-faint"
            />
            {task.assigneeId === user?.id
              ? "you"
              : members.find((m) => m.userId === task.assigneeId)
                ? `member ${task.assigneeId.slice(0, 6)}`
                : "assigned"}
          </span>
        )}
      </p>
      {editing && (
        <div className="mt-3 space-y-2 rounded-lg bg-todowash/70 p-3">
          <input
            className="w-full rounded-lg border border-line bg-slip px-2.5 py-1.5 text-sm focus:border-signal focus:ring-2 focus:ring-signal/20 focus:outline-none"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-line bg-slip px-2.5 py-1.5 text-sm focus:border-signal focus:ring-2 focus:ring-signal/20 focus:outline-none"
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex gap-2">
            <select
              className="rounded-lg border border-line bg-slip px-2 py-1.5 text-sm focus:border-signal focus:outline-none"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
            <input
              type="date"
              className="rounded-lg border border-line bg-slip px-2 py-1.5 text-sm focus:border-signal focus:outline-none"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          {groupId && (
            <select
              className="w-full rounded-lg border border-line bg-slip px-2 py-1.5 text-sm focus:border-signal focus:outline-none"
              value={assigneeId}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.userId === user?.id
                    ? `you (${m.role})`
                    : `${m.userId.slice(0, 8)} (${m.role})`}
                </option>
              ))}
            </select>
          )}
          <button
            className="rounded-lg bg-ink px-3 py-1.5 text-[13px] font-semibold text-white shadow-xs transition hover:brightness-125"
            onClick={() =>
              void patch({
                title,
                description: description || null,
                priority,
                dueDate: dueDate || null,
                ...(groupId ? { assigneeId: assigneeId || null } : {}),
              })
            }
          >
            Save changes
          </button>
        </div>
      )}
      <Comments
        taskId={task.id}
        leading={
          NEXT[task.status] ? (
            <button
              className="rounded-lg border border-line bg-slip px-2.5 py-1 text-xs font-medium text-ink shadow-xs transition hover:border-ink/40 hover:bg-todowash"
              onClick={() => void patch({ status: NEXT[task.status] })}
            >
              Move to {LANES.find((l) => l.id === NEXT[task.status])?.label}
            </button>
          ) : undefined
        }
        trailing={
          !groupId ? (
            <button
              className="rounded-lg p-1.5 text-faint transition hover:bg-urgentwash hover:text-urgent"
              title="Delete task"
              aria-label="Delete task"
              onClick={() => void remove()}
            >
              <span aria-hidden="true">&#9003;</span>
            </button>
          ) : undefined
        }
      />
    </article>
  );
}

export function TasksView({
  groupId,
  signal,
}: {
  groupId: string | null;
  signal: Notification | null;
}) {
  const { call } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [title, setTitle] = useState("");
  const [failed, setFailed] = useState(false);

  const load = async () => {
    const path = groupId ? `/tasks?groupId=${groupId}` : "/tasks";
    const r = await call(path);
    if (r.ok) {
      setTasks((await readJson<Task[]>(r)) ?? []);
      setFailed(false);
    } else {
      setFailed(true);
    }
    if (groupId) {
      const m = await call(`/groups/${groupId}/members`);
      if (m.ok) setMembers((await readJson<GroupMember[]>(m)) ?? []);
    } else {
      setMembers([]);
    }
  };

  useEffect(() => {
    setTasks([]);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Live refresh: task created/updated (incl. reassignment) and member
  // changes land over WS; the board reloads instead of asking for F5.
  const signalId = signal?.id;
  useEffect(() => {
    if (!signal) return;
    if (
      signal.type === "task.created" ||
      signal.type === "task.updated" ||
      signal.type === "group.member.added"
    )
      void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalId]);

  // Poll fallback: task events notify creator + assignee only (spec), so a
  // teammate's new task emits nothing for me. Refresh on a timer instead.
  // ponytail: 10s poll; per-group WS room if this ever feels laggy.
  useEffect(() => {
    const t = setInterval(() => void load(), 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const create = async () => {
    if (!title.trim()) return;
    const r = await call("/tasks", {
      method: "POST",
      body: JSON.stringify(
        groupId ? { title: title.trim(), groupId } : { title: title.trim() },
      ),
    });
    if (r.ok) {
      setTitle("");
      void load();
    }
  };

  if (failed)
    return (
      <div className="rounded-2xl border border-urgent/25 bg-urgentwash p-5 shadow-sm">
        <p className="font-semibold text-urgent">Could not load these tasks.</p>
        <button
          className="mt-3 rounded-lg bg-urgent px-3 py-1.5 text-sm font-semibold text-white shadow-xs transition hover:brightness-110"
          onClick={() => void load()}
        >
          Try again
        </button>
      </div>
    );

  return (
    <section aria-label={groupId ? "Group tasks" : "Personal tasks"}>
      <div className="flex gap-2 rounded-2xl border border-line bg-slip p-3 shadow-sm">
        <input
          className="min-w-0 flex-1 rounded-lg border border-line bg-slip px-3.5 py-2.5 text-sm focus:border-signal focus:ring-2 focus:ring-signal/20 focus:outline-none"
          placeholder={groupId ? "New group task" : "New personal task"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        />
        <button
          className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-125 active:brightness-95"
          onClick={() => void create()}
        >
          Add
        </button>
      </div>
      {tasks.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-line bg-slip/60 p-8 text-center shadow-xs">
          <p className="font-semibold">Nothing here yet</p>
          <p className="mt-1 text-sm font-light text-faint">
            Add the first task above to get started.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid items-stretch gap-5 md:grid-cols-3">
          {LANES.map((lane) => (
            <div
              key={lane.id}
              className={`rounded-2xl border p-3 shadow-xs ${lane.wash}`}
            >
              <h3 className="flex items-center gap-2 px-1 text-[15px] font-bold tracking-tight">
                <span
                  aria-hidden="true"
                  className={`inline-block size-2.5 rounded-full ${lane.dot}`}
                />
                {lane.label}
                <span
                  className={`ml-auto rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${lane.count}`}
                >
                  {tasks.filter((t) => t.status === lane.id).length}
                </span>
              </h3>
              <div className="mt-3 space-y-3">
                {tasks
                  .filter((t) => t.status === lane.id)
                  .map((t) => (
                    <Slip
                      key={t.id}
                      task={t}
                      members={members}
                      groupId={groupId}
                      onChange={() => void load()}
                    />
                  ))}
                {tasks.filter((t) => t.status === lane.id).length === 0 && (
                  <p className="rounded-xl border border-dashed border-line bg-slip/70 px-3 py-4 text-center text-xs font-light text-faint">
                    No tasks
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
