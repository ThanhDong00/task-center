// Ticket #3: Auth end-to-end via gateway (spec #1).
// External behavior only: HTTP status + payload shape through gateway REST.
// Run: pnpm stack:up (postgres), start auth-service (:3001) + gateway (:3000), then `node scripts/verify-auth.mjs`.
import assert from 'node:assert/strict';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const u = `e2e_${Date.now().toString(36)}`;
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

let access = '';
let cookie = '';

await step('register unique username + password', async () => {
  const res = await fetch(`${GATEWAY}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'secret123' }),
  });
  assert.equal(res.status, 201, `want 201 got ${res.status}`);
  const b = await json(res);
  assert.equal(b.username, u);
  assert.ok(b.id, 'missing id');
});

await step('register duplicate username -> 409', async () => {
  const res = await fetch(`${GATEWAY}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'secret123' }),
  });
  assert.equal(res.status, 409, `want 409 got ${res.status}`);
});

await step('login returns access token + httpOnly refresh cookie', async () => {
  const res = await fetch(`${GATEWAY}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'secret123' }),
  });
  assert.equal(res.status, 200, `want 200 got ${res.status}`);
  const b = await json(res);
  assert.ok(b.accessToken, 'missing accessToken');
  access = b.accessToken;
  const setCookie = res.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /refreshToken=/, 'missing refresh cookie');
  assert.match(setCookie, /httponly/i, 'cookie not httpOnly');
  cookie = setCookie.split(';')[0];
});

await step('login wrong password -> 401', async () => {
  const res = await fetch(`${GATEWAY}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'wrongpass' }),
  });
  assert.equal(res.status, 401, `want 401 got ${res.status}`);
});

await step('gateway rejects /me without token -> 401', async () => {
  const res = await fetch(`${GATEWAY}/api/auth/me`);
  assert.equal(res.status, 401, `want 401 got ${res.status}`);
});

await step('refresh renews session without re-login', async () => {
  const res = await fetch(`${GATEWAY}/api/auth/refresh`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(res.status, 200, `want 200 got ${res.status}`);
  const b = await json(res);
  assert.ok(b.accessToken, 'missing renewed accessToken');
  access = b.accessToken;
});

await step('update username and avatar', async () => {
  const res = await fetch(`${GATEWAY}/api/auth/me`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
    body: JSON.stringify({ username: `${u}_v2`, avatar: 'https://cdn/x.png' }),
  });
  assert.equal(res.status, 200, `want 200 got ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`);
  const get = await fetch(`${GATEWAY}/api/auth/me`, {
    headers: { authorization: `Bearer ${access}` },
  });
  // token still carries old username; re-login to get fresh claims then verify persisted profile
  const login = await fetch(`${GATEWAY}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: `${u}_v2`, password: 'secret123' }),
  });
  assert.equal(login.status, 200, 're-login with new username failed');
  const lb = await json(login);
  assert.equal(lb.user.username, `${u}_v2`);
  assert.equal(lb.user.avatar, 'https://cdn/x.png');
  assert.equal(get.status, 200);
});

console.log(failures ? `\n${failures} failure(s).` : '\nAll auth checks pass.');
process.exit(failures ? 1 : 0);
