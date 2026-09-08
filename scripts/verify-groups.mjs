// Issue #5: Groups + membership end-to-end via gateway (spec #1).
// External behavior only: HTTP status + payload shape through gateway REST,
// plus the internal membership check task-service will use (ADR-0001).
// Run: pnpm stack:up (postgres), start auth-service (:3001) + group-service
// (:3003) + gateway (:3000), then `node scripts/verify-groups.mjs`.
import assert from 'node:assert/strict';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const GROUP_DIRECT = process.env.GROUP_URL ?? 'http://localhost:3003';
const stamp = Date.now().toString(36);
const uOwner = `grp_owner_${stamp}`;
const uAdmin = `grp_admin_${stamp}`;
const uMember = `grp_member_${stamp}`;
const uOut = `grp_out_${stamp}`;
let failures = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}: ${e.message}`);
  }
};
const json = async (res) => {
  const t = await res.text();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};
const register = (username) =>
  fetch(`${GATEWAY}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret123' }),
  });
const login = async (username) => {
  const res = await fetch(`${GATEWAY}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret123' }),
  });
  assert.equal(res.status, 200, `login want 200 got ${res.status}`);
  const b = await json(res);
  return { token: b.accessToken, id: b.user.id };
};
const api = (token, path, opts = {}) =>
  fetch(`${GATEWAY}${path}`, {
    ...opts,
    headers: {
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

await register(uOwner);
await register(uAdmin);
await register(uMember);
await register(uOut);
const owner = await login(uOwner);
const admin = await login(uAdmin);
const member = await login(uMember);
const out = await login(uOut);
let groupId = '';
let inviteId = '';

await step('gateway rejects /api/groups without token -> 401', async () => {
  const res = await api(null, '/api/groups');
  assert.equal(res.status, 401, `want 401 got ${res.status}`);
  await res.text().catch(() => {});
});

await step('create group (creator becomes Owner)', async () => {
  const res = await api(owner.token, '/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name: 'team-a', description: 'the a team' }),
  });
  assert.equal(res.status, 201, `want 201 got ${res.status}: ${(await res.clone().text()).slice(0, 200)}`);
  const g = await json(res);
  assert.ok(g.id, 'missing id');
  assert.equal(g.name, 'team-a');
  assert.equal(g.ownerId, owner.id);
  assert.equal(g.role, 'owner');
  groupId = g.id;
});

await step('create validates name', async () => {
  for (const payload of [{}, { name: '  ' }, { name: 'x'.repeat(101) }]) {
    const res = await api(owner.token, '/api/groups', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 400, `payload ${JSON.stringify(payload).slice(0, 30)} want 400 got ${res.status}`);
    await res.text().catch(() => {});
  }
});

await step('list my groups; outsider sees none; non-member gets 404', async () => {
  const list = await api(owner.token, '/api/groups');
  assert.equal(list.status, 200, `list want 200 got ${list.status}`);
  const items = await json(list);
  assert.ok(items.some((g) => g.id === groupId), 'created group missing');
  assert.deepEqual(await json(await api(out.token, '/api/groups')), [], 'outsider list should be empty');
  const one = await api(out.token, `/api/groups/${groupId}`);
  assert.equal(one.status, 404, `non-member get want 404 got ${one.status}`);
  await one.text().catch(() => {});
});

await step('owner invites admin-user + member-user; duplicate -> 409', async () => {
  for (const u of [admin, member]) {
    const res = await api(owner.token, `/api/groups/${groupId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ userId: u.id }),
    });
    assert.equal(res.status, 201, `invite want 201 got ${res.status}`);
    const inv = await json(res);
    assert.equal(inv.status, 'pending');
    if (u === member) inviteId = inv.id;
  }
  const dup = await api(owner.token, `/api/groups/${groupId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ userId: member.id }),
  });
  assert.equal(dup.status, 409, `duplicate invite want 409 got ${dup.status}`);
  await dup.text().catch(() => {});
});

await step('non-privileged member cannot invite -> 403', async () => {
  const res = await api(out.token, `/api/groups/${groupId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ userId: out.id }),
  });
  assert.ok([403, 404].includes(res.status), `want 403/404 got ${res.status}`);
  await res.text().catch(() => {});
});

await step('invited users see invites; accept joins as member', async () => {
  const mine = await api(member.token, '/api/invitations');
  assert.equal(mine.status, 200, `mine want 200 got ${mine.status}`);
  assert.ok((await json(mine)).some((i) => i.id === inviteId), 'invite missing');
  const res = await api(member.token, `/api/invitations/${inviteId}/accept`, { method: 'POST' });
  assert.equal(res.status, 200, `accept want 200 got ${res.status}`);
  const list = await json(await api(member.token, '/api/groups'));
  assert.ok(list.some((g) => g.id === groupId && g.role === 'member'), 'member not in group');
});

await step('other user cannot accept my invite; decline works', async () => {
  const pending = (await json(await api(admin.token, '/api/invitations')))[0];
  const hijack = await api(member.token, `/api/invitations/${pending.id}/accept`, { method: 'POST' });
  assert.equal(hijack.status, 403, `hijack accept want 403 got ${hijack.status}`);
  await hijack.text().catch(() => {});
  const res = await api(admin.token, `/api/invitations/${pending.id}/decline`, { method: 'POST' });
  assert.equal(res.status, 200, `decline want 200 got ${res.status}`);
  assert.equal((await json(res)).status, 'declined');
});

