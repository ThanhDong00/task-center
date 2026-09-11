// Notification Service (issue #7): owns Notification, consumes RabbitMQ
// task/group events, persists one row per recipient, pushes live over
// Socket.io direct (ADR-0002: gateway proxies REST only, never WS).
// Offline users catch up via GET /notifications; read state via PATCH read.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import type { Request, Response } from "express";
import { Server } from "socket.io";
import {
  EVENT_TYPES,
  NOTIF_EXCHANGE,
  jwtSecret,
  rabbitUrl,
  verifyJwt,
} from "@taskcenter/contracts";
import type { EventPayload } from "@taskcenter/contracts";
import { dataSource } from "./db.ts";
import { NotificationSchema, publicNotification } from "./notification.ts";

const PORT = Number(process.env.PORT ?? 3004);
const SECRET = jwtSecret();
const GROUP_URL = process.env.GROUP_URL ?? "http://localhost:3003";

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  await dataSource.initialize();
  const repo = dataSource.getRepository(NotificationSchema);
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

  // Offline catch-up: own notifications, newest first.
  app.get("/notifications", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;
    const rows = await repo.findBy({ userId: me.id });
    rows.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    res.json(rows.map(publicNotification));
  });

  // Read state clears the queue (one row; others' rows stay invisible).
  app.patch("/notifications/:id/read", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;
    const found = await repo.findOneBy({ id: req.params.id });
    if (!found || found.userId !== me.id)
      return void res.status(404).json({ error: "not found" });
    found.read = true;
    res.json(publicNotification(await repo.save(found)));
  });

  const server = createServer(app);
  const io = new Server(server, { cors: { origin: true } });

  // WS auth: access token from handshake, one room per user.
  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown }).token;
    const claims = typeof token === "string" ? verifyJwt(token, SECRET) : null;
    if (!claims || claims.type !== "access")
      return next(new Error("unauthorized"));
    socket.join(`user:${claims.sub}`);
    next();
  });

  const notify = async (parts: {
    userId: string;
    type: string;
    taskId: string | null;
    groupId: string | null;
  }): Promise<void> => {
    const saved = await repo.save({
      id: randomUUID(),
      ...parts,
      read: false,
      createdAt: new Date(),
    });
    io.to(`user:${parts.userId}`).emit(
      "notification",
      publicNotification(saved),
    );
  };

  const handle = async (msg: EventPayload): Promise<void> => {
    if (
      msg.type === EVENT_TYPES.TASK_CREATED ||
      msg.type === EVENT_TYPES.TASK_UPDATED
    ) {
      // Creator + assignee only; dedupe when unassigned or self-assigned.
      const to = [...new Set([msg.data.creatorId, msg.data.assigneeId])].filter(
        (u): u is string => !!u,
      );
      for (const userId of to)
        await notify({
          userId,
          type: msg.type,
          taskId: msg.data.taskId,
          groupId: msg.data.groupId,
        });
    } else if (msg.type === EVENT_TYPES.GROUP_MEMBER_ADDED) {
      // All current members learn about the join (live lookup, ADR-0001 style).
      try {
        const res = await fetch(
          `${GROUP_URL}/internal/groups/${msg.data.groupId}/members`,
        );
        if (!res.ok) return;

        const { userIds } = (await res.json()) as { userIds: string[] };
        for (const userId of userIds)
          await notify({
            userId,
            type: msg.type,
            taskId: null,
            groupId: msg.data.groupId,
          });
      } catch {
        return; // group-service down: message stays unacked for redelivery
      }
    } else if (msg.type === EVENT_TYPES.GROUP_INVITATION_CREATED) {
      await notify({
        userId: msg.data.invitedUserId,
        type: msg.type,
        taskId: null,
        groupId: msg.data.groupId,
      });
    }
  };

  // Durable consumer; retries connect forever so boot order never matters.
  const consume = async (): Promise<void> => {
    for (;;) {
      try {
        const { connect } = await import("amqplib");
        const conn = await connect(rabbitUrl());
        const ch = await conn.createChannel();
        await ch.assertExchange(NOTIF_EXCHANGE, "topic", { durable: true });
        const q = await ch.assertQueue("notifications", { durable: true });
        await ch.bindQueue(q.queue, NOTIF_EXCHANGE, "#");
        await ch.consume(q.queue, (m) => {
          if (!m) return;
          (async () => {
            try {
              await handle(JSON.parse(m.content.toString()) as EventPayload);
              ch.ack(m);
            } catch {
              ch.nack(m, false, true); // persist failed: redeliver
            }
          })();
        });
        console.log(`notification-service consuming ${rabbitUrl()}`);
        return;
      } catch (e) {
        console.error(`mq unavailable, retrying: ${(e as Error).message}`);
        await sleep(2000);
      }
    }
  };

  void consume();
  server.listen(PORT, () =>
    console.log(
      `notification-service :${PORT} (db=${dataSource.options.database})`,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
