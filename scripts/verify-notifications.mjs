// Issue #7: Notifications + WS end-to-end via gateway REST + direct WS
// (spec #1, ADR-0002). External behavior only: persisted rows, live WS push,
// offline fetch, mark-read, recipient scoping.
// Run: pnpm stack:up (postgres + rabbitmq), start auth-service (:3001) +
// task-service (:3002) + group-service (:3003) + notification-service (:3004)
// + gateway (:3000), then `node scripts/verify-notifications.mjs`.
import assert from 'node:assert/strict';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const NOTIF = process.env.NOTIF_URL ?? 'http://localhost:3004';
const stamp = Date.now().toString(36);
const uOwner = `notif_owner_${stamp}`;
const uMember = `notif_member_${stamp}`;
const uOut = `notif_out_${stamp}`;
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
// Poll an async probe until it returns non-null (MQ delivery is async).
const waitFor = async (probe, timeoutMs = 15000) => {
  const start = Date.now();
  for (;;) {
    const got = await probe().catch(() => null);
    if (got) return got;
    assert.ok(Date.now() - start < timeoutMs, 'timed out waiting for notification');
    await new Promise((r) => setTimeout(r, 300));
  }
};
const listNotifs = async (token) => {
  const res = await api(token, '/api/notifications');
  assert.equal(res.status, 200, `list want 200 got ${res.status}`);
  return json(res);
};
const waitNotif = (token, pred) =>
  waitFor(async () => (await listNotifs(token)).find((n) => pred(n)) ?? null);

await register(uOwner);
await register(uMember);
await register(uOut);
const owner = await login(uOwner);
const member = await login(uMember);
const out = await login(uOut);

await step('gateway rejects /api/notifications without token -> 401', async () => {
  const res = await api(null, '/api/notifications');
  assert.equal(res.status, 401, `want 401 got ${res.status}`);
  await res.text().catch(() => {});
});

// Owner online over WS direct to notification-service (ADR-0002).
const { io } = await import('socket.io-client');
const ownerGot = [];
const ownerSock = io(NOTIF, { auth: { token: owner.token } });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('ws connect timeout')), 10000);
  ownerSock.on('connect', () => {
    clearTimeout(t);
    resolve(null);
  });
  ownerSock.on('connect_error', (e) => {
    clearTimeout(t);
    reject(new Error(`ws connect_error: ${e.message}`));
  });
});
ownerSock.on('notification', (n) => ownerGot.push(n));

await step('WS rejects bad token', async () => {
  const bad = io(NOTIF, { auth: { token: 'bogus' }, reconnection: false });
  const err = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 8000);
    bad.on('connect_error', (e) => {
      clearTimeout(t);
      resolve(e);
    });
  });
  bad.close();
  assert.ok(err, 'bad token connected without error');
});

// Setup: owner creates group, invites member (offline), member accepts.
let groupId = '';
{
  const res = await api(owner.token, '/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name: 'notifs' }),
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

await step('invitation notifies invited user (offline fetch)', async () => {
  const n = await waitNotif(member.token, (x) => x.type === 'group.invitation.created');
  assert.equal(n.groupId, groupId);
  assert.equal(n.read, false);
});

await step('member joined notifies group members via WS', async () => {
  // Owner is online: the earlier accept already fanned out to members.
  const n = await waitFor(async () => ownerGot.find((x) => x.type === 'group.member.added') ?? null);
  assert.equal(n.groupId, groupId);
});

let taskId = '';
await step('task created notifies creator + assignee only', async () => {
  ownerGot.length = 0;
  const res = await api(owner.token, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'notify me', groupId, assigneeId: member.id }),
  });
  assert.equal(res.status, 201, `want 201 got ${res.status}`);
  taskId = (await json(res)).id;
  // Creator gets live WS push.
  const live = await waitFor(async () => ownerGot.find((x) => x.taskId === taskId) ?? null);
  assert.equal(live.type, 'task.created');
  // Assignee catches up offline; outsider sees nothing.
  const mn = await waitNotif(member.token, (x) => x.taskId === taskId);
  assert.equal(mn.type, 'task.created');
  assert.ok(!(await listNotifs(out.token)).some((x) => x.taskId === taskId), 'outsider notified');
});

await step('task updated notifies creator + assignee', async () => {
  const res = await api(owner.token, `/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'notify me v2' }),
  });
  assert.equal(res.status, 200, `want 200 got ${res.status}`);
  const mn = await waitNotif(member.token, (x) => x.taskId === taskId && x.type === 'task.updated');
  assert.equal(mn.read, false);
});

await step('mark notification read; others cannot touch it', async () => {
  const mine = await listNotifs(member.token);
  assert.ok(mine.length > 0, 'member has no notifications');
  const first = mine[0];
  const res = await api(member.token, `/api/notifications/${first.id}/read`, { method: 'PATCH' });
  assert.equal(res.status, 200, `read want 200 got ${res.status}`);
  assert.equal((await json(res)).read, true);
  assert.equal((await listNotifs(member.token)).find((x) => x.id === first.id).read, true);
  const bad = await api(out.token, `/api/notifications/${first.id}/read`, { method: 'PATCH' });
  assert.equal(bad.status, 404, `cross-user read want 404 got ${bad.status}`);
  await bad.text().catch(() => {});
});

ownerSock.close();
console.log(failures ? `\n${failures} failure(s).` : '\nAll notification checks pass.');
process.exit(failures ? 1 : 0);
