// Workboard (issue #8): personal tasks or one group's tasks in three
// status lanes. View-open for members, edit-narrow enforced server-side.
import { useEffect, useState } from "react";
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

const LANES: { id: TaskStatus; label: string; edge: string }[] = [
  { id: "todo", label: "To do", edge: "border-t-line" },
  { id: "in-progress", label: "Doing", edge: "border-t-doing" },
  { id: "done", label: "Done", edge: "border-t-done" },
];

const NEXT: Record<TaskStatus, TaskStatus | null> = {
  todo: "in-progress",
  "in-progress": "done",
  done: null,
};

function priorityStyle(p: TaskPriority): string {
  return p === "high"
    ? "text-urgent"
    : p === "medium"
      ? "text-doing"
      : "text-faint";
}

function Comments({ taskId }: { taskId: string }) {
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
    <div className="mt-2">
      <button
        className="text-sm text-faint underline"
        onClick={() => {
          setOpen(!open);
          if (!open) void load();
        }}
      >
        {open ? "Hide notes" : `Notes${items.length ? ` (${items.length})` : ""}`}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {items.map((c) => (
            <p key={c.id} className="text-sm">
              {c.body}
            </p>
          ))}
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded border border-line bg-slip px-2 py-1 text-sm"
              placeholder="Add a note"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              className="rounded border border-line px-2 py-1 text-sm"
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
  const edge = LANES.find((l) => l.id === task.status)?.edge ?? "border-t-line";

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
    <article className={`rounded-lg border border-line bg-slip border-t-4 ${edge} p-3`}>
      <h4 className="font-semibold">{task.title}</h4>
      {task.description && (
        <p className="mt-1 text-sm text-faint">{task.description}</p>
      )}
      <p className="mt-2 flex gap-3 text-sm">
        <span className={priorityStyle(task.priority)}>{task.priority}</span>
        {task.dueDate && <span>due {task.dueDate.slice(0, 10)}</span>}
        {task.assigneeId && (
          <span>
            {task.assigneeId === user?.id
              ? "you"
              : members.find((m) => m.userId === task.assigneeId)
                ? `member ${task.assigneeId.slice(0, 6)}`
                : "assigned"}
          </span>
        )}
      </p>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        {NEXT[task.status] && (
          <button
            className="rounded border border-line px-2 py-0.5"
            onClick={() => void patch({ status: NEXT[task.status] })}
          >
            Move to {LANES.find((l) => l.id === NEXT[task.status])?.label}
          </button>
        )}
        <button
          className="rounded border border-line px-2 py-0.5"
          onClick={() => setEditing(!editing)}
        >
          {editing ? "Close" : "Edit"}
        </button>
        {!groupId && (
          <button
            className="rounded border border-line px-2 py-0.5 text-urgent"
            onClick={() => void remove()}
          >
            Delete
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-2 space-y-2">
          <input
            className="w-full rounded border border-line px-2 py-1 text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="w-full rounded border border-line px-2 py-1 text-sm"
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex gap-2">
            <select
              className="rounded border border-line px-1 py-1 text-sm"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
            <input
              type="date"
              className="rounded border border-line px-1 py-1 text-sm"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          {groupId && (
            <select
              className="w-full rounded border border-line px-1 py-1 text-sm"
              value={assigneeId}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.userId === user?.id ? `you (${m.role})` : `${m.userId.slice(0, 8)} (${m.role})`}
                </option>
              ))}
            </select>
          )}
          <button
            className="rounded bg-ink px-3 py-1 text-sm text-white"
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
      <Comments taskId={task.id} />
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
      <div className="rounded-lg border border-line bg-slip p-4">
        <p>Could not load these tasks.</p>
        <button className="mt-2 underline" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );

  return (
    <section aria-label={groupId ? "Group tasks" : "Personal tasks"}>
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-lg border border-line bg-slip px-3 py-2"
          placeholder={groupId ? "New group task" : "New personal task"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        />
        <button
          className="rounded-lg bg-ink px-4 py-2 text-white"
          onClick={() => void create()}
        >
          Add
        </button>
      </div>
      {tasks.length === 0 ? (
        <p className="mt-6 text-faint">
          Nothing here yet. Add the first task above.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {LANES.map((lane) => (
            <div key={lane.id}>
              <h3 className="flex items-baseline gap-2 font-semibold">
                {lane.label}
                <span className="text-sm font-normal tabular-nums text-faint">
                  {tasks.filter((t) => t.status === lane.id).length}
                </span>
              </h3>
              <div className="mt-2 space-y-3">
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
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
