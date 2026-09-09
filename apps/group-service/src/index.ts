// Group Service (issue #5): groups, membership lifecycle, invitations, bans.
// Express + shared JWT helpers from contracts, one TypeORM DataSource.
// Caller identity comes from the access-token sub, never from the client.
// Visibility: only active members see a group (others get 404, like tasks).
import { randomUUID } from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import { jwtSecret, verifyJwt } from "@taskcenter/contracts";
import { dataSource } from "./db.ts";
import {
  BanSchema,
  GroupSchema,
  InvitationSchema,
  MembershipSchema,
  publicGroup,
  publicInvitation,
} from "./group.ts";
import type { GroupRole } from "./group.ts";

const PORT = Number(process.env.PORT ?? 3003);
const SECRET = jwtSecret();

function validName(v: unknown): v is string {
  return (
    typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 100
  );
}

function validDescription(v: unknown): v is string | null | undefined {
  return (
    v === undefined || v === null || (typeof v === "string" && v.length <= 2000)
  );
}

function validUserId(v: unknown): v is string {
  return typeof v === "string" && v.trim().length >= 1;
}

async function main(): Promise<void> {
  await dataSource.initialize();
  const groups = dataSource.getRepository(GroupSchema);
  const memberships = dataSource.getRepository(MembershipSchema);
  const invitations = dataSource.getRepository(InvitationSchema);
  const bans = dataSource.getRepository(BanSchema);
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

  // Sync membership check for task-service assignment (ADR-0001).
  // Internal route: no JWT, reachable only inside the cluster network.
  app.get("/internal/groups/:id/members/:userId", async (req, res) => {
    const m = await memberships.findOneBy({
      groupId: req.params.id,
      userId: req.params.userId,
    });
    res.json({
      groupId: req.params.id,
      userId: req.params.userId,
      isMember: !!m,
      role: m?.role ?? null,
    });
  });

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

  // Member-only group lookup: non-members get 404 so group existence stays private.
  const findVisible = async (groupId: string, userId: string) => {
    const group = await groups.findOneBy({ id: groupId });
    if (!group) return null;

    const mine = await memberships.findOneBy({ groupId, userId });
    if (!mine) return null;

    return { group, mine };
  };

  const privileged = (role: GroupRole): boolean =>
    role === "owner" || role === "admin";

  app.post("/groups", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const { name, description } = req.body as Record<string, unknown>;
    if (!validName(name))
      return void res.status(400).json({ error: "name 1-100 chars" });
    if (!validDescription(description))
      return void res.status(400).json({ error: "description too long" });

    const group = await groups.save({
      id: randomUUID(),
      name: name.trim(),
      description: description == null ? null : description,
      ownerId: me.id,
    });

    await memberships.save({ groupId: group.id, userId: me.id, role: "owner" });

    res.status(201).json(publicGroup(group, "owner"));
  });

  app.get("/groups", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const mine = await memberships.findBy({ userId: me.id });

    const out = [];
    for (const m of mine) {
      const g = await groups.findOneBy({ id: m.groupId });
      if (g) out.push(publicGroup(g, m.role));
    }

    res.json(out);
  });

  app.get("/groups/:id", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const found = await findVisible(req.params.id, me.id);
    if (!found) return void res.status(404).json({ error: "not found" });

    res.json(publicGroup(found.group, found.mine.role));
  });

  app.get("/groups/:id/members", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const found = await findVisible(req.params.id, me.id);
    if (!found) return void res.status(404).json({ error: "not found" });

    res.json(
      (await memberships.findBy({ groupId: req.params.id })).map((m) => ({
        userId: m.userId,
        role: m.role,
      })),
    );
  });

  app.patch("/groups/:id", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const found = await findVisible(req.params.id, me.id);
    if (!found) return void res.status(404).json({ error: "not found" });

    if (!privileged(found.mine.role))
      return void res.status(403).json({ error: "owner or admin only" });

    const { name, description } = req.body as Record<string, unknown>;
    if (name !== undefined) {
      if (!validName(name))
        return void res.status(400).json({ error: "name 1-100 chars" });
      found.group.name = name.trim();
    }
    if (description !== undefined) {
      if (!validDescription(description))
        return void res.status(400).json({ error: "description too long" });
      found.group.description = description == null ? null : description;
    }

    res.json(publicGroup(await groups.save(found.group), found.mine.role));
  });

  app.delete("/groups/:id", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const found = await findVisible(req.params.id, me.id);
    if (!found) return void res.status(404).json({ error: "not found" });

    if (found.mine.role !== "owner")
      return void res.status(403).json({ error: "owner only" });

    const gid = req.params.id;
    await invitations.delete({ groupId: gid });
    await memberships.delete({ groupId: gid });
    await bans.delete({ groupId: gid });
    await groups.remove(found.group);

    res.status(204).send();
  });

  app.post("/groups/:id/invites", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const found = await findVisible(req.params.id, me.id);
    if (!found) return void res.status(404).json({ error: "not found" });

    if (!privileged(found.mine.role))
      return void res.status(403).json({ error: "owner or admin only" });

    const { userId } = req.body as Record<string, unknown>;
    if (!validUserId(userId))
      return void res.status(400).json({ error: "userId required" });

    const target = userId.trim();
    if (
      await memberships.findOneBy({ groupId: found.group.id, userId: target })
    )
      return void res.status(409).json({ error: "already a member" });
    if (await bans.findOneBy({ groupId: found.group.id, userId: target }))
      return void res.status(403).json({ error: "user is banned" });
    if (
      await invitations.findOneBy({
        groupId: found.group.id,
        userId: target,
        status: "pending",
      })
    )
      return void res.status(409).json({ error: "already invited" });

    res.status(201).json(
      publicInvitation(
        await invitations.save({
          id: randomUUID(),
          groupId: found.group.id,
          userId: target,
          createdBy: me.id,
          status: "pending",
        }),
      ),
    );
  });

  app.get("/invitations", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    res.json(
      (await invitations.findBy({ userId: me.id, status: "pending" })).map(
        publicInvitation,
      ),
    );
  });

  const answerInvite = async (
    req: Request<{ id: string }>,
    res: Response,
    accept: boolean,
  ) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const invite = await invitations.findOneBy({ id: req.params.id });
    // Only the invited user ever sees their invite (others get 403, not 404).
    if (!invite) return void res.status(404).json({ error: "not found" });
    if (invite.userId !== me.id)
      return void res.status(403).json({ error: "not your invitation" });
    if (invite.status !== "pending")
      return void res.status(409).json({ error: `already ${invite.status}` });

    if (accept) {
      if (await bans.findOneBy({ groupId: invite.groupId, userId: me.id }))
        return void res.status(403).json({ error: "user is banned" });
      if (!(await groups.findOneBy({ id: invite.groupId })))
        return void res.status(404).json({ error: "group gone" });
      await memberships.save({
        groupId: invite.groupId,
        userId: me.id,
        role: "member",
      });
      invite.status = "accepted";
    } else {
      invite.status = "declined";
    }

    res.json(publicInvitation(await invitations.save(invite)));
  };

  app.post("/invitations/:id/accept", async (req, res) =>
    answerInvite(req, res, true),
  );
  app.post("/invitations/:id/decline", async (req, res) =>
    answerInvite(req, res, false),
  );

  app.post("/groups/:id/leave", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const found = await findVisible(req.params.id, me.id);
    if (!found) return void res.status(404).json({ error: "not found" });

    if (found.mine.role === "owner")
      return void res.status(400).json({ error: "transfer ownership first" });

    await memberships.remove(found.mine);

    res.status(204).send();
  });

  app.delete("/groups/:id/members/:userId", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const found = await findVisible(req.params.id, me.id);
    if (!found) return void res.status(404).json({ error: "not found" });

    if (!privileged(found.mine.role))
      return void res.status(403).json({ error: "owner or admin only" });

    const target = await memberships.findOneBy({
      groupId: req.params.id,
      userId: req.params.userId,
    });
    if (!target) return void res.status(404).json({ error: "not found" });
    if (target.role === "owner")
      return void res.status(403).json({ error: "cannot remove owner" });
    // Admins remove members only; only the owner moves admins.
    if (found.mine.role === "admin" && target.role !== "member")
      return void res.status(403).json({ error: "owner only" });

    await memberships.remove(target);

    res.status(204).send();
  });

  app.post("/groups/:id/ban", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const found = await findVisible(req.params.id, me.id);
    if (!found) return void res.status(404).json({ error: "not found" });

    if (found.mine.role !== "owner")
      return void res.status(403).json({ error: "owner only" });

    const { userId } = req.body as Record<string, unknown>;
    if (!validUserId(userId))
      return void res.status(400).json({ error: "userId required" });

    const target = await memberships.findOneBy({
      groupId: req.params.id,
      userId: userId.trim(),
    });
    if (!target || target.role === "owner")
      return void res.status(404).json({ error: "not found" });

    await memberships.remove(target);
    await bans.save({ groupId: req.params.id, userId: userId.trim() });
    await invitations.update(
      { groupId: req.params.id, userId: userId.trim(), status: "pending" },
      { status: "declined" },
    );

    res.json({ groupId: req.params.id, userId: userId.trim(), banned: true });
  });

  app.post("/groups/:id/unban", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const found = await findVisible(req.params.id, me.id);
    if (!found) return void res.status(404).json({ error: "not found" });

    if (found.mine.role !== "owner")
      return void res.status(403).json({ error: "owner only" });

    const { userId } = req.body as Record<string, unknown>;
    if (!validUserId(userId))
      return void res.status(400).json({ error: "userId required" });

    const ban = await bans.findOneBy({
      groupId: req.params.id,
      userId: userId.trim(),
    });
    if (!ban) return void res.status(404).json({ error: "not found" });

    const bannedUserId = ban.userId;
    await bans.remove(ban);

    res.json({ groupId: req.params.id, userId: bannedUserId, banned: false });
  });

  app.post("/groups/:id/transfer", async (req, res) => {
    const me = requireAccess(req, res);
    if (!me) return;

    const found = await findVisible(req.params.id, me.id);
    if (!found) return void res.status(404).json({ error: "not found" });

    if (found.mine.role !== "owner")
      return void res.status(403).json({ error: "owner only" });

    const { userId } = req.body as Record<string, unknown>;
    if (!validUserId(userId))
      return void res.status(400).json({ error: "userId required" });

    const target = await memberships.findOneBy({
      groupId: req.params.id,
      userId: userId.trim(),
    });
    if (!target || target.role === "owner")
      return void res.status(404).json({ error: "not found" });

    target.role = "owner";
    found.mine.role = "admin";
    found.group.ownerId = target.userId;
    await memberships.save([target, found.mine]);

    res.json(publicGroup(await groups.save(found.group), "admin"));
  });

  app.use((_req, res) => res.status(404).json({ error: "not found" }));

  app.listen(PORT, () =>
    console.log(`group-service :${PORT} (db=${dataSource.options.database})`),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
