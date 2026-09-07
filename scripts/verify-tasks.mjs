// Issue #4: Personal tasks end-to-end via gateway (spec #1).
// External behavior only: HTTP status + payload shape through gateway REST.
// Run: pnpm stack:up (postgres), start auth-service (:3001) + task-service (:3002)
// + gateway (:3000), then `node scripts/verify-tasks.mjs`.
import assert from 'node:assert/strict';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const stamp = Date.now().toString(36);
const u1 = `tasks_a_${stamp}`;
const u2 = `tasks_b_${stamp}`;
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
  return (await json(res)).accessToken;
};
const api = (token, path, opts = {}) =>
  fetch(`${GATEWAY}${path}`, {
    ...opts,
    headers: {
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

await register(u1);
await register(u2);
const a = await login(u1);
const b = await login(u2);
let id = '';
const DUE = '2026-10-01T00:00:00.000Z';

await step('gateway rejects /api/tasks without token -> 401', async () => {
  const res = await api(null, '/api/tasks');
  assert.equal(res.status, 401, `want 401 got ${res.status}`);
  await res.text().catch(() => {});
});

await step('create personal task with priority + due date', async () => {
  const res = await api(a, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'buy milk', priority: 'high', dueDate: DUE }),
  });
  assert.equal(res.status, 201, `want 201 got ${res.status}: ${(await res.clone().text()).slice(0, 200)}`);
  const t = await json(res);
  assert.ok(t.id, 'missing id');
  assert.equal(t.title, 'buy milk');
  assert.equal(t.status, 'todo');
  assert.equal(t.priority, 'high');
  assert.equal(t.dueDate, DUE);
  id = t.id;
});

await step('create validates title/priority/status/dueDate/group', async () => {
  for (const payload of [
    {},
    { title: '  ' },
    { title: 'x', priority: 'urgent' },
    { title: 'x', status: 'started' },
    { title: 'x', dueDate: 'not-a-date' },
    { title: 'x', groupId: 'g1' },
  ]) {
    const res = await api(a, '/api/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 400, `payload ${JSON.stringify(payload)} want 400 got ${res.status}`);
    await res.text().catch(() => {});
  }
});

await step('read + list own tasks', async () => {
  const one = await api(a, `/api/tasks/${id}`);
  assert.equal(one.status, 200, `get want 200 got ${one.status}`);
  assert.equal((await json(one)).id, id);
  const list = await api(a, '/api/tasks');
  assert.equal(list.status, 200, `list want 200 got ${list.status}`);
  const items = await json(list);
  assert.ok(Array.isArray(items) && items.some((t) => t.id === id), 'created task missing from list');
});

await step('status moves todo / in-progress / done', async () => {
  for (const status of ['in-progress', 'done']) {
    const res = await api(a, `/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    assert.equal(res.status, 200, `patch status want 200 got ${res.status}`);
    assert.equal((await json(res)).status, status);
  }
  const bad = await api(a, `/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'started' }),
  });
  assert.equal(bad.status, 400, `bad status want 400 got ${bad.status}`);
  await bad.text().catch(() => {});
});

await step('priority + due date persist on update', async () => {
  const res = await api(a, `/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ priority: 'low', dueDate: '2026-11-02T00:00:00.000Z' }),
  });
  assert.equal(res.status, 200, `patch want 200 got ${res.status}`);
  const t = await json(res);
  assert.equal(t.priority, 'low');
  assert.equal(t.dueDate, '2026-11-02T00:00:00.000Z');
});

await step('only creator can see or edit (other user gets 404)', async () => {
  for (const [method, path, body] of [
    ['GET', `/api/tasks/${id}`],
    ['PATCH', `/api/tasks/${id}`, JSON.stringify({ title: 'hijack' })],
    ['DELETE', `/api/tasks/${id}`],
  ]) {
    const res = await api(b, path, { method, ...(body ? { body } : {}) });
    assert.equal(res.status, 404, `${method} want 404 got ${res.status}`);
    await res.text().catch(() => {});
  }
  const list = await api(b, '/api/tasks');
  assert.deepEqual(await json(list), [], 'other user list should be empty');
});

await step('delete personal task', async () => {
  const res = await api(a, `/api/tasks/${id}`, { method: 'DELETE' });
  assert.equal(res.status, 204, `delete want 204 got ${res.status}`);
  await res.text().catch(() => {});
  const gone = await api(a, `/api/tasks/${id}`);
  assert.equal(gone.status, 404, `get-after-delete want 404 got ${gone.status}`);
  await gone.text().catch(() => {});
});

console.log(failures ? `\n${failures} failure(s).` : '\nAll task checks pass.');
process.exit(failures ? 1 : 0);
