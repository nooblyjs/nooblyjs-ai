# Phase 11 — Development tools: Bitbucket and Jira, read-only: summary

**Status:** done. Built 2026-10-10 and signed off the same day. Spec: `.claude/specs/phase-11-development-tools/` (all 10 tasks
done). Work is in `nooblyjs-ai-host` (most of it), `nooblyjs-ai-product` and `nooblyjs-ai-factory`. **Nothing was written to Jira or
Bitbucket**, by the code or by the tests: every request NooblyJS can make to them is a GET.

To see it: `npm start` (or `npm run electron`). Platform · Settings · Integrations shows both tools; Platform ·
Repositories lists `acme/nooblyjs-ai-harness` from Bitbucket; the Product board has the product **NooblyJS Harness**
and the opportunity **OPP-022 · Slash-command autocomplete in the harness**.

## Before you started (your answers)

- Bitbucket replaces GitHub everywhere; read-only first, writing in Phase 13; the Teams bot moved to Phase 12.
- Start with `nooblyjs-ai-harness`, and eat our own dog food: the first real item is slash-command autocomplete in the
  harness, built by the Software Factory on our own repository, safely.
- The Jira project is **DTE "TSS - Engineering"**. No writes, in tests either. The tokens in `.env` are read-only.

## What is there

| Area | What |
| --- | --- |
| Read-only by construction | `src/services/devtools/transport.js` is the only code that calls Atlassian. A reader is bound to one https origin and sends GET with no body; another host, a path trick or a `next` link elsewhere is refused before a request leaves. A test reads the folder's source to prove there is no other way out |
| Jira | Through `api.atlassian.com` with the site's cloud id (scoped tokens don't work on the site itself). Search takes a filter, never JQL, always inside the configured projects |
| Bitbucket | Repositories of a project or by name, branches, commits, files, pull requests and pipelines. A read the token's scopes don't allow is said with the scope it needs |
| Integrations | Platform · Settings · Integrations: connected · read only, the site or workspace, what the token reads and cannot, and a warning when the token or account could write |
| Repositories | Imported from Bitbucket at start and with **Refresh from Bitbucket** (Owners). A repository's panel shows its project, branches, latest commits and open pull requests, live. Agent access stays NooblyJS's own and starts read-only; one that leaves Bitbucket is marked gone. The seven sample repositories stay, marked Sample |
| Where an item is built | A product has default repositories and a Jira project (Portfolios & products panel, anyone who may draft). New opportunities and specs start with them. Architecture has a **Repositories** tab: the item's repositories, each with Remove, and a search over Platform's repositories to add more; each change saves at once (people only). The handoff refuses a work item outside the list; the lifecycle engine keeps the list on the handoff; the Software Factory's intake refuses one too |
| Jira on the item | Home · Lifecycle · an item has a Jira card: its linked issues with status, assignee, sprint and points, read live; link by key or search; unlink; Refresh from Jira. Links are NooblyJS's (`data/devtools/links.yaml`); a spec made from an opportunity takes its links |
| Agents | Asked in chat about Jira, the code or a repository, a teammate reads them through the devtools service: Platform's check first for a repository, every read audited (`agent.devtools_read`), the issues cited. With no model configured the answer is built from what was read |
| Dogfood | Product **NooblyJS Harness** (portfolio Digital Platforms) built in `acme/nooblyjs-ai-harness`, Jira DTE; **OPP-022**. `data/factory/repos.yaml` maps `nooblyjs-ai-harness` to `<workspace>/nooblyjs-ai-harness`: the Software Factory only fetches from that folder into its own mirror, works on branches there, and denies `git push` |

I created NooblyJS Harness and OPP-022 in your `data/` through NooblyJS's own API, signed in as you, on a temporary NooblyJS
(port 11298, stopped afterwards), so they are audited like any person's change. I wrote `data/factory/repos.yaml` by
hand (it is the operator's file).

## Added while trying it out (2026-10-10)

- **Architecture · Repositories** is its own tab: the item's repositories with Remove, and a search over Platform's
  repositories with Add. Each change saves at once.
- **Architecture · Knowledge** (before Repositories): search the Knowledge Repository for files and folders, link
  them with a note on what each is for ("Data relating to application standard"), edit the note, remove a link.
  Shown as `[Space]\\path`. The Software Factory puts each link's note, location and text into every work item
  of the item's handoff. Knowledge gained `find`, `locate` and `contextOf` for this.

## Test script result (roadmap Phase 11)

| Step | Result |
| --- | --- |
| 1. Integrations shows Jira and Bitbucket connected, with what each can read | Pass, on your real tokens: Bitbucket reads repositories, pull requests and pipelines (five `read:` scopes, no write); Jira reads issues in DTE, not boards and sprints |
| 2. Repositories lists `nooblyjs-ai-harness` with its branch and last commit | Pass, on the real repository (main, last commit 9 Oct) |
| 3. A product's Jira project and repository; a new opportunity starts with both | Pass (OPP-022 did) |
| 4. Architecture narrows the repositories; the handoff shows exactly those | Pass (API and browser) |
| 5. A linked issue shows its status and assignee, and follows Jira | Pass with a fake Jira. Not yet on the real one: DTE has no issue for this work, and NooblyJS can't create one |
| 6. A teammate answers "what is open in Jira", cites the issues, and the read is audited | Pass with a fake Jira |
| 7. The connector cannot send anything but GET | Pass: refused before any request leaves, and every request in the API test run was a GET |

Tests: `test/services/devtools.test.js` (10), `test/devtools.test.js` (7), a lifecycle handoff test, the Product
Factory's catalogue and handoff tests, the Factory's intake test, and `test/e2e/devtools.spec.js` plus a portfolios
spec (axe, 375px). `npm test`: 247 of 247 in nooblyjs-ai-host, 148 of 148 in nooblyjs-ai-product; the Factory's intake file 8 of 8.
`npm run test:live:devtools` passes on the real tools (GET only). The five long e2e stories were not rerun.

## The end-to-end walk, on our own repository

1. Create the issue in Jira DTE yourself (NooblyJS only reads Jira), then link it on OPP-022's item page.
2. On the Product board, make OPP-022's spec and take it through review; in Architecture confirm
   `acme/nooblyjs-ai-harness`.
3. In Platform · Repositories, as an Owner, set the harness's agent access to **Read + open PRs** (the Factory needs it).
4. Through UX and UI to the handoff: one work item on `nooblyjs-ai-harness`.
5. The Software Factory needs a model to write real code (`AI_PROVIDER`); with none, a work item with no script waits
   and says so. The harness has no `.factory/config.json`, so no gate is declared yet; add one (its `npm test`) first.
6. The result is a branch in `data/factory/repos/`, not on Bitbucket. Opening the pull request is Phase 13.

## Decisions I took, for you to confirm

1. Links to Jira issues are NooblyJS's, kept by item, opportunity or work item, not a field on each app's records.
2. Confirming an item's repositories is for people only, as a decision; agents may propose in chat.
3. An item with no repositories (the seed story) still hands off anywhere, as before.
4. "Jira not connected" when linking is a 409, not a server error.
5. The Jira card's search uses words; a key links straight away.

## What is not real yet

- No webhooks: Jira and Bitbucket are read on demand and cached for five minutes.
- Sprints: the Jira token cannot read boards and sprints (needs the Jira Software read scope).
- The account behind the Jira token may edit issues in Jira; the token's scopes can't be read back. NooblyJS's own
  lock is what keeps it read-only, and Integrations says so.
- The Software Factory's model and the harness's gate are not set up (see the walk, steps 5 and 6).
