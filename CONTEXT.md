# TaskCenter

Lightweight Jira-inspired task and team management. Single context covering users, groups, tasks, and notifications.

## Language

**User**:
An account identified by a unique username used as both login and display name. No email in v1.
_Avoid_: Account, email, display name (separate field)

**Group**:
A named collaboration space with members. Owns membership and invitations, nothing else.
_Avoid_: Team, workspace, project

**Owner**:
The single member who controls a group. Only owner can delete the group, ban members, or transfer ownership.
_Avoid_: Creator, super-admin

**Admin**:
A member who can invite/remove members (except the owner) and edit group info. Cannot delete the group or ban.
_Avoid_: Moderator, manager

**Member**:
A non-privileged group participant. Can leave at any time, view and work on group tasks.
_Avoid_: User (in group context)

**Invitation**:
A pending request for a user to join a group. Accepted or declined by the invited user only.
_Avoid_: Invite link, request

**Task**:
A unit of work. Either personal (no group) or belonging to exactly one group, optionally assigned to one member.
_Avoid_: Ticket, issue, todo

**Notification**:
A persisted record of an event addressed to one user, delivered over WebSocket when online and retrievable when offline.
_Avoid_: Event (user-facing), push, alert
