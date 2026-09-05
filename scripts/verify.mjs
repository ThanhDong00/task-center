// Skeleton check for ticket #2: workspace files, contracts import,
// one DataSource per service, five logical databases reachable.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import net from 'node:net';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

const SERVICES = {
  'api-gateway': 'gateway_db',
  'auth-service': 'auth_db',
  'group-service': 'group_db',
  'task-service': 'task_db',
  'notification-service': 'notification_db',
};

// 1. Workspace files exist.
for (const f of ['package.json', 'pnpm-workspace.yaml', 'compose.yaml', 'db/init.sql', 'packages/contracts/src/index.ts']) {
  ok(existsSync(`${root}/${f}`), `file ${f} exists`);
}

// 2. Shared contracts package importable with all four event types.
const contracts = await import('../packages/contracts/src/index.ts');
const types = Object.values(contracts.EVENT_TYPES ?? {});
for (const t of ['task.created', 'task.updated', 'group.member.added', 'group.invitation.created']) {
  ok(types.includes(t), `contracts knows ${t}`);
}

// 3. One DataSource per service, each owning its own database.
for (const [svc, db] of Object.entries(SERVICES)) {
  const p = `${root}/apps/${svc}/src/db.ts`;
  const src = existsSync(p) ? readFileSync(p, 'utf8') : '';
  ok(src.includes('new DataSource') && src.includes(db), `${svc} DataSource owns ${db}`);
}

// 4. Postgres port reachable.
const portOpen = await new Promise((resolve) => {
  const s = net.connect(5432, '127.0.0.1');
  s.once('connect', () => s.end(resolve(true)));
  s.once('error', () => resolve(false));
});
ok(portOpen, 'postgres reachable on 127.0.0.1:5432 (run `pnpm stack:up` if not)');
if (!portOpen) {
  console.log(`\n${failures} failure(s). Start the stack first: pnpm up`);
  process.exit(1);
}

// 5. All five logical databases reachable (SELECT 1 in each).
const ps = execFileSync('podman', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
const container = ps.split('\n').find((n) => n.includes('postgres'));
ok(!!container, `postgres container running (${(container ?? '').trim()})`);
if (container) {
  const name = container.trim();
  const dbs = execFileSync('podman', ['exec', name, 'psql', '-U', 'postgres', '-Atc', 'SELECT datname FROM pg_database;'], { encoding: 'utf8' }).split('\n');
  for (const db of Object.values(SERVICES)) {
    ok(dbs.includes(db), `database ${db} exists`);
    try {
      execFileSync('podman', ['exec', name, 'psql', '-U', 'postgres', '-d', db, '-tc', 'SELECT 1;'], { stdio: 'pipe' });
      ok(true, `database ${db} answers SELECT 1`);
    } catch {
      ok(false, `database ${db} answers SELECT 1`);
    }
  }
}

console.log(failures ? `\n${failures} failure(s).` : '\nAll skeleton checks pass.');
process.exit(failures ? 1 : 0);
