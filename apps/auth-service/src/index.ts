// Auth Service (ticket #3): register, login, refresh, me. Express + shared
// JWT/password helpers from contracts, one TypeORM DataSource.
import { randomUUID } from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import {
  ACCESS_TTL_SEC,
  REFRESH_TTL_SEC,
  hashPassword,
  jwtSecret,
  signJwt,
  verifyJwt,
  verifyPassword,
} from "@taskcenter/contracts";
import { dataSource } from "./db.ts";
import { UserSchema, publicUser } from "./user.ts";
import type { UserRow } from "./user.ts";

const PORT = Number(process.env.PORT ?? 3001);
const SECRET = jwtSecret();

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0)
      out[part.slice(0, i).trim()] = decodeURIComponent(
        part.slice(i + 1).trim(),
      );
  }
  return out;
}

function validUsername(v: unknown): v is string {
  return typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 32;
}

function validPassword(v: unknown): v is string {
  return typeof v === "string" && v.length >= 6 && v.length <= 128;
}

function validAvatar(v: unknown): v is string | null | undefined {
  return (
    v === undefined || v === null || (typeof v === "string" && v.length <= 2048)
  );
}

const refreshCookie = (token: string): string =>
  `refreshToken=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${REFRESH_TTL_SEC}; SameSite=Lax`;

async function main(): Promise<void> {
  await dataSource.initialize();
  const repo = dataSource.getRepository(UserSchema);
  const app = express();
  app.use(express.json());
  // Keep invalid-JSON responses JSON, not Express's default HTML.
  app.use(
    (err: Error, _req: Request, res: Response, next: express.NextFunction) => {
      if (err) return void res.status(400).json({ error: "invalid JSON" });
      next();
    },
  );

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.post("/auth/register", async (req, res) => {
    const { username, password } = req.body as Record<string, unknown>;
    if (!validUsername(username) || !validPassword(password))
      return void res
        .status(400)
        .json({ error: "username 1-32 chars, password 6-128 chars" });
    const name = username.trim();
    if (await repo.findOneBy({ username: name }))
      return void res.status(409).json({ error: "username taken" });
    const saved = await repo.save({
      id: randomUUID(),
      username: name,
      passwordHash: hashPassword(password),
      avatar: null,
    });
    res.status(201).json(publicUser(saved));
  });

  app.post("/auth/login", async (req, res) => {
    const { username, password } = req.body as Record<string, unknown>;
    if (typeof username !== "string" || typeof password !== "string")
      return void res
        .status(400)
        .json({ error: "username and password required" });
    const found = await repo.findOneBy({ username: username.trim() });
    if (!found || !verifyPassword(password, found.passwordHash))
      return void res.status(401).json({ error: "invalid credentials" });
    const accessToken = signJwt(
      { sub: found.id, username: found.username, type: "access" },
      SECRET,
      ACCESS_TTL_SEC,
    );
    const refreshToken = signJwt(
      { sub: found.id, username: found.username, type: "refresh" },
      SECRET,
      REFRESH_TTL_SEC,
    );
    res.setHeader("set-cookie", refreshCookie(refreshToken));
    res.json({ accessToken, user: publicUser(found) });
  });

  app.post("/auth/refresh", async (req, res) => {
    const token = parseCookies(req).refreshToken;
    const claims = token ? verifyJwt(token, SECRET) : null;
    if (!claims || claims.type !== "refresh")
      return void res.status(401).json({ error: "invalid refresh" });
    const found = await repo.findOneBy({ id: claims.sub });
    if (!found) return void res.status(401).json({ error: "invalid refresh" });
    const accessToken = signJwt(
      { sub: found.id, username: found.username, type: "access" },
      SECRET,
      ACCESS_TTL_SEC,
    );
    res.json({ accessToken });
  });

  const requireAccess = async (
    req: Request,
    res: Response,
  ): Promise<UserRow | null> => {
    const h = req.headers.authorization ?? "";
    const claims = h.startsWith("Bearer ")
      ? verifyJwt(h.slice(7), SECRET)
      : null;
    if (!claims || claims.type !== "access") {
      res.status(401).json({ error: "unauthorized" });
      return null;
    }
    const found = await repo.findOneBy({ id: claims.sub });
    if (!found) {
      res.status(401).json({ error: "unauthorized" });
      return null;
    }
    return found;
  };

  app.get("/auth/me", async (req, res) => {
    const found = await requireAccess(req, res);
    if (found) res.json(publicUser(found));
  });

  app.patch("/auth/me", async (req, res) => {
    const found = await requireAccess(req, res);
    if (!found) return;
    const { username, avatar } = req.body as Record<string, unknown>;
    if (username !== undefined) {
      if (!validUsername(username))
        return void res.status(400).json({ error: "username 1-32 chars" });
      const name = username.trim();
      if (name !== found.username && (await repo.findOneBy({ username: name })))
        return void res.status(409).json({ error: "username taken" });
      found.username = name;
    }
    if (!validAvatar(avatar))
      return void res.status(400).json({ error: "avatar too long" });
    if (avatar !== undefined) found.avatar = avatar;
    const saved = await repo.save(found);
    const accessToken = signJwt(
      { sub: saved.id, username: saved.username, type: "access" },
      SECRET,
      ACCESS_TTL_SEC,
    );
    res.json({ ...publicUser(saved), accessToken });
  });

  app.use((_req, res) => res.status(404).json({ error: "not found" }));

  app.listen(PORT, () =>
    console.log(`auth-service :${PORT} (db=${dataSource.options.database})`),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
