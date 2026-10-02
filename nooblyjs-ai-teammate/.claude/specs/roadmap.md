# Roadmap — NooblyJS Digital Teammate

| Field   | Value                                   |
|---------|-----------------------------------------|
| Status  | v0.7 — Phases 3 to 6 complete (live run pending your API key) |
| Updated | 2026-10-02                              |
| Related | [prd.md](prd.md), [architecture.md](architecture.md), [design brief](design/teammates-design-brief.md) |

## How we work through this together

Each phase is a set of small, separately reviewable items. For every phase:

1. **You choose** the next phase, or individual items within it.
2. **Decisions first.** Every item marked 🔶 needs your answer before the build starts. I'll propose a default for each one.
3. **I build** the items. Each one comes with tests (`npm test`) and fresh screenshots in `.temp/screenshots/`.
4. **You review** in the running app (`npm start`), and we tick the boxes here.

Legend: ✅ done · ⬜ to do · 🔶 decision needed

```
Phase 1  Foundation & designed UI         ✅ done
Phase 2  Make it real                      ✅ done (2.1 needs your key: npm run smoke:live)
Phase 3  Access & security                 ✅ done
Phase 4  Knowledge & smarter work          ✅ done
Phase 5  Billing complete                  ✅ done
Phase 6  Work history & collaboration      ✅ done
Phase 7  Hardening & release               ⬜ next: deploy, backups, CI, v1.0
```

---

## Phase 1 — Foundation & designed UI ✅

**Goal:** the four designed screens running on a Markdown file store, with teammates callable over HTTP.

- ✅ Express 5 app, plain HTML/CSS/JS front end, routes `/team`, `/team/:id`, `/billing`, `/hire`, `/profiles`
- ✅ File store: Markdown + front matter, atomic writes, per-file locking, path-traversal protection
- ✅ Seed workspace matching the mockups: 8 teammates, 30 skills, timesheets, invoices, memory
- ✅ Team roster: summary tiles, status filters with search, cards, hire card, empty state
- ✅ Profile: hero, about, skills (add and remove), weekly timesheet, model & cost, memory (review, delete, reset), 4-week chart
- ✅ Billing: week/month/quarter with period stepping, budget, spend by model, cost by teammate, invoices, optimistic approvals, CSV export
- ✅ Hire: five steps, avatar picker and upload, skill pack upload, live preview with cap estimate, save draft
- ✅ Teammate endpoint `POST /api/teammates/:id/tasks`, returning JSON or a stream
- ✅ Providers: Anthropic (prompt caching, effort, refusal fallback) and an offline mock
- ✅ Memory written after each task by the reflection model, with session, personal and team modes
- ✅ Hours × rate billing derived from tokens, with the real API cost recorded on each entry
- ✅ 18 automated tests, plus screenshots at 1440px and 390px

---

## Phase 2 — Make it real ✅

**Goal:** real teammates doing real work, and everything about them editable in the UI.

- 🔶 **2.1 First live run.** Ready but not yet run, because this environment has no API key. Put `ANTHROPIC_API_KEY` in `.env` and run `npm run smoke:live`. It runs one small task each on Haiku, Sonnet and Opus against a throwaway copy of the workspace, and prints usage, billed and actual cost, and the memories written. It costs a few cents. `AI_PROVIDER=mock npm run smoke:live` is a free dry run.
- ✅ **2.2 Markdown output.** Replies are rendered as safe Markdown (`public/js/markdown.js`) while they stream in the Assign dialog, and in the work item view. Raw HTML is escaped and only http, https, mailto and relative links are allowed.
- ✅ **2.3 Edit profile.** The profile's **Edit** dialog covers avatar, name, role, about, traits, status, bill-to, monthly cap, approval threshold (which can be cleared), memory mode and memory cap. Errors show next to each field.
- ✅ **2.4 Persona editor.** **Edit persona** has Write and Preview tabs, Save, and **Reset to default** (`POST /api/teammates/:id/persona/reset`).
- ✅ **2.5 Skill levels.** Each skill row has **Edit**: change the level, edit the shared library description and instructions (with a warning listing the other teammates who use it), or remove the skill.
- ✅ **2.6 Retire a teammate.** Retire is in the Edit dialog. The teammate leaves the roster, but their timesheets stay in billing. Their profile shows a banner with **Reinstate**. Calls to a retired teammate return `410`, and edits return `409`.
- ✅ **2.7 Live status.** `GET /api/events` streams `teammate` and `timesheet` events. The roster, the profile status pill, timesheets and the sidebar budget update without a page reload.
- ✅ **Decisions taken (proposed defaults):** "Off shift" is a manual status, set in the Edit dialog. Work is assigned from the profile only.