await step('member edits group -> 403; owner edits -> 200', async () => {
  const bad = await api(member.token, `/api/groups/${groupId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'hijack' }),
  });
  assert.equal(bad.status, 403, `member edit want 403 got ${bad.status}`);
  await bad.text().catch(() => {});
  const res = await api(owner.token, `/api/groups/${groupId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'team-a2' }),
  });
  assert.equal(res.status, 200, `owner edit want 200 got ${res.status}`);
  assert.equal((await json(res)).name, 'team-a2');
});

await step('member leaves anytime; owner cannot leave before transfer', async () => {
  const res = await api(member.token, `/api/groups/${groupId}/leave`, { method: 'POST' });
  assert.equal(res.status, 204, `leave want 204 got ${res.status}`);
  await res.text().catch(() => {});
  assert.deepEqual(await json(await api(member.token, '/api/groups')), [], 'leaver still listed');
  const stuck = await api(owner.token, `/api/groups/${groupId}/leave`, { method: 'POST' });
  assert.equal(stuck.status, 400, `owner leave want 400 got ${stuck.status}`);
  await stuck.text().catch(() => {});
});

await step('owner re-invites + removes member; never the owner', async () => {
  const inv = await api(owner.token, `/api/groups/${groupId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ userId: member.id }),
  });
  assert.equal(inv.status, 201, `re-invite want 201 got ${inv.status}`);
  const invId = (await json(inv)).id;
  const acc = await api(member.token, `/api/invitations/${invId}/accept`, { method: 'POST' });
  assert.equal(acc.status, 200, `accept want 200 got ${acc.status}`);
  const rm = await api(owner.token, `/api/groups/${groupId}/members/${member.id}`, { method: 'DELETE' });
  assert.equal(rm.status, 204, `remove want 204 got ${rm.status}`);
  await rm.text().catch(() => {});
  const rmOwner = await api(owner.token, `/api/groups/${groupId}/members/${owner.id}`, { method: 'DELETE' });
  assert.equal(rmOwner.status, 403, `remove owner want 403 got ${rmOwner.status}`);
  await rmOwner.text().catch(() => {});
});

await step('owner bans/unbans; banned cannot be re-invited until unbanned', async () => {
  const inv = await api(owner.token, `/api/groups/${groupId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ userId: member.id }),
  });
  assert.equal(inv.status, 201, `invite want 201 got ${inv.status}`);
  await api(member.token, `/api/invitations/${(await json(inv)).id}/accept`, { method: 'POST' });
  const ban = await api(owner.token, `/api/groups/${groupId}/ban`, {
    method: 'POST',
    body: JSON.stringify({ userId: member.id }),
  });
  assert.equal(ban.status, 200, `ban want 200 got ${ban.status}`);
  assert.deepEqual(await json(await api(member.token, '/api/groups')), [], 'banned still listed');
  const blocked = await api(owner.token, `/api/groups/${groupId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ userId: member.id }),
  });
  assert.equal(blocked.status, 403, `invite banned want 403 got ${blocked.status}`);
  await blocked.text().catch(() => {});
  const unban = await api(owner.token, `/api/groups/${groupId}/unban`, {
    method: 'POST',
    body: JSON.stringify({ userId: member.id }),
  });
  assert.equal(unban.status, 200, `unban want 200 got ${unban.status}`);
  const again = await api(owner.token, `/api/groups/${groupId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ userId: member.id }),
  });
  assert.equal(again.status, 201, `invite after unban want 201 got ${again.status}`);
  await api(member.token, `/api/invitations/${(await json(again)).id}/accept`, { method: 'POST' });
});

await step('owner transfers ownership; old owner loses delete, new owner deletes', async () => {
  const t = await api(owner.token, `/api/groups/${groupId}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ userId: member.id }),
  });
  assert.equal(t.status, 200, `transfer want 200 got ${t.status}`);
  assert.equal((await json(t)).ownerId, member.id);
  const noDelete = await api(owner.token, `/api/groups/${groupId}`, { method: 'DELETE' });
  assert.equal(noDelete.status, 403, `old owner delete want 403 got ${noDelete.status}`);
  await noDelete.text().catch(() => {});
  const internal = await fetch(`${GROUP_DIRECT}/internal/groups/${groupId}/members/${member.id}`);
  assert.equal(internal.status, 200, `internal check want 200 got ${internal.status}`);
  assert.deepEqual(await json(internal), {
    groupId,
    userId: member.id,
    isMember: true,
    role: 'owner',
  });
  const del = await api(member.token, `/api/groups/${groupId}`, { method: 'DELETE' });
  assert.equal(del.status, 204, `owner delete want 204 got ${del.status}`);
  await del.text().catch(() => {});
  const gone = await api(member.token, `/api/groups/${groupId}`);
  assert.equal(gone.status, 404, `get-after-delete want 404 got ${gone.status}`);
  await gone.text().catch(() => {});
});

console.log(failures ? `\n${failures} failure(s).` : '\nAll group checks pass.');
process.exit(failures ? 1 : 0);
