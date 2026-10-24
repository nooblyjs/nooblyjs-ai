# nooblyjs-ai-teammate: how teammates are managed

**Lesson 02 · about 15 minutes · 2026-10-24**

## What you'll learn

- How Digital Teammates manages named AI agents: their profiles, skills, knowledge and memory.
- The data model: Markdown files with YAML front matter for structured data, prose for instructions.
- How the services layer (composition root) wires together the models, providers and business rules.

## The idea, in plain words

Think of Digital Teammates like an employment agency for AI agents. When you hire someone, they get:

- A **profile** with a name, avatar, job title and a persona (how they think and communicate)
- **Skills**: reusable instruction sets they're trained in (like "deep research" or "React components")
- **Knowledge documents**: reference material they read when working (policy docs, codebase READMEs, pricing sheets)
- **Memory**: things they've learned from past work that help them be better next time
- A **model choice** (Haiku, Sonnet, Opus) that determines their cost and capability
- An **hourly rate** and a **monthly budget**
- A **timesheet** that records every hour they work and what they earned

When work comes in, the system picks the right skills for the task, finds relevant knowledge and memories, builds a prompt that includes all three, sends it to the model, and then records what was learned. Over time, teammates get smarter because they remember what they've done before.

## Where it lives in this repo

| Path | Why it matters |
| --- | --- |
| `src/models/` | The data layer. `fs-store.js` reads and writes Markdown files atomically. `teammates.js`, `skills.js`, `knowledge.js`, `memory.js`, `timesheets.js` are repositories—access patterns for each entity type. |
| `src/services/team.js` | `TeamService`: manages the roster, hiring, status changes (available/paused/retired), and derives team-wide numbers (hours billed, budget used). |
| `src/services/invocation.js` | `InvocationService`: runs a task. It picks skills (BM25 search if many), finds knowledge passages, builds the prompt, calls the provider, writes memory, logs the work. |
| `src/services/billing.js` | `BillingService`: logs time entries to timesheets (one file per teammate per month), calculates costs, tracks warnings when budgets approach limits. |
| `src/services/providers/` | `Anthropic`, `Mock`, etc. One provider per model vendor. Code only knows the `Provider` interface; it never names a model by ID. |
| `src/services/core/` | Wires up nooblyjs-core services: logging (to files), caching (for parsed Markdown), queueing (for webhooks), scheduling (for recurring tasks), and live event notifications. |
| `index.js` | The composition root. It creates everything (`FsStore`, repositories, services, providers) and returns a description of the app for NooblyJS. |
| `public/js/pages/profile.js` | The profile page in the browser. Shows the teammate's details, knowledge documents, memories, and settings. |

## A small piece of code

**`index.js:85–145`** — The composition root (building everything):

```javascript
// Create the file store (Markdown files in dataDir)
const store = storeFor(host, dataDir, { cache: core.cache, cacheable });

// Create repositories (access patterns for each entity type)
const repos = createRepos(store);

// Create services (business rules)
const team = new TeamService(repos, core);
const invocation = new InvocationService(repos, providers, core);
const billing = new BillingService(repos, core);
const alerts = new AlertService(repos, billing, core);

// Wire up events: when a task finishes, emit an event
// so the browser can show live updates
const events = new EventBus(core.notify);

// Mount the router with all services
app.use(mountPath, createRouter(repos, { team, invocation, billing, ... }));

return { name: 'teammates', nav: NAV, status, services: hostTasks, seed, close };
```

Every service gets what it needs: the repositories (data access), other services (dependencies), and core services (logging, caching). This layered, testable structure means you can test `BillingService` without running the whole app.

**`src/services/invocation.js:150–190`** — Building a prompt for a task:

```javascript
// Pick skills relevant to the task (BM25 search if more than 4)
const skills = pickSkills(teammate.skills, input);

// Find knowledge passages using BM25 (full-text search)
const knowledge = await repos.knowledge.search(teammate.id, input, { maxTokens: 1500 });

// Find memories (pinned ones first, then by recency)
const memories = await repos.memory.find(teammate.id, { project, pinned: true });

// Build the prompt
const prompt = [
  { role: 'system', content: teammate.persona },        // "You are Ada, a research analyst..." 
  ...skillsAsSystem(skills),                            // Skill instructions
  { role: 'user', content: knowledge },                 // Reference material
  { role: 'user', content: memories },                  // What they've learned
  { role: 'user', content: input.task }                 // The actual request
];

// Call the model
const response = await provider.complete(prompt);

// Write memory: record up to 3 facts/preferences the teammate should remember
await writeMemory(teammate, input, response);
```