> Change from the earlier plan: retired teammates **stay in `data/teammates/<id>/`** with a `retiredAt` date, rather than moving to `data/archive/`. This keeps every billing report and file link working without special cases.

**Done when:** a real Opus task and a real Haiku task each log correct costs (waiting on 2.1), and every field on the profile can be edited ✅.

---

## Phase 3 — Access & security ✅

**Goal:** safe to run somewhere other than your own machine, and safe for other systems to call teammates.

- ✅ **3.1 Owner login** for the UI, using session cookies and CSRF protection on changes. `/login` shows a first-run form (the one-time setup code printed in the server log, plus a new password) or the password form; signed-out visitors are sent there and back to the page they asked for. Sign out sits next to the owner in the sidebar. `OWNER_PASSWORD` can set the password on first start instead.
- ✅ **3.2 API keys** for `/api/teammates/:id/tasks`. Keys are stored hashed in `data/system/api-keys.md`, scoped to chosen teammates, shown once when created, and can be revoked.
- ✅ **3.3 Admin screen** (`/admin`) to create and revoke keys and see when each was last used and how often, with a `curl` example, change the password, sign out everywhere, and read the audit log.
- ✅ **3.4 Caller attribution.** Each timesheet entry and work item records which key or user made the call. Calls made with a key show "via API key …" on the profile timesheet and in billing, and the work item shows who requested it.
- ✅ **3.5 Rate limits** per key (calls per minute, `429` with `Retry-After`), sign-in throttling, and an audit log of sign-ins and configuration changes (`data/system/audit/YYYY-MM.md`).
- ✅ **Decisions taken:** one owner now (roles in Phase 6.6). API keys can only call teammates, not read billing or memory.

**Done when:** calls without a valid key are rejected ✅, and every logged entry shows who made the call ✅.

> Fixed along the way: the API and Phase 2 tests had not been updated for sign-in, so 16 of 26 tests failed. They now sign in through `test/helpers.js`. Setup codes now avoid look-alike characters (no `0/O`, `1/I`, `-` or `_` inside the code).

---

## Phase 4 — Knowledge & smarter work ✅

**Goal:** teammates use reference material and conversations, not just their memory.

- ✅ **4.1 Knowledge documents.** Upload (several at once) or write `.md`/`.txt` documents per teammate (`teammates/<id>/knowledge/`), with a Knowledge section and tab on the profile to view, edit, retag or delete them.
- ✅ **4.2 Retrieval.** BM25 over passages (documents split along headings and paragraphs, ~900 characters each). The best passages, up to ~1,500 tokens, go into the prompt as labelled reference material, and the teammate is asked to cite documents by title. Passages scoring under 35% of the best match are dropped, and a passage that only matches the document's title is used only when nothing else matches. The work item records which documents and passages were used (`src/services/retrieval.js`).
- ✅ **4.3 Skill selection.** Teammates with four skills or fewer always get all of them. Otherwise the top three matching skills are used, or the strongest ones when nothing matches. The `skill` parameter forces one skill. The work item records `skillsUsed`.
- ✅ **4.4 Conversations.** Every task starts or continues a thread (`teammates/<id>/threads/thr_….md`). Passing `thread` sends up to six earlier turns as history and keeps the thread's project. The Assign dialog and the work item view both have **Follow up**.
- ✅ **4.5 Memory upkeep.** Pin and unpin memories (pinned items go first in the prompt and are never merged). Over the memory cap, the oldest unpinned items are merged into one note (keeping their sources) instead of being deleted. Merges stay within one project and one contributor. Each memory links to the work item it came from.
- ✅ **4.6 Team memory screen** (`/team-memory`): everything in shared team memory, who contributed each item, filters by kind and project, pin and delete.
- ✅ **Decisions taken:** an optional project tag. Tasks, documents and memories can carry one; items with a project are only used for tasks on that project, untagged items are shared, and memories learned on a project are tagged with it. Knowledge uploads are `.md`/`.txt` only for now (PDF/DOCX later).

