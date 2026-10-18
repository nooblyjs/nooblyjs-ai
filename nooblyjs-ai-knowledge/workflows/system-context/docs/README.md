# build-context

AI-generated **context sidecars** for a wiki space, built bottom-up.

Workflows share the one step (`steps/build-context.js`):

| Workflow | Trigger | Input |
|----------|---------|-------|
| **Context: Build Space Context (Scheduled)** | attach to a periodic schedule | `{ space, folder: "" }` — sweeps the whole space |
| **Context: Build Folder Context (On-Demand)** | `POST /api/workflows/start` | `{ space, folder }` — works down from `folder` |
| **Context: Overwrite Context (On-Demand)** | event-driven (wiki `ContextTrigger` — add/change **and** delete) | `{ space, files: [...], removedFiles: [...], force: true }` — TARGETED: only those files + their folder roll-up (see [Run modes](#run-modes)) |

## What it produces

Sidecars live under the space-root `.system/context/` namespace, mirroring the
source tree (relocated 2026-07-20 from the old per-folder `<folder>/.context/`):

```
Sell/
  Overview.md
  Architecture.md
.system/context/Sell/
  Overview.md          # full AI summary of Overview.md
  Architecture.md      # full AI summary of Architecture.md
  _folder.md           # roll-up: overview + Files list + a section per subfolder
```

- **`.system/context/<folder>/<filename>`** — the AI summary of the file (kept
  under the source file's own name, e.g. `.system/context/Sell/Overview.md`),
  saved in full — produced by the AI agent tagged **"Folder Processing"**. Reused
  when newer than the source (pass `force: true` to regenerate).
- **`.system/context/<folder>/_folder.md`** — the folder roll-up: an AI overview
  synthesised from its file summaries, a `## Files` list, and a `## Subfolders`
  section that folds in the overview of each child folder ("the home file from the
  folder below"). Because parents are processed after their children, every parent
  roll-up is informed by everything beneath it (full-sweep only — a targeted
  single-file run rebuilds just the changed file's folder roll-up).

The `.system/` directory is dot-prefixed, so the sidecars never appear in the
wiki document tree or the search index.

### Seeded folder home pages (and who owns them)

A folder with no home file (`.home.md` / `home.md` / `Home.md`) gets one: the
roll-up is copied into **`.home.md`**, so the folder has a landing page in the
wiki. Because that page describes the folder, it goes stale as documents are
added — but a page on disk carries no record of who wrote it, and overwriting
someone's hand-written landing page is far worse than leaving a stale one.

So the build records what it wrote in **`<folder>/.system/home-seed.json`**
(`{ file, hash, seededAt, updatedAt }`, the hash taken over the page content with
CRLF normalised away so a git checkout can't fake an edit). That turns a guess
into a fact:

| On disk | What happens |
|---|---|
| No home file | Seeded, and the marker is written |
| `.home.md`, hash still matches the marker | **Refreshed** — ours, untouched |
| `.home.md` edited since we wrote it | Left alone, permanently |
| `home.md` / `Home.md`, or no marker | Left alone — hand-written or unprovable |

One human edit transfers ownership of that page for good, and every failure
(marker missing, corrupt, page unreadable) lands in the same "leave it alone"
branch — the build only ever overwrites content it can prove byte-for-byte is its
own. `homesSeeded` and `homesRefreshed` in the run summary tell the two apart.

`home-seed.json` is the knowledge platform's `filePolicy.HOME_SEED_FILE` /
`toHomeSeedRelPath`, the single source of truth — keep both the name and the
hashing rule in lockstep. The platform deletes the marker along with the page
(`documentArtifacts.js`), so deleting a folder home from the folder view and
re-running the build produces a fresh one.

### Derived documents (PDFs, Office files)

Some spaces (e.g. **Standards**) are made of **PDFs**, not markdown. When the
platform ingests a binary document it extracts its text to a markdown sidecar in
the space-root `.system/derived/` namespace, mirroring the source tree and
keeping the original's FULL name plus `.md` — an uploaded `Sell/Foo.pdf` yields
`.system/derived/Sell/Foo.pdf.md` (this layout is the knowledge platform's
`shared/utils/filePolicy.js` `toDerivedRelPath`, the single source of truth; the
build's `derivedTextPathFor` mirrors it exactly). The normal walk hides the whole
`.system` directory and only summarises `.md`, so a PDF-only folder would
otherwise produce nothing.

The build folds these in. For every non-markdown document in a folder that has a
matching `.system/derived/<path>.md`, it summarises the **derived text** and
writes the per-file context sidecar under `.system/context/`, keeping the
original name plus `.md`:

```
Sell/
  Foo.pdf                              # the real document (binary)
.system/
  derived/Sell/Foo.pdf.md              # platform-extracted text (the summary INPUT)
  context/Sell/
    Foo.pdf.md                         # AI summary of the derived text
    _folder.md                         # roll-up — includes Foo.pdf alongside any .md
Sell/.home.md                          # seeded even when the folder holds only PDFs
```

Notes:
- The sidecar keeps a `.md` extension (`Foo.pdf.md`, not `Foo.pdf`) so the wiki
  content API serves it as text — a `.pdf`-named sidecar would be run through the
  PDF parser and garbled.
- A derived document is **ignored when a real markdown document of the same base
  name already exists** in the folder (that first-class `.md` wins), so a folder
  carrying both `Foo.pdf` and `Foo.md` is not summarised twice.
- Derived summaries follow the same reuse/mtime rules as markdown: a folder of
  PDFs costs AI calls once, then re-runs reuse the sidecars until the derived
  text changes.
- Set `includeDerived: false` in the input to restrict a build to markdown only.

## How it runs (and why it's built this way)

Workflow steps execute inside an **isolated `worker_threads` worker** (the core
workflow service runs every step via `workingService.start()` → `new Worker(...)`).
That worker has its OWN service registry, so `global.treeCache`, the in-memory
content cache and `global.aiInstances` are **not** the live instances the wiki
HTTP layer uses. Two consequences shaped this group:

1. **Reads go over HTTP** to the locally running backend, so they fill the
   **live** caches (the same trick the engineering-code discovery step uses for
   the schedule API):
   - `GET /applications/wiki/api/spaces/:id/folder-tree` → warms `treeCache`
   - `GET /applications/wiki/api/documents/content?...&enhanced=true` → caches doc content
2. **AI is resolved worker-safely.** Instead of `global.aiInstances`,
   `services/folderExpert.js` reads `settings-agents.json`, finds the enabled
   agent declaring the `Folder Processing` usage (or an explicit `agent`), and
   builds the client via `serviceRegistry.aiservice(provider, options)` — which
   IS available in the worker. (If the live registry happens to be present it is
   used as a fast path.)

**Writes** (the `.system/context` sidecars) are raw `fs` to the space's on-disk
`baseDir` (the worker shares the disk), so they are not re-indexed as documents.
The space → `baseDir` mapping is read from `<APP_BASE_DIR>/spaces/spaces.json`,
exactly as the wiki routes do.

Every AI and HTTP call is wrapped in a **timeout + retry** with exponential
backoff (`utilities/retry.js`).

## Run modes

The one step (`ContextProcessor`) has two entry points, chosen by the input:

- **Folder / space sweep** (`run()`) — given `folder` (or `""` for the whole
  space), walk the tree deepest-first and back up, summarising every file and
  writing each folder roll-up bottom-up so parents fold in their children. Used by
  the scheduled + on-demand folder workflows.
- **Targeted single-file** (`runFiles()`) — given `files` and/or `removedFiles`
  (all in one folder), force-summarise **only** the changed files, reuse the
  folder's other sidecars with no AI call, and rebuild **only** their folder's
  `_folder.md` (child overviews read from their existing roll-ups; no recursion).
  Cost is `(changed files) + 1` roll-up AI call. Parent roll-ups are **not**
  propagated here — the periodic sweep owns bottom-up bubble-up. This is what the
  wiki platform fires per touched document
  (`backend/src/wiki/activities/contextTrigger.js` → **Context: Overwrite Context
  (On-Demand)**), accumulating events per folder, debouncing, and draining one job
  at a time to avoid stampeding the AI.

### Deletes and cleanup

`removedFiles` is the delete half of targeted mode. A deleted path can't be
summarised — there is nothing left to read — but it identifies the folder whose
roll-up still describes it, so the run rebuilds that one roll-up for a single AI
call instead of falling back to the recursive folder walk. It accepts a removed
**folder** path too (the parent's roll-up carries its `## Subfolders` section).

Two cleanups run in **both** modes, so context never accumulates orphans:

- **Orphaned sidecars** (`pruneOrphanContext`) — any `.system/context/<name>` whose
  source document no longer exists is deleted before the roll-up is rebuilt.
  Driven off what is actually on disk rather than the `removedFiles` list, so a
  delete that raised no event (backend down, a `git checkout` under a symlinked
  repo folder, a bulk removal) is repaired by the next run over that folder.
  A sidecar name is ambiguous by construction — `x.md` belongs to `x.md`,
  `x.pdf.md` to `x.pdf` — so both candidate sources are probed and the sidecar is
  kept when either exists; a dotted markdown name (`notes.v2.md`) is never
  mistaken for an orphan.
- **Stale roll-ups** (`pruneFolderRollup`) — a folder left with no documents and no
  subfolders has its `_folder.md` removed rather than left advertising contents
  that are gone. The folder's `.home.md` is deliberately **not** touched: it is a
  visible wiki document, and deleting is unrecoverable where the refresh above
  merely rewrites. Removing a folder home is the reader's call, from the folder
  view's **Delete** button beside Edit.

On the platform side the matching artifact cleanup (the deleted document's
`.system/derived`, `.system/originals` and `.system/context` files) is done by
`backend/src/wiki/utils/documentArtifacts.js`, driven off the wiki event bus by
`backend/src/wiki/activities/artifactCleanup.js`.

## Configuration (input / env)

Input fields (all optional except `space`):

| Field | Default | Meaning |
|-------|---------|---------|
| `space` | — (required) | Space name or numeric id |
| `folder` | `""` | Start folder, relative to the space root (folder mode) |
| `files` | — | Space-relative file path(s), all in one folder → **targeted mode** (`runFiles`): re-summarise only these + their folder roll-up. `file` / `contentFile` also accepted |
| `removedFiles` | — | Space-relative path(s) that were **deleted** → also targeted mode: rebuild their folder's roll-up without them and prune their sidecars. Accepts a folder path. `removedFile` / `removed` also accepted |
| `agent` | the `Folder Processing` agent | Override the agent by name |
| `force` | `false` | Regenerate sidecars that already exist |
| `extensions` | `[".md"]` | File extensions to summarise |
| `includeDerived` | `true` | Also summarise PDFs/Office docs via their `.system/derived/<path>.md` text (set `false` for markdown only) |
| `summaryMaxChars` | `250` | Per-file summary cap |
| `folderMaxChars` | `600` | Folder overview cap |
| `aiTimeoutMs` / `aiRetries` | `0` / `3` | AI call budget — `aiTimeoutMs: 0` means **no timeout** (a slow local Ollama is never aborted mid-generation); set a positive value to re-impose a per-prompt cap |

All reads are from disk: a `path`/`contentPath` run walks that folder, and a
`space` run resolves the space to its on-disk `baseDir` (via `spaces.json`) and
reads it directly. The worker thread shares the platform filesystem, so no HTTP
call back into the backend is made — avoiding the :443 TLS/Entra self-call that
otherwise fails with "fetch failed".

> **Retired 2026-07-25:** the `useWikiApi` / `httpTimeoutMs` / `httpRetries`
> inputs and the `WikiApiClient` HTTP path are gone, along with the
> `WORKFLOW_API_URL` / `WORKFLOW_API_USER` / `WORKFLOW_API_PASSWORD` variables
> they consumed. Steps that need the backend's main process now go through the
> file-based workflow bridge (`common/bridge/workflowBridgeClient.js`). The
> trade-off is that disk reads do not warm the live tree/content caches; the next
> real user request repopulates them. If cache warming is ever needed here, add
> tree/content methods to the bridge rather than reintroducing an HTTP self-call.

Environment (from the platform `.env`):

- `APP_BASE_DIR` — application data dir holding `spaces/spaces.json` and
  `configuration/settings/settings-agents.json`. **(always required)**

## Trigger examples

On-demand, whole space:

```bash
curl -X POST http://localhost:11001/api/workflows/start \
  -H "Authorization: Bearer $WORKFLOW_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"workflowName":"Context: Build Folder Context (On-Demand)","payload":{"space":"Enterprise Collaboration Space","folder":"Technology/Engineering"}}'
```

Schedule the periodic sweep (daily at 02:30):

```bash
curl -X POST http://localhost:11001/api/workflows/schedule \
  -H "Authorization: Bearer $WORKFLOW_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"workflowName":"Context: Build Space Context (Scheduled)","cron":"30 2 * * *","name":"Build space context","payload":{"space":"Enterprise Collaboration Space","folder":""}}'
```

> New workflow groups are discovered at backend startup — **restart the backend**
> after adding this folder so the two workflows appear.
