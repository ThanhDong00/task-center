// Groups rail (issue #8): membership list, invitations, and the full
// owner/admin/member lifecycle the group-service exposes.
import { useEffect, useState } from "react";
import { useAuth } from "./auth.tsx";
import { readJson } from "./api.ts";
import type { Group, GroupMember, Invitation } from "./api.ts";

function Detail({ group, onChange }: { group: Group; onChange: () => void }) {
  const { call, user } = useAuth();
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [inviteId, setInviteId] = useState("");
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [banId, setBanId] = useState("");
  const [transferId, setTransferId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const privileged = group.role === "owner" || group.role === "admin";
  const owner = group.role === "owner";

  const load = async () => {
    const r = await call(`/groups/${group.id}/members`);
    if (r.ok) setMembers((await readJson<GroupMember[]>(r)) ?? []);
  };

  useEffect(() => {
    setName(group.name);
    setDescription(group.description ?? "");
    setMsg(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id]);

  const run = async (label: string, fn: () => Promise<Response>) => {
    setMsg(null);
    const r = await fn();
    if (r.ok) {
      onChange();
    } else {
      const b = (await readJson<{ error?: string }>(r)) ?? {};
      setMsg(`${label}: ${b.error ?? r.status}`);
    }
  };

  return (
    <div className="mt-3 space-y-4 border-t border-line pt-3">
      {msg && <p className="text-sm text-urgent">{msg}</p>}
      {privileged ? (
        <div className="flex flex-col gap-2">
          <input
            className="rounded border border-line bg-slip px-2 py-1 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="rounded border border-line bg-slip px-2 py-1 text-sm"
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button
            className="self-start rounded border border-line px-2 py-1 text-sm"
            onClick={() =>
              void run("Rename failed", () =>
                call(`/groups/${group.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ name, description: description || null }),
                }),
              )
            }
          >
            Save group info
          </button>
        </div>
      ) : (
        group.description && <p className="text-sm text-faint">{group.description}</p>
      )}
      <div>
        <h4 className="font-semibold">Members ({members.length})</h4>
        <ul className="mt-1 space-y-1 text-sm">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-2">
              <span>
                {m.userId === user?.id ? "you" : m.userId.slice(0, 8)} · {m.role}
              </span>
              {privileged && m.userId !== user?.id && m.role !== "owner" && (
                <button
                  className="underline text-faint"
                  onClick={() =>
                    void run("Remove failed", () =>
                      call(`/groups/${group.id}/members/${m.userId}`, {
                        method: "DELETE",
                      }).then((r) => {
                        void load();
                        return r;
                      }),
                    )
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {privileged && (
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded border border-line bg-slip px-2 py-1 text-sm"
            placeholder="User id to invite"
            value={inviteId}
            onChange={(e) => setInviteId(e.target.value)}
          />
          <button
            className="rounded border border-line px-2 py-1 text-sm"
            onClick={() =>
              void run("Invite failed", () =>
                call(`/groups/${group.id}/invites`, {
                  method: "POST",
                  body: JSON.stringify({ userId: inviteId.trim() }),
                }).then((r) => {
                  if (r.ok) setInviteId("");
                  return r;
                }),
              )
            }
          >
            Invite
          </button>
        </div>
      )}
      {owner && (
        <div className="space-y-2 text-sm">
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded border border-line bg-slip px-2 py-1"
              placeholder="User id to ban / unban"
              value={banId}
              onChange={(e) => setBanId(e.target.value)}
            />
            <button
              className="rounded border border-line px-2 py-1"
              onClick={() =>
                void run("Ban failed", () =>
                  call(`/groups/${group.id}/ban`, {
                    method: "POST",
                    body: JSON.stringify({ userId: banId.trim() }),
                  }).then((r) => {
                    void load();
                    return r;
                  }),
                )
              }
            >
              Ban
            </button>
            <button
              className="rounded border border-line px-2 py-1"
              onClick={() =>
                void run("Unban failed", () =>
                  call(`/groups/${group.id}/unban`, {
                    method: "POST",
                    body: JSON.stringify({ userId: banId.trim() }),
                  }),
                )
              }
            >
              Unban
            </button>
          </div>
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded border border-line bg-slip px-2 py-1"
              placeholder="User id for new owner"
              value={transferId}
              onChange={(e) => setTransferId(e.target.value)}
            />
            <button
              className="rounded border border-line px-2 py-1"
              onClick={() =>
                void run("Transfer failed", () =>
                  call(`/groups/${group.id}/transfer`, {
                    method: "POST",
                    body: JSON.stringify({ userId: transferId.trim() }),
                  }),
                )
              }
            >
              Transfer
            </button>
          </div>
          <button
            className="text-urgent underline"
            onClick={() => {
              if (confirm("Delete this group?")) {
                void run("Delete failed", () =>
                  call(`/groups/${group.id}`, { method: "DELETE" }),
                );
              }
            }}
          >
            Delete group
          </button>
        </div>
      )}
      {group.role !== "owner" && (
        <button
          className="text-sm underline text-faint"
          onClick={() =>
            void run("Leave failed", () =>
              call(`/groups/${group.id}/leave`, { method: "POST" }),
            )
          }
        >
          Leave group
        </button>
      )}
    </div>
  );
}

export function GroupsRail({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { call, user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [name, setName] = useState("");

  const load = async () => {
    const g = await call("/groups");
    if (g.ok) setGroups((await readJson<Group[]>(g)) ?? []);
    const iv = await call("/invitations");
    if (iv.ok) setInvites((await readJson<Invitation[]>(iv)) ?? []);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    const r = await call("/groups", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() }),
    });
    if (r.ok) {
      setName("");
      await load();
    }
  };

  const answer = async (id: string, accept: boolean) => {
    const r = await call(
      `/invitations/${id}/${accept ? "accept" : "decline"}`,
      { method: "POST" },
    );
    if (r.ok) void load();
  };

  const current = groups.find((g) => g.id === selected) ?? null;

  return (
    <div>
      <button
        className={`block w-full rounded-lg px-3 py-2 text-left ${
          selected === null ? "bg-ink text-white" : "hover:bg-slip"
        }`}
        onClick={() => onSelect(null)}
      >
        Personal desk
      </button>
      <h3 className="mt-4 font-semibold">
        Groups
        <span className="ml-2 text-sm font-normal tabular-nums text-faint">
          {groups.length}
        </span>
      </h3>
      <ul className="mt-1 space-y-1">
        {groups.map((g) => (
          <li key={g.id}>
            <button
              className={`block w-full rounded-lg px-3 py-2 text-left ${
                selected === g.id ? "bg-ink text-white" : "hover:bg-slip"
              }`}
              onClick={() => onSelect(g.id)}
            >
              {g.name}
              <span className="ml-2 text-sm opacity-70">{g.role}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-lg border border-line bg-slip px-2 py-1 text-sm"
          placeholder="New group"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        />
        <button
          className="rounded-lg border border-line px-2 py-1 text-sm"
          onClick={() => void create()}
        >
          Create
        </button>
      </div>
      {invites.length > 0 && (
        <div className="mt-4">
          <h3 className="font-semibold">
            Invitations
            <span className="ml-2 text-sm font-normal tabular-nums text-faint">
              {invites.length}
            </span>
          </h3>
          <ul className="mt-1 space-y-2">
            {invites.map((iv) => (
              <li key={iv.id} className="rounded-lg border border-line bg-slip p-2 text-sm">
                <p>Group {iv.groupId.slice(0, 8)}</p>
                <div className="mt-1 flex gap-2">
                  <button
                    className="rounded border border-line px-2 py-0.5"
                    onClick={() => void answer(iv.id, true)}
                  >
                    Accept
                  </button>
                  <button
                    className="rounded border border-line px-2 py-0.5 text-faint"
                    onClick={() => void answer(iv.id, false)}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {current && (
        <Detail
          key={current.id}
          group={current}
          onChange={() => {
            void load();
          }}
        />
      )}
      {user && (
        <p className="mt-4 break-all text-xs text-faint">Your user id: {user.id}</p>
      )}
    </div>
  );
}
