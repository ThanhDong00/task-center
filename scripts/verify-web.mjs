// Issue #8: web refresh-retry check. Imports the SPA's own apiFetch
// (erasable TS, no React imports) with a stub fetch: expired token (401)
// heals via one POST /auth/refresh, dead refresh surfaces the 401.
import assert from 'node:assert/strict';
import { apiFetch } from '../apps/web/src/api.ts';

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

const stub = (routes) => async (url, init = {}) => {
  const hit = routes.find((r) => url.endsWith(r.path) && (!r.method || init.method === r.method));
  assert.ok(hit, `unexpected fetch ${init.method ?? 'GET'} ${url}`);
  return { status: hit.status, ok: hit.status < 300, json: async () => hit.body ?? null };
};

await step('401 retries once after refresh with the new token', async () => {
  const seen = [];
  const calls = [];
  const doFetch = async (url, init = {}) => {
    calls.push(url);
    if (url.endsWith('/auth/refresh'))
      return { status: 200, ok: true, json: async () => ({ accessToken: 'new' }) };
    seen.push(init.headers?.authorization ?? null);
    return seen.length === 1
      ? { status: 401, ok: false, json: async () => ({ error: 'unauthorized' }) }
      : { status: 200, ok: true, json: async () => ({ ok: true }) };
  };
  let saved = null;
  const res = await apiFetch('http://gw/api', () => 'old', (t) => { saved = t; }, '/tasks', {}, doFetch);
  assert.equal(res.status, 200);
  assert.equal(saved, 'new');
  assert.deepEqual(seen, ['Bearer old', 'Bearer new']);
  assert.ok(calls.some((u) => u.endsWith('/auth/refresh')));
});

await step('dead refresh returns the original 401 without retry', async () => {
  let hits = 0;
  const doFetch = stub([
    { path: '/tasks', status: 401 },
    { path: '/auth/refresh', method: 'POST', status: 401 },
  ]);
  const counting = async (u, i) => { hits++; return doFetch(u, i); };
  const res = await apiFetch('http://gw/api', () => 'old', () => {}, '/tasks', {}, counting);
  assert.equal(res.status, 401);
  assert.equal(hits, 2);
});

await step('non-401 never touches refresh', async () => {
  let hits = 0;
  const res = await apiFetch('http://gw/api', () => 't', () => {}, '/tasks', {}, async () => {
    hits++;
    return { status: 200, ok: true, json: async () => [] };
  });
  assert.equal(res.status, 200);
  assert.equal(hits, 1);
});

console.log(failures ? `\n${failures} failure(s).` : '\nAll web checks pass.');
process.exit(failures ? 1 : 0);
