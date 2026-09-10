// Task Service (issues #4 personal, #6 group): Task CRUD + comments.
// Express + shared JWT helpers from contracts, one TypeORM DataSource.
// Creator-only visibility for personal tasks; view-open / edit-narrow for
// group tasks. Assignment validates against live membership in group-service
// (ADR-0001, fail-closed). Tasks of departed members stay but read back as
// unassigned (lazy sweep on read, no event bus in v1).
import { randomUUID } from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import { jwtSecret, verifyJwt } from "@taskcenter/contracts";
import { dataSource } from "./db.ts";
import {
  CommentSchema,
  TaskSchema,
  publicComment,
  publicTask,
} from "./task.ts";
import type { TaskPriority, TaskRow, TaskStatus } from "./task.ts";

const PORT = Number(process.env.PORT ?? 3002);
const SECRET = jwtSecret();
const GROUP_URL = process.env.GROUP_URL ?? "http://localhost:3003";

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

function validBody(v: unknown): v is string {
  return typeof v === "string" && v.trim().length >= 1 && v.length <= 2000;
}

function parseDueDate(v: unknown): Date | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) return undefined;
  return new Date(v);
}

interface Membership {
  isMember: boolean;
  role: string | null;
  groupExists?: boolean;
}

// Live membership from group-service (ADR-0001). Null = unreachable:
// callers fail closed (502), never assume.
async function membership(
  groupId: string,
  userId: string,
): Promise<Membership | null> {
  try {
    const res = await fetch(
      `${GROUP_URL}/internal/groups/${groupId}/members/${userId}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as Membership;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  await dataSource.initialize();
  const repo = dataSource.getRepository(TaskSchema);
  const comments = dataSource.getRepository(CommentSchema);
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

  // Member gate: 502 when group-service is unreachable, 404 when the
  // caller isn't an active member (group existence stays private).
  // Returns the membership when the caller is a member, else null with
  // the response already sent.
  const memberOr = async (
    res: Response,
    groupId: string,
    userId: string,
  ): Promise<Membership | null> => {
    const m = await membership(groupId, userId);
    if (!m) res.status(502).json({ error: "group unavailable" });
    else if (!m.isMember) res.status(404).json({ error: "not found" });
    return m && m.isMember ? m : null;
  };

  // Lazy unassign: a departed (banned/removed/left) assignee reads back as
  // null and is persisted that way. Returns false when the check itself
  // fails so the caller can fail closed.
  const sweepAssignee = async (t: TaskRow): Promise<boolean> => {
    if (!t.groupId || !t.assigneeId) return true;
    const m = await membership(t.groupId, t.assigneeId);
    if (!m) return false;
    if (!m.isMember) {
      t.assigneeId = null;
      await repo.save(t);
    }
    return true;
  };

  app.post("/tasks", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const body = req.body as Record<string, unknown>;
    const {
      title,
      description,
      status,
      priority,
      dueDate,
      groupId,
      assigneeId,
    } = body;
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

    // Personal task: group/assignee scoping is rejected, not silently dropped.
    if (groupId == null) {
      if (assigneeId != null)
        return void res.status(400).json({ error: "personal tasks only" });
      const saved = await repo.save({
        id: randomUUID(),
        creatorId: me.id,
        groupId: null,
        assigneeId: null,
        title: title.trim(),
        description: description == null ? null : description,
        status: (status as TaskStatus) ?? "todo",
        priority: (priority as TaskPriority) ?? "medium",
        dueDate: due ?? null,
      });
      return void res.status(201).json(publicTask(saved));
    }

    // Group task: any active member creates; optional assignee must be a
    // member too (fail-closed when group-service is unreachable).
    if (typeof groupId !== "string" || !groupId.trim())
      return void res.status(400).json({ error: "groupId required" });

    const mine = await membership(groupId, me.id);
    if (!mine) return void res.status(502).json({ error: "group unavailable" });
    // Unknown group is a bad request (personal-task-era clients get 400,
    // not a group-existence oracle); real group without membership is 404.
    if (mine.groupExists === false)
      return void res.status(400).json({ error: "unknown group" });
    if (!mine.isMember)
      return void res.status(404).json({ error: "not found" });

    let assignee: string | null = null;
    if (assigneeId != null) {
      if (typeof assigneeId !== "string" || !assigneeId.trim())
        return void res
          .status(400)
          .json({ error: "assignee must be a member" });

      const m = await membership(groupId, assigneeId);
      if (!m) return void res.status(502).json({ error: "group unavailable" });
      if (!m.isMember)
        return void res
          .status(400)
          .json({ error: "assignee must be a member" });

      assignee = assigneeId;
    }

    const saved = await repo.save({
      id: randomUUID(),
      creatorId: me.id,
      groupId,
      assigneeId: assignee,
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

    const groupId = req.query.groupId as string | undefined;
    if (groupId == null) {
      const own = await repo.findBy({ creatorId: me.id });
      return void res.json(
        own.filter((t) => t.groupId == null).map(publicTask),
      );
    }

    if (typeof groupId !== "string" || !groupId)
      return void res.status(400).json({ error: "groupId required" });
    if (!(await memberOr(res, groupId, me.id))) return;
    const tasks = await repo.findBy({ groupId });
    for (const t of tasks) {
      if (!(await sweepAssignee(t)))
        return void res.status(502).json({ error: "group unavailable" });
    }

    res.json(tasks.map(publicTask));
  });

  // Visible task or null (response already sent on 404/502).
  const loadVisible = async (
    req: Request<{ id: string }>,
    res: Response,
    me: { id: string },
  ): Promise<{ task: TaskRow; role: string | null } | null> => {
    const task = await repo.findOneBy({ id: req.params.id });
    if (!task) {
      res.status(404).json({ error: "not found" });
      return null;
    }

    if (task.groupId == null) {
      if (task.creatorId !== me.id) {
        res.status(404).json({ error: "not found" });
        return null;
      }
      return { task, role: null };
    }

    const mine = await memberOr(res, task.groupId, me.id);
    if (!mine) return null;
    if (!(await sweepAssignee(task))) {
      res.status(502).json({ error: "group unavailable" });
      return null;
    }
    return { task, role: mine.role };
  };

  app.get("/tasks/:id", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const found = await loadVisible(req, res, me);
    if (!found) return;

    res.json(publicTask(found.task));
  });

  app.patch("/tasks/:id", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const body = req.body as Record<string, unknown>;
    const found = await repo.findOneBy({ id: req.params.id });
    if (!found) return void res.status(404).json({ error: "not found" });

    // Personal task: creator only, no group/assignee keys.
    if (found.groupId == null) {
      if (found.creatorId !== me.id)
        return void res.status(404).json({ error: "not found" });
      if (body.groupId != null || body.assigneeId != null)
        return void res.status(400).json({ error: "personal tasks only" });
    } else {
      // Group task: view-open already checked; edit-narrow below.
      const mine = await memberOr(res, found.groupId, me.id);
      if (!mine) return;

      if (!(await sweepAssignee(found)))
        return void res.status(502).json({ error: "group unavailable" });

      const privileged = mine.role === "owner" || mine.role === "admin";

      const canEdit =
        privileged || found.creatorId === me.id || found.assigneeId === me.id;
      if (!canEdit) return void res.status(403).json({ error: "forbidden" });

      if (body.groupId != null && body.groupId !== found.groupId)
        return void res.status(400).json({ error: "groupId immutable" });

      if (body.assigneeId !== undefined) {
        const canAssign = privileged || found.creatorId === me.id;
        if (!canAssign)
          return void res.status(403).json({ error: "forbidden" });

        const next = body.assigneeId;
        if (next === null) {
          found.assigneeId = null;
        } else {
          if (typeof next !== "string" || !next.trim())
            return void res
              .status(400)
              .json({ error: "assignee must be a member" });

          const m = await membership(found.groupId, next);
          if (!m)
            return void res.status(502).json({ error: "group unavailable" });
          if (!m.isMember)
            return void res
              .status(400)
              .json({ error: "assignee must be a member" });

          found.assigneeId = next;
        }
      }
    }

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

    const found = await repo.findOneBy({ id: req.params.id });
    // v1 deletes personal tasks only (spec #1 story 25); group tasks stay
    // so a removal never destroys team history.
    if (!found || found.groupId != null || found.creatorId !== me.id)
      return void res.status(404).json({ error: "not found" });

    await repo.remove(found);

    res.status(204).send();
  });

  app.post("/tasks/:id/comments", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const found = await loadVisible(req, res, me);
    if (!found) return;

    const { body } = req.body as Record<string, unknown>;
    if (!validBody(body))
      return void res.status(400).json({ error: "body 1-2000 chars" });

    const saved = await comments.save({
      id: randomUUID(),
      taskId: found.task.id,
      authorId: me.id,
      body: body.trim(),
      createdAt: new Date(),
    });

    res.status(201).json(publicComment(saved));
  });

  app.get("/tasks/:id/comments", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const found = await loadVisible(req, res, me);
    if (!found) return;

    res.json(
      (await comments.findBy({ taskId: found.task.id }))
        .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
        .map(publicComment),
    );
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