This shows the pattern: every piece of context (skills, knowledge, memories) is layered into the prompt. The model sees everything it needs to do the best work.

**`src/models/fs-store.js:50–80`** — Atomic writes (why files are safe):

```javascript
// Write a file atomically: temp + fsync + rename (never corrupt)
async write(segments, frontMatter, body) {
  const filePath = this.resolvePath(segments);
  const tempPath = filePath + '.tmp';
  
  // Write to temp file
  const content = `${toYaml(frontMatter)}\n${body}`;
  await fs.writeFile(tempPath, content);
  
  // Ensure it's on disk
  const fd = await fs.open(tempPath, 'a');
  await fd.fsync();
  await fd.close();
  
  // Atomic rename
  await fs.rename(tempPath, filePath);
}
```

This is why the data folder can be backed up or put under git safely: every write either happens completely or not at all. A crash mid-write leaves only a temp file, never a corrupted entity.

## Try it

Start NooblyJS, open `/teammates`, and explore:

1. **Team roster** (`/team`): See the eight teammates with their skills, rates, and status.
2. **Profile** (`/team/ada-quill`): Click Ada's name to see her full persona, knowledge documents, and memories. Notice the "Memory mode" toggle—it controls whether each teammate has private memory or uses shared team memory.
3. **Billing** (`/billing`): See the timesheet for the current month. Click an entry to see who asked, what was done, and the cost.

Then check the data:

```bash
# See Ada's profile
cat ../nooblyjs-ai-host/data/teammates/ada-quill/TEAMMATE.md

# See her knowledge documents
ls ../nooblyjs-ai-host/data/teammates/ada-quill/knowledge/

# See her monthly timesheet
cat ../nooblyjs-ai-host/data/teammates/ada-quill/timesheets/2026-10.md
```

## Words to know

- **Profile** (`TEAMMATE.md`): YAML front matter (name, model, rate, budget, persona mode) and Markdown body (persona prompt).
- **Skills**: Reusable instruction sets shared by all teammates. BM25 picks the relevant ones for each task.
- **Knowledge**: Reference documents tied to a teammate (policy, codebase docs). Searched full-text for each task.
- **Memory**: Things a teammate learns and remembers (facts, preferences, sources). Pinned items are kept; old ones are merged.
- **FsStore**: The file store. Every write is atomic (temp → rename), serialized (per-file locks), and cached by modification time.
- **Provider**: The interface to a model vendor (Anthropic, Mock, etc.). Code never names a model; it picks a provider.
- **Composition root**: `index.js`. It builds all services and returns a description of the app.
- **Hosted app**: Teammates runs inside NooblyJS. It gets services (logging, caching, queueing) from `nooblyjs-core`.
- **Timesheet**: A monthly Markdown table of time entries (who asked, what was done, hours, cost).
- **Approval threshold**: The cost limit. Tasks over this threshold wait for owner approval.

## Summary: what you've learnt

- **Digital Teammates is a people-management system for AI agents.** Each agent (teammate) is hired, given skills, knowledge, memory, a model, a rate and a budget.
- **The data model is Markdown files with YAML front matter.** Structured data (config) goes in front matter; prose (persona, skills, knowledge) goes in the body. Everything is git-safe.
- **The system is layered: routes → controllers → services → models → providers.** Each layer has one job. Tests can mock any layer.
- **Teammates are composites.** A task uses that teammate's skills, knowledge, memories and persona. The system picks what's relevant for each request.
- **Writes are atomic and cached.** Files are written temp→rename, so nothing can corrupt. Parsed Markdown is cached by modification time.
- **The composition root wires everything.** `index.js` creates the store, repositories, services and providers, then returns the app to NooblyJS.
- **Every teammate is a person.** They have a profile, a job, a voice, memory and a timesheet. They're not anonymous API calls.
