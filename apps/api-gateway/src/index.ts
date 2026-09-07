// API Gateway (tickets #3, #4): routes /api/auth/* to auth-service and
// /api/tasks/* to task-service, validates JWT on protected REST before
// proxying. Stateless in v1 (no DB reads).
import axios from "axios";
import express from "express";
import type { Request, Response } from "express";
import { jwtSecret, verifyJwt } from "@taskcenter/contracts";
import { dataSource } from "./db.ts";

const PORT = Number(process.env.PORT ?? 3000);
const AUTH_URL = process.env.AUTH_URL ?? "http://localhost:3001";
const TASK_URL = process.env.TASK_URL ?? "http://localhost:3002";
const SECRET = jwtSecret();

// Public auth paths skip JWT validation; everything else needs access token.
const PUBLIC = new Set([
  "POST /auth/register",
  "POST /auth/login",
  "POST /auth/refresh",
]);

const app = express();
app.get("/health", (_req, res) => res.json({ ok: true }));

function authorized(req: Request): boolean {
  const h = req.headers.authorization ?? "";
  const claims = h.startsWith("Bearer ")
    ? verifyJwt(h.slice(7), SECRET)
    : null;
  return !!claims && claims.type === "access";
}

async function proxyTo(req: Request, res: Response, base: string): Promise<void> {
  const upstream = req.originalUrl.replace(/^\/api/, "");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    const upstreamRes = await axios.request({
      method: req.method,
      url: `${base}${upstream}`,
      headers: {
        ...(req.headers["content-type"]
          ? { "content-type": req.headers["content-type"] }
          : {}),
        ...(req.headers.authorization
          ? { authorization: req.headers.authorization }
          : {}),
        ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
      },
      data: chunks.length ? Buffer.concat(chunks) : undefined,
      validateStatus: () => true,
      responseType: "arraybuffer",
    });

    const setCookie = upstreamRes.headers["set-cookie"];
    if (setCookie) res.setHeader("set-cookie", setCookie as string | string[]);
    res
      .status(upstreamRes.status)
      .type(
        (upstreamRes.headers["content-type"] as string | undefined) ??
          "application/json",
      );
    res.send(Buffer.from(upstreamRes.data as ArrayBuffer));
  } catch {
    res.status(502).json({ error: "service unreachable" });
  }
}

app.use("/api/auth", async (req: Request, res: Response) => {
  const upstream = req.originalUrl.replace(/^\/api/, "");
  if (
    !PUBLIC.has(`${req.method} ${upstream.split("?")[0]}`) &&
    !authorized(req)
  )
    return void res.status(401).json({ error: "unauthorized" });
  await proxyTo(req, res, AUTH_URL);
});

app.use("/api/tasks", async (req: Request, res: Response) => {
  if (!authorized(req))
    return void res.status(401).json({ error: "unauthorized" });
  await proxyTo(req, res, TASK_URL);
});

app.use((_req, res) => res.status(404).json({ error: "not found" }));

console.log(
  `api-gateway owns ${(dataSource.options as { database?: string }).database}; auth -> ${AUTH_URL}; tasks -> ${TASK_URL}`,
);
app.listen(PORT, () => console.log(`api-gateway :${PORT}`));
