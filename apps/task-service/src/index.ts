// Task Service (issue #4): personal Task CRUD. Express + shared JWT helpers
// from contracts, one TypeORM DataSource. Creator-only visibility: creatorId
// comes from the access-token sub, never from the client.
import { randomUUID } from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import { jwtSecret, verifyJwt } from "@taskcenter/contracts";
import { dataSource } from "./db.ts";
import { TaskSchema, publicTask } from "./task.ts";
import type { TaskPriority, TaskRow, TaskStatus } from "./task.ts";

const PORT = Number(process.env.PORT ?? 3002);
const SECRET = jwtSecret();

const STATUSES: TaskStatus[] = ["todo", "in-progress", "done"];
const PRIORITIES: TaskPriority[] = ["low", "medium", "high"];

function validTitle(v: unknown): v is string {
  return (
    typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 200
  );
}

function validDescription(v: unknown): v is string | null | undefined {
  return (
    v === undefined || v === null || (typeof v === "string" && v.length <= 2000)
  );
}

function parseDueDate(v: unknown): Date | null | undefined {
  if (v === undefined || v === null) return v;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) return undefined;
  return new Date(v);
}

async function main(): Promise<void> {
  await dataSource.initialize();
  const repo = dataSource.getRepository(TaskSchema);
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

  const requireAccess = (
    req: Request,
    res: Response,
  ): { id: string; username: string } | null => {
    const h = req.headers.authorization ?? "";
    const claims = h.startsWith("Bearer ")
      ? verifyJwt(h.slice(7), SECRET)
      : null;
    if (!claims || claims.type !== "access") {
      res.status(401).json({ error: "unauthorized" });
      return null;
    }
    return { id: claims.sub, username: claims.username };
  };

  // Personal tasks only in v1 (issue #4): group/assignee scoping arrives
  // with group tasks, so reject it here instead of silently dropping it.
  const scopedToGroup = (body: Record<string, unknown>): boolean =>
    body.groupId != null || body.assigneeId != null;

  const findOwn = (creatorId: string, id: string): Promise<TaskRow | null> =>
    repo.findOneBy({ id, creatorId });

  app.post("/tasks", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const body = req.body as Record<string, unknown>;
    if (scopedToGroup(body))
      return void res.status(400).json({ error: "personal tasks only" });

    const { title, description, status, priority, dueDate } = body;
    if (!validTitle(title))
      return void res.status(400).json({ error: "title 1-200 chars" });
    if (status !== undefined && !STATUSES.includes(status as TaskStatus))
      return void res
        .status(400)
        .json({ error: "status todo / in-progress / done" });
    if (
      priority !== undefined &&
      !PRIORITIES.includes(priority as TaskPriority)
    )
      return void res
        .status(400)
        .json({ error: "priority low / medium / high" });
    if (!validDescription(description))
      return void res.status(400).json({ error: "description too long" });
    const due = parseDueDate(dueDate);
    if (due === undefined)
      return void res
        .status(400)
        .json({ error: "dueDate must be a date string" });

    const saved = await repo.save({
      id: randomUUID(),
      creatorId: me.id,
      title: title.trim(),
      description: description == null ? null : description,
      status: (status as TaskStatus) ?? "todo",
      priority: (priority as TaskPriority) ?? "medium",
      dueDate: due ?? null,
    });

    res.status(201).json(publicTask(saved));
  });

  app.get("/tasks", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;
    res.json((await repo.findBy({ creatorId: me.id })).map(publicTask));
  });

  app.get("/tasks/:id", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;
    const found = await findOwn(me.id, req.params.id);
    if (!found) return void res.status(404).json({ error: "not found" });
    res.json(publicTask(found));
  });

  app.patch("/tasks/:id", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const found = await findOwn(me.id, req.params.id);
    if (!found) return void res.status(404).json({ error: "not found" });

    const body = req.body as Record<string, unknown>;
    if (scopedToGroup(body))
      return void res.status(400).json({ error: "personal tasks only" });

    const { title, description, status, priority, dueDate } = body;
    if (title !== undefined) {
      if (!validTitle(title))
        return void res.status(400).json({ error: "title 1-200 chars" });
      found.title = title.trim();
    }
    if (status !== undefined) {
      if (!STATUSES.includes(status as TaskStatus))
        return void res
          .status(400)
          .json({ error: "status todo / in-progress / done" });
      found.status = status as TaskStatus;
    }
    if (priority !== undefined) {
      if (!PRIORITIES.includes(priority as TaskPriority))
        return void res
          .status(400)
          .json({ error: "priority low / medium / high" });
      found.priority = priority as TaskPriority;
    }
    if (description !== undefined) {
      if (!validDescription(description))
        return void res.status(400).json({ error: "description too long" });
      found.description = description == null ? null : description;
    }
    if (dueDate !== undefined) {
      const due = parseDueDate(dueDate);
      if (due === undefined)
        return void res
          .status(400)
          .json({ error: "dueDate must be a date string" });
      found.dueDate = due;
    }

    res.json(publicTask(await repo.save(found)));
  });

  app.delete("/tasks/:id", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;
    const found = await findOwn(me.id, req.params.id);
    if (!found) return void res.status(404).json({ error: "not found" });
    await repo.remove(found);
    res.status(204).send();
  });

  app.use((_req, res) => res.status(404).json({ error: "not found" }));

  app.listen(PORT, () =>
    console.log(`task-service :${PORT} (db=${dataSource.options.database})`),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
