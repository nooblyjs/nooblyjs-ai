# NooblyJS: the whole application

**Lesson 00 · about 20 minutes · 2026-10-11** · read this first; every other lesson zooms into one part of it

## What you'll learn

- What NooblyJS is for, and the one rule everything in it follows: agents draft, people decide.
- How the nine repositories fit together as **one program** with one screen.
- Where everything is kept (plain files under `data/`), and how a piece of work travels from an idea to a merged
  pull request.

## The idea, in plain words

NooblyJS is an engineering-lifecycle platform. An idea becomes a spec, the spec gets an architecture and a
design, the design is built into code, and the code is shipped. At every step **AI agents do the drafting** (a spec,
an architecture decision, the code itself) and **people make the decisions** (approve the spec, accept the decision,
merge the pull request). The code enforces that split on the server, not just by hiding buttons.

Think of it as a **workshop with one front door**. The building (the `nooblyjs-ai-host` repo) has the front door, the corridors
and the noticeboard: sign-in, the navigation on the left, Home, team chat, and the rules about who may do what.
Each workshop in it is a separate repository that the building lets in: the Product Factory, the Software Factory,
Digital Teammates, Knowledge and Infrastructure. They all run inside the same program and share the same screen, so
moving between them never reloads the page. (Where the analogy stops working: the workshops can't walk into each
other's rooms. They talk only through the building: its services and its event log.)

### The seven stages

Every piece of work is an **item**, and an item is always in exactly one stage:

| # | Stage | Who does the work there | What a person decides to move it on |
| --- | --- | --- | --- |
| 1 | Discover | Signals (customer feedback) cluster into **ideas**, scored with RICE | Turn an idea into a spec |
| 2 | Specify | A teammate drafts the **spec** from a person's brief; readiness checks run on it | An Approver approves the spec |
| 3 | Architect | A teammate drafts the container view and architecture decisions (**ADRs**) | An Architect accepts the decisions |
| 4 | UX design | A teammate drafts journeys and flows | Move on to UI |
| 5 | UI design | Screens, then a **handoff** plan: work items per repository | The handoff is approved |
| 6 | Build | The **Software Factory** turns each work item into a run, and a run into a pull request | People merge the pull requests |
| 7 | Ship | The merged change goes out | Done |

The lifecycle engine (`src/lifecycle/`) owns those stages, the approvals and the handoffs. The other apps ask it to
move things; none of them moves an item on its own.

### The pieces

| Repo | Mounted at | What it is |
| --- | --- | --- |
| `nooblyjs-ai-host` | `/` | **The host.** Starts everything. Owns sign-in, the frame (rail, sidebar, chat dock), Home (Overview, For you, Lifecycle, Approvals, Activity, Metrics), team chat, Platform, the Teams bot, the lifecycle engine, and the connection to Jira and Bitbucket |
| `nooblyjs-core` | `/ui/` | **The shared library.** The service registry (logging, caching, queues, scheduling), the file store, sign-in providers, the UI kit every screen is built from, and the AI module (`nooblyjs-ai-common`) that talks to models |
| `nooblyjs-ai-product` | `/product` | **Product Factory.** Signals, ideas, specs, architecture, UX and UI design, and the drafting pipeline |
| `nooblyjs-ai-teammate` | `/teammates` | **Digital Teammates.** The AI agents you hire: their role, model, rate, budget, memory, timesheets. Every agent action in NooblyJS runs here as a **task** |
| `nooblyjs-ai-factory` | `/factory` | **Software Factory.** Runs a work item through stations (triage, build, verify, review, deliver) to a pull request. It never merges |
| `nooblyjs-ai-knowledge` | `/wiki` | **Knowledge.** The Wiki Platform: spaces and pages, imports with personal data redacted, answers that cite their sources |
| `nooblyjs-ai-infrastructure` | `/infrastructure` | **Infrastructure.** Designs for environments, provisioning runs, drift and cloud cost (the provisioner is a mock for now) |
| `nooblyjs-ai-harness` | — | **The agent runtime** the Factory's agents run on: the agent loop, tools, sandbox, permissions |
| `msteams/noobly-bot`, `edge`, `electron` | — | **Doors from elsewhere** (in `noobly/apps/`): the Teams app, a browser extension beside Jira, and a desktop window |

### One program, one screen

`npm start` runs `app.js` in `nooblyjs-ai-host`. It sets up `nooblyjs-core` once, mounts NooblyJS itself (`src/noobly.js`), then reads
`data/config/hosted-apps.yaml` and calls each app's `register()`. An app attaches its own routes under its mount
path and returns a description of itself: its rail entry, its sidebar rows, the services other apps may call. If an
app fails to start, its rail item says **Unavailable** and everything else carries on.

The browser loads **one frame** from the UI kit. Each app supplies a small module (a table of its pages) that the
frame loads into the content area. That is why the rail, the sidebar and an open chat stay put while you move
between apps.

### How the apps talk to each other

Never by importing each other. Two ways only:

- **Services**: `host.service('teammates').runTask(…)`, `host.service('workflows').decide(…)`,
  `host.service('platform').checkAgentWork(…)`. The full list is in `tech.md` §8b.
- **Events**: every change is a named event (`spec.drafted`, `handoff.created`, `pr.merged`) appended to the event
  log. Apps listen for the ones they care about. Home's Activity and Metrics are built from the same log.

### Agents propose, people decide

This is enforced in code, in four places you will meet in later lessons:

1. **Every agent action is a teammate task** (`runTask`). Nothing calls a model directly. A task is checked, billed
   to a team's timesheet, and recorded with who, what item, which model route and what it cost.
2. **Platform checks it first** (`checkAgentWork`): is the model allowed, may agents touch this repository, is the
   budget reached? A refusal is audited.
3. **Agents are capped at the Contributor role.** They can draft; they can never approve, accept a decision, merge,
   or change a budget or guardrail, whether they ask from the web, chat, Teams or an API key.
4. **Jira and Bitbucket are production systems.** NooblyJS reads them, and writes only through one **write gate** that
   sends nothing until a deployment, an Owner and a write token all allow it, and that has no way to merge or delete.

### Where everything is kept

No database. Everything is a file under `data/`:

| Kind | Format | Example |
| --- | --- | --- |
| Things: people, items, specs, approvals, teammates, repositories | Markdown with YAML front matter, one file each | `data/people/stevie/PERSON.md`, `data/workflows/items/PRD-031.md` |
| Settings and rules | YAML | `data/access/roles.yaml`, `data/platform/budgets.yaml` |
| The event log and the audit log | YAML, appended, one file per day | `data/events/2026/10/2026-10-11.yaml` |

Each app writes only into its own folder (`data/product/`, `data/teammates/`…). Every file is written whole, to a
temporary name and then renamed, so a crash never leaves half a file. A backup is a copy of this folder
(`npm run backup`), and `npm run seed:blank` starts a new, empty one.

### One piece of work, end to end

1. A product manager turns a signal into **IDEA-001**, scores it, and makes **PRD-001** from it.
2. On the spec page they brief the teammate (say, StevieB). Product asks Platform, then runs a teammate task;
   StevieB's draft becomes version 1. The PM edits it (version 2, by them).
3. They send it for review. The lifecycle engine opens an approval for the Approvers. An Approver approves (or
   overrides a failing readiness check with a reason, which is audited). The item moves to Architect.
4. Architecture, UX and UI follow the same way. The UI stage ends in a **handoff**: work items per repository.
5. The approved handoff becomes Jira issues (through the write gate) and Software Factory runs. Each run ends in a
   pull request with the repository's checks and reviewers.
6. People merge the pull requests in Bitbucket. NooblyJS sees the merges and moves the item to Ship. Every step is in
   Activity, the audit log and Metrics.

## Where it lives in this repo

| Path | Why it matters |
| --- | --- |
| `app.js` | The entry point: one program, set up in numbered steps |
| `src/noobly.js` | Mounts NooblyJS's own parts and loads the hosted apps |
| `src/hosted-apps.js` | Reads `data/config/hosted-apps.yaml` and calls each app's `register()` |
| `src/lifecycle/` | The seven stages, approvals and handoffs |
| `src/services/platform/` | Budgets, guardrails, model routes, repositories and the agent check |
| `src/services/devtools/` | Jira and Bitbucket: the reader, the write gate, the sync |
| `.claude/steering/` | The design: `product.md` (what), `tech.md` (how), `structure.md` (where), `roadmap.md` (in what order) |

## A small piece of code

The whole "one program" idea is in how `register()` is called for each app, `src/hosted-apps.js` lines 83 to 88:

```js
const appDir = path.join(config.dataDir, entry.mountPath.slice(1));
await fs.mkdir(appDir, { recursive: true });
const firstStart = await isEmptyDir(appDir);
const hosted = await mod.register(app, serverManager, { mountPath: entry.mountPath, dataDir: appDir, host: hostFor(appDir) });
checkHosted(hosted, entry);
if (hosted.services) services.set(hosted.name, hosted.services);
```

- Each app gets **its own data folder**, named after its mount path (`/product` → `data/product/`).
- `register()` receives the same Express app as NooblyJS (`app`), the shared `serverManager`, and a `host` object: the
  sign-in check, the permission check, the audit log, the event log, its file store, and `service(name)`.
- What it returns is checked, and its `services` are filed by name, so other apps can ask for them.

## Try it

Start NooblyJS on a throwaway folder with the sample story, and look around:

```
cd <workspace>/noobly
DATA_DIR=../noobly-try npm run seed
DATA_DIR=../noobly-try NOOBLY_DEV_LOGIN=true npm start
```

Sign in as Stevie and open Home · Lifecycle: every item, in its stage. Stop it with Ctrl+C and delete the
`noobly-try` folder when you are done. Your own `data/` is not touched.

## Words to know

- **Host**: the `nooblyjs-ai-host` program; it starts everything and owns the shared parts.
- **Hosted app**: a repository the host loads with `register()`, mounted at its own path.
- **Frame**: the one page the browser loads; apps draw only inside its content area.
- **Item**: a piece of work in the lifecycle (an idea or a spec), always in one stage.
- **Teammate**: an AI agent you hire; every agent action is one of its tasks.
- **Access role**: Viewer, Contributor, Approver, Architect, Owner; it alone decides what a person may do.
- **Work role**: Product manager, Architect, Developer…; it only chooses the layout of your Home.
- **Event log**: the append-only list of everything that happened, which Activity and Metrics read.
- **Write gate**: the one door every write to Jira or Bitbucket goes through.

## Summary: what you've learnt

- You know NooblyJS takes work from an idea to a merged pull request in seven stages, with agents drafting and people deciding.
- You know the nine repositories run as one program, with one screen, and that the host loads each app with `register()`.
- You know apps never import each other: they use services and the event log.
- You know the four places "agents propose, people decide" is enforced: tasks, Platform's check, the Contributor cap, and the write gate.
- You know everything is kept as Markdown and YAML files under `data/`, one folder per app.
