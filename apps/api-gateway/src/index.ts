// API Gateway (ticket #3): routes /api/auth/* to auth-service, validates JWT
// on protected REST before proxying. Stateless in v1 (no DB reads).
import express from 'express';
import type { Request, Response } from 'express';
import { jwtSecret, verifyJwt } from '@taskcenter/contracts';
import { dataSource } from './db.ts';

const PORT = Number(process.env.PORT ?? 3000);
const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:3001';
const SECRET = jwtSecret();

// Public auth paths skip JWT validation; everything else under /api/auth needs access token.
const PUBLIC = new Set(['POST /auth/register', 'POST /auth/login', 'POST /auth/refresh']);

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', async (req: Request, res: Response) => {
  const upstream = req.originalUrl.replace(/^\/api/, '');
  if (!PUBLIC.has(`${req.method} ${upstream.split('?')[0]}`)) {
    const h = req.headers.authorization ?? '';
    const claims = h.startsWith('Bearer ') ? verifyJwt(h.slice(7), SECRET) : null;
    if (!claims || claims.type !== 'access') return void res.status(401).json({ error: 'unauthorized' });
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    const upstreamRes = await fetch(`${AUTH_URL}${upstream}`, {
      method: req.method,
      headers: {
        ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}),
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
      },
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const setCookie = upstreamRes.headers.get('set-cookie');
    if (setCookie) res.setHeader('set-cookie', setCookie);
    res.status(upstreamRes.status).type(upstreamRes.headers.get('content-type') ?? 'application/json');
    res.send(Buffer.from(await upstreamRes.arrayBuffer()));
  } catch {
    res.status(502).json({ error: 'auth-service unreachable' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

console.log(`api-gateway owns ${(dataSource.options as { database?: string }).database}; auth -> ${AUTH_URL}`);
app.listen(PORT, () => console.log(`api-gateway :${PORT}`));