**Done when:** a teammate's answer cites an uploaded document ✅, and the work item lists which document and memories it used ✅. (Checked with the offline mock provider, which now cites the documents it is given; a real model is asked to do the same.)

> Note: if every unpinned item over the cap is alone in its project, nothing can be merged and memory stays slightly over the cap rather than losing anything.

---

## Phase 5 — Billing complete ✅

**Goal:** a team lead can run month-end and control spend without touching files.

- ✅ **5.1 Month close.** Billing → Invoices → **Close a month** previews the approved total, pending time and any existing invoice, then writes `invoices/INV-nnnn.md` with the approved entries as line items. Pending time blocks the close unless you leave it out (recorded on the invoice). An open invoice is regenerated under the same number; a paid one is final until marked unpaid. Each invoice opens in a dialog with breakdowns by teammate and cost centre, **Mark paid / unpaid**, and **PDF** / **CSV** downloads (a small built-in PDF writer, no new dependencies).
- ✅ **5.2 Settings screen** (`/settings`, Budgets & billing): weekly/monthly/quarterly budgets, cost centres (a centre a teammate is billed to can't be removed), owner name and title, tokens per hour, billing increment, invoice due day, typical output for estimates, and the warning settings. Errors show next to each field.
- ✅ **5.3 Models & pricing** (`/settings?tab=models`): name, model id, description, suggested rate, compute and tools per hour (with live margin), and list prices. Changing a price, or **Prices are current**, records the review date; prices older than 90 days are flagged. Past tasks keep the API cost recorded when they ran.
- ✅ **5.4 Approval threshold.** Tasks are estimated before they run (prompt characters ÷ 4 plus typical output, billed like real usage). Over the threshold, API-key calls get `202` and wait under **Billing → Tasks waiting for approval** (Approve & run / Decline with a reason); approved tasks run in the background under the reserved work id, which callers poll at `GET /api/teammates/:id/tasks/:workId`. The owner sees the estimate in the Assign dialog and can **Approve & start**. Work items record who approved them.
- ✅ **5.5 Cap warnings** at the warning share (default 80%) and at 100% of a teammate's monthly cap and of each budget: once per period, as a toast anywhere in the app, a banner on Billing, a highlighted sidebar budget and profile cap line, and an optional signed webhook (`cap.warning`, `cap.reached`, `budget.warning`, `budget.reached`) with a **Send a test** button.
- ✅ **5.6 Token billing view.** Billing → **Tokens**: tokens, API cost, billed amount and margin for the period, by teammate, model and cost centre, with cost and billed amount per million tokens.
- ✅ **Decisions taken (proposed defaults):** billed hours stay derived from tokens, with the rate now editable in Settings. Unapproved entries count towards budgets and are shown as pending (Billing budget card and sidebar).

**Done when:** the September invoice is generated from data, marked paid, and matches the CSV export exactly ✅ (checked in `test/phase5.test.js`: INV-0009 is regenerated from approved September time, its CSV equals the approved rows of the September export, and it is marked paid).

> Note: an existing `data/` folder from before this phase has no price review dates, so Models & pricing shows "Prices never reviewed" until you press **Prices are current**. New settings (warning share, typical output) use their defaults until saved.

---

## Phase 6 — Work history & collaboration ✅

**Goal:** teammates work together and on a schedule, and you can see everything they did.

- ✅ **6.1 Work timeline** (`/timeline`): every task grouped by day, newest first, with who asked (a person, an API key, a schedule or another teammate), project, status, tools used and cost. Handoffs are linked both ways ("→ handed to Dot · $0.60", "← handed over by Archie"), and each task shows its total including handoffs. Filter by teammate (a handoff stays visible next to its parent) and by 7/14/30 days. Side cards show what is waiting for approval and the next scheduled runs. Opens any work item, which now lists its tool calls and handoffs.
- ✅ **6.2 Delegation.** A teammate may hand work to the teammates on their `delegatesTo` list, through a `delegate` tool. The handoff is a task of its own: billed to the teammate who does it (caller "teammate"), subject to their cap and approval threshold, and linked to the parent work item. The parent gets the result back to use in its answer. Work can be handed on at most twice, and never back to someone already in the chain.
- ✅ **6.3 Tools.** Per-teammate allow-list (`tools`), edited on the profile under **Tools & handoffs**. Built-ins: `fetch_url` (public http(s) only: private, local and metadata addresses are blocked, every redirect is re-checked, responses are capped at 300 KB) and `notify` (a message to webhooks subscribed to `teammate.message`). The owner adds MCP servers (Streamable HTTP) under **Settings → Tools**; tools the server marks `readOnlyHint` run straight away. Every call is logged on the work item. Calls with side effects (`notify`, and MCP tools not marked read-only) are queued under **Billing → Waiting for approval**, run only when a manager approves, and only if the teammate is still allowed the tool at that moment. The model loop stops after 8 rounds and never runs tools after a `max_tokens` or refusal turn.
- ✅ **6.4 Scheduled tasks**, on the profile under **Schedules**: days of the week and a time in the workspace time zone (Settings, IANA name, DST-aware), with an optional project and cost centre. **Run now**, pause and delete. A run missed while the server was down happens once on the next check (every 30 s), never run by run. Runs are called by the schedule, so they follow approval thresholds.
- ✅ **6.5 Webhooks:** a list of endpoints (**Settings → Webhooks**), each with its own signing secret (shown once), the events it subscribes to, a **Test** button and its last delivery. Events: `task.completed`, `task.failed`, `approval.requested`, `action.requested`, `teammate.message`, `budget.warning`, `budget.reached`, `cap.warning`, `cap.reached`. The Phase 5 single alert webhook is moved into the list automatically.
- ✅ **6.6 Multiple users with roles:** Owner (everything), Manager (assign and approve work, edit teammates, tools and schedules), Viewer (read-only). Owners add people under **Admin → People** with a temporary password shown once; people change it from their name in the sidebar. Changing a role, disabling someone or resetting their password signs them out. There is always at least one active owner, and nobody can change their own role. The Phase 3 owner moves into `system/users.md` on start with the same password (username = the owner id, e.g. `stevie`; signing in without a username still means the owner). The UI hides what a role can't use; the server enforces it.
- ✅ **Decisions taken (proposed defaults):** the three roles above. Side-effect tools are queued (the task finishes and the action runs on approval) rather than pausing the task. Delegation is a tool limited to an allow-list, two levels deep. One webhook list for every event.

**Done when:** a scheduled Architect task delegates to the Documentor, and the timeline shows both with linked costs ✅ (`test/phase6.test.js`: a schedule fires for "Archie Stone, Architect", Archie hands the write-up to "Dot Lin, Documentor", both log their own time, and the timeline links the two items with each cost and the combined total. Dot's attempt to hand it back is refused by the loop guard).

> Notes: `fetch_url` checks DNS before connecting, so a host that changes its DNS answer between the check and the request (DNS rebinding) is not fully covered; run behind an egress firewall if teammates read untrusted URLs. The MCP client supports tools only (no resources, prompts or sampling). Approved actions run after the task has finished, so the model never sees their result.

---

## Phase 7 — Hardening & release ⬜

**Goal:** v1.0 that a team can depend on.

- ⬜ **7.1 Docker image** and volume guidance for `data/`.
- ⬜ **7.2 Backups:** a `tar` script, or the data directory as its own git repo with automatic commits.
- ⬜ **7.3 CI:** tests, linting and screenshot checks on every push.
- ⬜ **7.4 Performance:** caching of list results, and quick startup with a large timesheet history.
- ⬜ **7.5 Accessibility audit** (WCAG 2.1 AA) and a security review (dependencies, CSP, prompt-injection cases).
- ⬜ **7.6 Docs:** an OpenAPI spec for the teammate endpoint, an admin guide, and how to write skills.

**Done when:** v1.0 is tagged and deployed from the Docker image, with a backup that has been restored successfully.

---

## Backlog

- OpenAI-compatible provider (Azure, Ollama, vLLM) for non-Claude teammates
- Teammate templates or a catalog marketplace, and "save teammate as template"
- Export and import a teammate as a zip
- Slack or Teams adapter so people can talk to teammates in chat
- Model A/B tests: send some tasks to another model and compare rating against cost
- Ratings on work items (thumbs up or down) feeding into memory and performance reviews
