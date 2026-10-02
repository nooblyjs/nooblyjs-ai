# Phase 6 (complete): Timeline, Delegation, Schedules and the Finished Wiring

> Scope: the work after `8b51e09 Almost phase 6`, which finishes Phase 6. Read [2026-10-01-phase-6-roles-webhooks-tools.md](2026-10-01-phase-6-roles-webhooks-tools.md) first for roles, webhooks, tools and the MCP client.

## 1. Executive Summary

Teammates can now work on a timetable and hand work to each other. Every task, handoff and tool call appears on one **Work timeline**, with what each side cost. A team lead can set "Archie reviews the architecture every Monday and has Dot write it up", leave it running, and later check who did what and what it cost, without opening any files.

## 2. System Topology

**Closing the gap from the last note**
- `src/app.js`: services are now created in dependency order: `WebhookService` → `ToolService` → `TeamService` (validates `tools`) → `AlertService` → `InvocationService` (now gets `tools` and `webhooks`) → `BillingService` → `SchedulerService` (started on boot, its timer `unref()`'d). New options: `allowPrivateNetwork`, `clock` and `scheduleIntervalMs` (tests pass `0` and drive `tick()` themselves).
- `src/services/tools.js`: `runAction()` now checks the teammate's **current** allow-list before running an approved action (see §5).

**Scheduling (6.4)**
- `src/repos/schedules.js` (new): `data/schedules/<sch_id>.md`. The front matter holds the teammate, `cadence: { days, time }`, `nextRunAt`, `lastRunAt` and `lastStatus`; the body is the task.
- `src/services/scheduler.js` (new): time-zone maths with `Intl` only (`zonedTime`, `nextRun`, which handles daylight saving by re-checking the offset). Every 30 s, `tick(now)` **claims** each due schedule under the file lock (moving `nextRunAt` on) before starting it, so it runs once even if two ticks overlap. A run calls `invocation.assign()` with `caller.type = 'schedule'` and is tracked with `invocation.track()`.

**Delegation and the tool loop (6.2, 6.3)**
- `src/services/invocation.js`: `toolsFor()` builds the `delegate` tool from `delegatesTo` (the `enum` holds only allowed teammate ids) and wraps side-effect tools in `queueAction()`. `delegate()` calls `assign()` again for the target, passing `delegatedFrom` and `chain`. It refuses any id already in the chain, and any chain longer than `MAX_DELEGATION_DEPTH = 2`. The child's time goes on the child's own timesheet; the parent records `{ teammateId, workId, amount }` in `delegations`.

**Reading it back (6.1)**
- `src/repos/work.js`: adds `list(teammateId, { from })` (front matter plus the first line of the request) and `update()`.
- `src/services/team.js`: `timeline({ teammate, days })` joins work items across teammates, resolves links in both directions, and adds `totalAmount = own + delegated`. When you filter by a teammate, their handoffs on either side stay visible.
- `src/routes/api.js`: `/api/timeline`, `/api/schedules[/:id][/run]`, `/api/tools` and `/api/mcp-servers` (owner only).

**Screens**
- `public/js/pages/timeline.js` (new) and `public/js/profile-automation.js` (new: the Tools & handoffs and Schedules cards and their dialogs). `work-dialog.js` lists tool calls and handoffs and can jump between linked work items. `settings.js` gains the Webhooks and Tools tabs and a time zone field. `admin.js` gains People. `app.js` adds role-aware navigation, `ctx.can(role)`, the timeline route and an account dialog for changing your own password.
- Roles in the UI: `body.can-manage` and `body.can-own` classes hide controls. **The server is the real gate**: `requireRole` runs in the routes.

```
SchedulerService.tick ──claim──▶ InvocationService.assign(Archie, caller=schedule)
                                   └─ runWithTools ─▶ delegate ─▶ assign(Dot, caller=teammate, chain=[archie])
                                                                    └─ delegate(Archie) ✗ already in chain
   work/<archie>.delegations[] ◀──── linked ────▶ work/<dot>.delegatedFrom
                         TeamService.timeline() joins both → /timeline
```

## 3. The Trade-Off

**A delegation runs synchronously, inside the parent's tool call.** When Archie hands work to Dot, Archie's model turn waits while Dot's whole task (model call, reflection, timesheet) runs. Dot's answer then comes back as Archie's `tool_result`.

- *Gained:* the parent sees the result and can use it in the same answer, there is no job queue or callback to build, and the link between the two work items is written in one request.
- *Given up:* time and robustness. The parent's HTTP request (or SSE stream) stays open for the length of both tasks, and a long chain (two levels) multiplies that. A crash mid-handoff loses both runs. One exception: if Dot's part needs approval, Archie is told it is pending and carries on, so an approval never blocks the parent. A queue with resumable parents would remove the wait, but would need saved conversation state, which is the same problem Phase 6 avoided for side-effect actions.

## 4. Active Recall

A schedule is set for **Mondays at 08:00** with the workspace time zone `Europe/London`. The server is down from Sunday 22:00 to Wednesday 10:00 UTC, and during that downtime the owner changes the time zone to `Africa/Johannesburg`. When the server starts and the first `tick()` runs, how many times does the schedule run, which `nextRunAt` does it claim, and what decides whether the new time zone is used for that next run?

## 5. Answer to the Last Note's Question

Before this change, an approved `mcp__crm__create_contact` would reach `runMcp()`. That function only checks that the server still exists and is enabled, so **disabling the server** stopped it, but **removing `mcp:crm` from the teammate's allow-list did not**. `runAction()` now checks `teammate.tools` first and returns `{ isError: true, text: "… is no longer allowed …" }`. The approval is stored as `status: approved` with `outcome: failed`, the work item's tool call is marked `failed`, and the manager sees "Approved, but it failed: …" (covered in `test/phase6.test.js`).
