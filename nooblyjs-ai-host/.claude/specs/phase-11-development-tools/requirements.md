# Phase 11 — Development tools: Bitbucket and Jira, read-only: requirements

> **Status: done, signed off 2026-10-10.** Summary: `.claude/phases/phase-11-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

> Source: `.claude/steering/roadmap.md` Phase 11 (added 2026-10-10, ahead of the Teams bot) and `product.md` §9.
> Goal: NooblyJS reads the tools teams already work in, and says which repositories and which Jira project an
> initiative uses. **Nothing is written to Bitbucket or Jira in this phase.**
> Repos: `nooblyjs-ai-host` (most of it), `nooblyjs-ai-product`, `nooblyjs-ai-factory`; `nooblyjs-ai-harness` is the first repository connected.

## Where the phase starts

- Source control is **Bitbucket Cloud**, workspace `acme`: hundreds of repositories in a handful of projects, one of
  which holds the NooblyJS repositories. (The organisation's real figures are not kept in this repo.)
- **Jira Cloud** has hundreds of projects. Issue types include Initiative, Portfolio Epic, Epic, Feature, Story, Task,
  Defect, Spike and Idea; fields include Story Points, Sprint, Team, Product Manager and Targetprocess ID.
- `.env` has `JIRA_SITE`, `JIRA_USERNAME`, `JIRA_API_TOKEN`, `BITBUCKET_USERNAME`, `BITBUCKET_API_TOKEN`. Both tokens
  are scoped Atlassian API tokens. What a read-only probe on 2026-10-10 found:

  | | Works | Does not work |
  | --- | --- | --- |
  | Jira | Through `api.atlassian.com/ex/jira/<cloudId>` only: projects, JQL search, an issue with all fields, comments, history and transitions, issue types, fields | The site address directly (401). Boards and sprints, and the development panel: "scope does not match" |
  | Bitbucket | With the **Atlassian email** as user: repositories of a workspace, branches, commits, source files | `BITBUCKET_USERNAME` (rejected: an email is required). Pull requests, pipelines, projects, default reviewers, branch restrictions, webhooks: scope missing. Listing workspaces |

- **Both credentials can write.** The Jira account may create, edit, transition and comment; the Bitbucket token has
  `write:repository`. NooblyJS must not rely on the credential to stay read-only.
- Platform · Repositories is seven sample repositories (`acme/…`) as files; "GitHub" is named on its screen.
  The Software Factory works on a local demo repository (`data/factory/repos.yaml`).
- Portfolios and products exist as labels in the Product Factory (`catalogue.yaml`). An item's architecture does not
  say which repositories it touches; the handoff carries only a count.

## Decisions taken before starting

Yours (2026-10-10): Bitbucket replaces GitHub; read-only first, writing in Phase 13; the first slice is
`nooblyjs-ai-harness`, then Digital Commerce. **No writes to Jira or Bitbucket, in tests either**: unit tests use a
fake `fetch` and never reach the network. The Jira project to start with is **DTE "TSS - Engineering"**. The tokens
in `.env` were replaced with read-only ones (Bitbucket confirmed: five `read:` scopes; Jira's scopes cannot be read
back, and its account may still edit issues, so NooblyJS's own lock is what counts). And **we eat our own dog food**:
the first real initiative through NooblyJS is a product entry to make `nooblyjs-ai-harness` autocomplete when you type a
forward slash, with the Software Factory working on our own repository instead of a demo one (R7).
The rest are mine, for your confirmation.

| Question | Answer |
| --- | --- |
| How "read-only" is kept | **By construction.** Each connector has one function that talks to the network, and it can only send `GET` to two fixed hosts (`api.atlassian.com`, `api.bitbucket.org`). There is no parameter for a method or a body. A test tries to make it write and must fail before any request leaves. Read-only tokens are still asked for (below), as a second lock |
| Credentials | Stay in `.env`, never in `data/`. The Bitbucket user is `BITBUCKET_EMAIL` if set, else `BITBUCKET_USERNAME` when it is an email, else `JIRA_USERNAME` (the same Atlassian account). `BITBUCKET_WORKSPACE` defaults to `acme` |
| Tokens to ask you for | Read-only ones. Bitbucket: `read:repository`, `read:pullrequest`, `read:pipeline`, `read:project`, `read:workspace`. Jira: the read scopes it has, plus the Jira Software (board and sprint) read scope. Until then pull requests, pipelines and sprints say "this token cannot read …" and everything else works |
| Which repositories and Jira projects NooblyJS may see | A list in `data/config/devtools.yaml`: Bitbucket projects and repositories to import, Jira project keys to search. It starts with the repository `nooblyjs-ai-harness` and the Jira project `DTE`. An Owner changes it (`PATCH /api/v1/devtools/config`) |
| The sample repositories | Stay, marked as sample, so the seed story still works. Imported ones are marked "Bitbucket" and link to it |
| Where an initiative's repositories are set | Three levels: Platform is the catalogue and agent access; a **product** has default repositories and a Jira project; an item's **Architecture** confirms or narrows them. The handoff and the Software Factory use the item's list |
| Which way links point | NooblyJS points at Jira: an opportunity, spec or work item holds the keys of its Jira issues. Nothing is stored in Jira |
| Freshness | Reads are cached in memory for 5 minutes and refreshed on demand. A repository's branch and last commit are also kept in its Platform file, so the list works when Bitbucket is unreachable |
| Agents | Agents get the same reads as tools, through `host.service('devtools')`, checked by Platform's repository access and audited |
| Dogfooding safely | The Software Factory works on a **local clone** of `nooblyjs-ai-harness` (the sibling folder is never touched: it clones from it into `data/factory/repos/`), on an agent branch that is **never pushed**. The result is a diff and a ready branch to look at; opening a pull request on Bitbucket is Phase 13. `[CONFIRM]` it needs a real model configured to write real code; with none it plays the scripted run |
| Tests | Offline, with a fake `fetch` and recorded response shapes (no company content). `npm run test:live:devtools` makes real GET requests |
| TLS | `.env` sets `NODE_TLS_REJECT_UNAUTHORIZED=0`. The connectors use the operating system's certificate store (as sign-in already does), so that setting is not needed for them |

## Requirements

### R1 — Connectors that cannot write
1. A Jira connector and a Bitbucket connector SHALL expose only read operations, and send only `GET` requests to their fixed host.
2. A request to any other host, or built from an absolute URL in a response (`next` links) that leaves the host, SHALL be refused.
3. A token SHALL never be logged, returned by an API, written to `data/` or shown on a screen.
4. A missing or refused credential SHALL make that tool "not connected", with the reason, and the rest of NooblyJS works.
5. A read the token's scopes do not allow SHALL be reported as such ("this token cannot read pull requests"), not as an error page.

### R2 — Integrations on Platform
1. Platform · Settings · Integrations SHALL show Jira and Bitbucket: connected or not, the account, the site or workspace, and what the token can and cannot read, with a warning when the token can also write.
2. An Owner SHALL set which Bitbucket projects and repositories are imported and which Jira projects are searched; the change is audited.

### R3 — Repositories from Bitbucket
1. Platform · Repositories SHALL list the imported Bitbucket repositories with project, main branch, language, last commit, and open pull requests when readable, each linking to Bitbucket.
2. Agent access (read, branches, pull requests, never merge) SHALL stay NooblyJS's own record, starting at read-only for an imported repository.
3. A repository that disappears from Bitbucket SHALL be shown as gone, not deleted.

### R4 — An initiative's repositories and Jira project
1. A product SHALL have default repositories and a Jira project, set by anyone who may draft.
2. An opportunity or spec SHALL start with its product's defaults.
3. Architecture SHALL confirm or change the item's repositories, choosing from Platform's catalogue.
4. The handoff SHALL list exactly the item's repositories, and the Software Factory SHALL start runs only on those.

### R5 — Jira, read
1. A person with `draft` SHALL search Jira (within the configured projects) and link issues to an opportunity, a spec or a work item.
2. An item SHALL show its linked issues with type, status, assignee, and sprint when readable, each linking to Jira, and a refresh shows changes made in Jira.
3. The Software Factory SHALL show the Jira issue of a work item next to its run.

### R7 — Our own repository, end to end
1. A product "NooblyJS Harness" SHALL exist with the repository `acme/nooblyjs-ai-harness` and the Jira project `DTE`, and an opportunity "Slash-command autocomplete" in it, linked to its Jira issue when one exists.
2. The Software Factory SHALL be able to run that item's work items on a local clone of the repository, on a branch, without pushing, and never on the sibling working folder.
3. Nothing in that flow SHALL write to Bitbucket or Jira.

### R6 — Agents
1. A teammate SHALL be able to search and read Jira issues, list a repository's branches, commits and pull requests, and read a file, as tools.
2. Each tool call SHALL pass Platform's `checkAgentWork` for the repository and be audited with actor, item and system.

## Test script (roadmap Phase 11)

1. Platform · Settings · Integrations shows Jira and Bitbucket connected, with the account and what it can read.
2. Platform · Repositories lists `nooblyjs-ai-harness` from Bitbucket with its main branch and last commit.
3. Give the product "Delivery" a Jira project and a repository; a new opportunity in it starts with both.
4. In Architecture, narrow the item's repositories; the handoff shows exactly those.
5. Link a Jira issue to an item; its status and assignee show on the item and change when it changes in Jira.
6. Ask a teammate in chat "what is open in Jira for this item?"; the answer cites the issues, and the read is in the audit log.
7. Try to make the connector send anything but a GET (a test does this): it is refused before any request leaves NooblyJS.

**Done when:** steps 1–7 pass, and the Jira and Bitbucket audit logs show no write by NooblyJS.

## Out of scope

Creating or changing anything in Jira or Bitbucket (Phase 13). Cloning repositories or running the Software Factory on
a real one. Webhooks (NooblyJS polls on demand). Targetprocess. Indexing Bitbucket into Knowledge.
