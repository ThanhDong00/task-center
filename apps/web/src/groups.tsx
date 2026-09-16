// Groups rail (issue #8): membership list, invitations, and the full
// owner/admin/member lifecycle the group-service exposes.
import { useEffect, useState } from "react";
import { useAuth } from "./auth.tsx";
import { readJson } from "./api.ts";
import type { Group, GroupMember, Invitation, Notification } from "./api.ts";

function Detail({
  group,
  signal,
  onChange,
  onGone,
}: {
  group: Group;
  signal: Notification | null;
  onChange: () => void;
  onGone: () => void;
}) {
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

  // Someone joined this group: refresh the member list live.
  const signalId = signal?.id;
  useEffect(() => {
    if (signal?.type === "group.member.added" && signal.groupId === group.id)
      void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalId]);

  // Leave/delete dissolve my membership: onGone sends me back to the
  // Personal desk instead of stranding me on a 404 board.
  const run = async (
    label: string,
    fn: () => Promise<Response>,
    andGo = false,
  ) => {
    setMsg(null);
    const r = await fn();
    if (r.ok) {
      if (andGo) onGone();
      else onChange();
    } else {
      const b = (await readJson<{ error?: string }>(r)) ?? {};
      setMsg(`${label}: ${b.error ?? r.status}`);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-slip p-4 shadow-sm">
      {msg && (
        <p className="rounded-lg bg-urgentwash px-3 py-2 text-[13px] font-medium text-urgent">
          {msg}
        </p>
      )}
      {privileged ? (
        <div className="flex flex-col gap-2 rounded-xl bg-todowash/60 p-3">
          <label className="text-xs font-semibold text-faint">Group name</label>
          <input
            className="rounded-lg border border-line bg-slip px-3 py-2 text-sm focus:border-signal focus:ring-2 focus:ring-signal/20 focus:outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="mt-1 text-xs font-semibold text-faint">
            Description
          </label>
          <input
            className="rounded-lg border border-line bg-slip px-3 py-2 text-sm focus:border-signal focus:ring-2 focus:ring-signal/20 focus:outline-none"
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button
            className="mt-1 self-start rounded-lg border border-line bg-slip px-3 py-1.5 text-[13px] font-semibold shadow-xs transition hover:bg-todowash"
            onClick={() =>
              void run("Rename failed", () =>
                call(`/groups/${group.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    name,
                    description: description || null,
                  }),
                }),
              )
            }
          >
            Save group info
          </button>
        </div>
      ) : (
        group.description && (
          <p className="text-sm text-faint">{group.description}</p>
        )
      )}
      <div className="rounded-xl border border-line/80 p-3">
        <h4 className="text-sm font-bold tracking-tight">
          Members ({members.length})
        </h4>
        <ul className="mt-2 space-y-1.5 text-sm">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center justify-between gap-2 rounded-lg bg-todowash/60 px-2.5 py-1.5"
            >
              <span className="font-medium">
                {m.userId === user?.id ? "you" : m.userId.slice(0, 8)}{" "}
                <span className="ml-1 rounded-full border border-line bg-slip px-1.5 py-0.5 text-[11px] font-semibold text-faint">
                  {m.role}
                </span>
              </span>
              {privileged && m.userId !== user?.id && m.role !== "owner" && (
                <button
                  className="rounded-md px-1.5 py-0.5 text-[13px] font-medium text-faint transition hover:bg-urgentwash hover:text-urgent"
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
        <div className="flex gap-2 border-t border-line pt-4">
          <input
            className="min-w-0 flex-1 rounded-lg border border-line bg-slip px-3 py-2 text-sm focus:border-signal focus:ring-2 focus:ring-signal/20 focus:outline-none"
            placeholder="User id to invite"
            value={inviteId}
            onChange={(e) => setInviteId(e.target.value)}
          />
          <button
            className="rounded-lg bg-ink px-3 py-2 text-[13px] font-semibold text-white shadow-xs transition hover:brightness-125"
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
        <div className="space-y-2.5 rounded-xl border border-urgent/25 bg-urgentwash/50 p-3 text-sm">
          <p className="text-xs font-bold tracking-tight text-urgent">
            Danger zone
          </p>
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-urgent/25 bg-slip px-3 py-2 focus:border-urgent focus:ring-2 focus:ring-urgent/15 focus:outline-none"
              placeholder="User id to ban / unban"
              value={banId}
              onChange={(e) => setBanId(e.target.value)}
            />
            <button
              className="rounded-lg bg-urgent px-3 py-2 font-semibold text-white shadow-xs transition hover:brightness-110"
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
              className="rounded-lg border border-urgent/30 bg-slip px-3 py-2 font-medium text-urgent transition hover:bg-urgentwash"
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
              className="min-w-0 flex-1 rounded-lg border border-urgent/25 bg-slip px-3 py-2 focus:border-urgent focus:ring-2 focus:ring-urgent/15 focus:outline-none"
              placeholder="User id for new owner"
              value={transferId}
              onChange={(e) => setTransferId(e.target.value)}
            />
            <button
              className="rounded-lg border border-urgent/30 bg-slip px-3 py-2 font-medium text-urgent transition hover:bg-urgentwash"
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
            className="w-full rounded-lg border border-urgent bg-slip px-3 py-2 font-semibold text-urgent shadow-xs transition hover:bg-urgent hover:text-white"
            onClick={() => {
              if (confirm("Delete this group?")) {
                void run(
                  "Delete failed",
                  () => call(`/groups/${group.id}`, { method: "DELETE" }),
                  true,
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
          className="rounded-lg px-2 py-1 text-sm font-medium text-faint transition hover:bg-todowash hover:text-ink"
          onClick={() =>
            void run(
              "Leave failed",
              () => call(`/groups/${group.id}/leave`, { method: "POST" }),
              true,
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
  signal,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
  signal: Notification | null;
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

  // Live refresh: a new invitation (or join in one of my groups) reloads
  // the rail instead of asking for F5.
  const signalId = signal?.id;
  useEffect(() => {
    if (!signal) return;
    if (
      signal.type === "group.invitation.created" ||
      signal.type === "group.member.added"
    )
      void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalId]);

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
    <div className="space-y-5">
      <div className="rounded-2xl border border-line bg-slip p-3 shadow-sm">
        <button
          className={`block w-full rounded-xl px-3.5 py-2.5 text-left text-[15px] font-bold tracking-tight transition ${
            selected === null
              ? "bg-ink text-white shadow-sm"
              : "hover:bg-todowash"
          }`}
          onClick={() => onSelect(null)}
        >
          Personal desk
        </button>
      </div>
      <div className="rounded-2xl border border-line bg-slip p-4 shadow-sm">
        <h3 className="text-base font-bold tracking-tight">
          Groups
          <span className="ml-2 rounded-full border border-line bg-todowash px-2 py-0.5 text-xs font-semibold tabular-nums text-faint">
            {groups.length}
          </span>
        </h3>
        <ul className="mt-2.5 space-y-1.5">
          {groups.map((g) => (
            <li key={g.id}>
              <button
                className={`block w-full rounded-xl px-3 py-2.5 text-left text-sm transition ${
                  selected === g.id
                    ? "bg-ink font-semibold text-white shadow-sm"
                    : "hover:bg-todowash"
                }`}
                onClick={() => onSelect(g.id)}
              >
                {g.name}
                <span
                  className={`ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${selected === g.id ? "bg-white/20" : "bg-todowash text-faint"}`}
                >
                  {g.role}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2 border-t border-line/70 pt-3">
          <input
            className="min-w-0 flex-1 rounded-lg border border-line bg-slip px-3 py-2 text-sm focus:border-signal focus:ring-2 focus:ring-signal/20 focus:outline-none"
            placeholder="New group"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
          />
          <button
            className="rounded-lg border border-line bg-slip px-3 py-2 text-sm font-semibold shadow-xs transition hover:bg-todowash"
            onClick={() => void create()}
          >
            Create
          </button>
        </div>
      </div>
      {invites.length > 0 && (
        <div className="rounded-2xl border border-signal/25 bg-signalwash p-4 shadow-sm">
          <h3 className="text-base font-bold tracking-tight text-signal">
            Invitations
            <span className="ml-2 rounded-full bg-signal px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
              {invites.length}
            </span>
          </h3>
          <ul className="mt-2.5 space-y-2">
            {invites.map((iv) => (
              <li
                key={iv.id}
                className="rounded-xl border border-signal/20 bg-slip p-3 text-sm shadow-xs"
              >
                <p className="font-medium">Group {iv.groupId.slice(0, 8)}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    className="rounded-lg bg-signal px-3 py-1 text-[13px] font-semibold text-white shadow-xs transition hover:brightness-110"
                    onClick={() => void answer(iv.id, true)}
                  >
                    Accept
                  </button>
                  <button
                    className="rounded-lg border border-line bg-slip px-3 py-1 text-[13px] font-medium text-faint transition hover:bg-todowash hover:text-ink"
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
          signal={signal}
          onChange={() => {
            void load();
          }}
          onGone={() => {
            onSelect(null);
            void load();
          }}
        />
      )}
      {user && (
        <p className="rounded-xl bg-todowash/70 px-3 py-2 break-all text-xs font-light text-faint">
          Your user id: {user.id}
        </p>
      )}
    </div>
  );
}
