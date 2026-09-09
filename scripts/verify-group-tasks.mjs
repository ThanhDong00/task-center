// Issue #6: Group tasks + assignment end-to-end via gateway (spec #1).
// External behavior only: HTTP status + payload shape through gateway REST.
// Run: pnpm stack:up (postgres), start auth-service (:3001) + task-service
// (:3002) + group-service (:3003) + gateway (:3000),
// then `node scripts/verify-group-tasks.mjs`.
import assert from 'node:assert/strict';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const stamp = Date.now().toString(36);
const uOwner = `gtask_owner_${stamp}`;
const uMember = `gtask_member_${stamp}`;
const uOut = `gtask_out_${stamp}`;
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
await register(uMember);
await register(uOut);
const owner = await login(uOwner);
const member = await login(uMember);
const out = await login(uOut);

// Setup: owner creates group, invites member, member accepts.
let groupId = '';
{
  const res = await api(owner.token, '/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name: 'gtasks' }),
  });
  assert.equal(res.status, 201, `setup group want 201 got ${res.status}`);
  groupId = (await json(res)).id;
  const inv = await api(owner.token, `/api/groups/${groupId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ userId: member.id }),
  });
  assert.equal(inv.status, 201, `setup invite want 201 got ${inv.status}`);
  const acc = await api(member.token, `/api/invitations/${(await json(inv)).id}/accept`, {
    method: 'POST',
  });
  assert.equal(acc.status, 200, `setup accept want 200 got ${acc.status}`);
}

let taskId = '';

await step('create group task; any active member views all', async () => {
  const res = await api(owner.token, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'team work', groupId }),
  });
  assert.equal(res.status, 201, `want 201 got ${res.status}: ${(await res.clone().text()).slice(0, 200)}`);
  const t = await json(res);
  assert.ok(t.id, 'missing id');
  assert.equal(t.groupId, groupId);
  assert.equal(t.assigneeId, null);
  taskId = t.id;
  // Member lists + reads the same task (view-open).
  const list = await api(member.token, `/api/tasks?groupId=${groupId}`);
  assert.equal(list.status, 200, `list want 200 got ${list.status}`);
  assert.ok((await json(list)).some((x) => x.id === taskId), 'member cannot see group task');
  const one = await api(member.token, `/api/tasks/${taskId}`);
  assert.equal(one.status, 200, `member get want 200 got ${one.status}`);
});

await step('outsider gets 404 on group tasks', async () => {
  const one = await api(out.token, `/api/tasks/${taskId}`);
  assert.equal(one.status, 404, `outsider get want 404 got ${one.status}`);
  await one.text().catch(() => {});
  const list = await api(out.token, `/api/tasks?groupId=${groupId}`);
  assert.equal(list.status, 404, `outsider list want 404 got ${list.status}`);
  await list.text().catch(() => {});
});

await step('edit restricted to assignee + creator + admin/owner', async () => {
  const bad = await api(member.token, `/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'hijack' }),
  });
  assert.equal(bad.status, 403, `plain member edit want 403 got ${bad.status}`);
  await bad.text().catch(() => {});
  const good = await api(owner.token, `/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'team work v2' }),
  });
  assert.equal(good.status, 200, `creator edit want 200 got ${good.status}`);
  assert.equal((await json(good)).title, 'team work v2');
});

await step('assign with live membership check, fail-closed', async () => {
  const res = await api(owner.token, `/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ assigneeId: member.id }),
  });
  assert.equal(res.status, 200, `assign want 200 got ${res.status}`);
  assert.equal((await json(res)).assigneeId, member.id);
  // Assignee can now edit (edit-narrow includes assignee).
  const edit = await api(member.token, `/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'in-progress' }),
  });
  assert.equal(edit.status, 200, `assignee edit want 200 got ${edit.status}`);
  // Assigning an outsider fails.
  const bad = await api(owner.token, `/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ assigneeId: out.id }),
  });
  assert.equal(bad.status, 400, `assign outsider want 400 got ${bad.status}`);
  await bad.text().catch(() => {});
  // Plain assignee cannot reassign; creator/admin/owner can unassign.
  const hijack = await api(member.token, `/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ assigneeId: out.id }),
  });
  assert.ok([400, 403].includes(hijack.status), `reassign by assignee want 400/403 got ${hijack.status}`);
  await hijack.text().catch(() => {});
  const un = await api(owner.token, `/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ assigneeId: null }),
  });
  assert.equal(un.status, 200, `unassign want 200 got ${un.status}`);
  assert.equal((await json(un)).assigneeId, null);
});

await step("removed member's tasks stay but become unassigned", async () => {
  await api(owner.token, `/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ assigneeId: member.id }),
  });
  const rm = await api(owner.token, `/api/groups/${groupId}/members/${member.id}`, {
    method: 'DELETE',
  });
  assert.equal(rm.status, 204, `remove want 204 got ${rm.status}`);
  await rm.text().catch(() => {});
  const one = await api(owner.token, `/api/tasks/${taskId}`);
  assert.equal(one.status, 200, `get-after-remove want 200 got ${one.status}`);
  const t = await json(one);
  assert.equal(t.assigneeId, null, 'task should be unassigned after member exit');
  assert.equal(t.title, 'team work v2', 'task should stay after member exit');
});

await step('comment on task', async () => {
  const res = await api(owner.token, `/api/tasks/${taskId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: 'looks good' }),
  });
  assert.equal(res.status, 201, `comment want 201 got ${res.status}: ${(await res.clone().text()).slice(0, 200)}`);
  assert.equal((await json(res)).body, 'looks good');
  const list = await api(owner.token, `/api/tasks/${taskId}/comments`);
  assert.equal(list.status, 200, `list comments want 200 got ${list.status}`);
  assert.ok((await json(list)).some((c) => c.body === 'looks good'), 'comment missing');
  const bad = await api(owner.token, `/api/tasks/${taskId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: '  ' }),
  });
  assert.equal(bad.status, 400, `empty comment want 400 got ${bad.status}`);
  await bad.text().catch(() => {});
});

console.log(failures ? `\n${failures} failure(s).` : '\nAll group-task checks pass.');
process.exit(failures ? 1 : 0);
