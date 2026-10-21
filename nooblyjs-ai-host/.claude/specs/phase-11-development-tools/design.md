# Phase 11 — Development tools: design

> **Status: done, signed off 2026-10-10.** Summary: `.claude/phases/phase-11-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

> Requirements: `requirements.md`. Steering: `product.md` §9, `tech.md` §9, `structure.md` §2a.

## Shape

```
.env (tokens) ─► src/services/devtools/
                   transport.js   the only code that calls fetch: GET, two fixed hosts, timeout, no body
                   jira.js        myself · projects · search(jql) · issue(key) · boards/sprints (when readable)
                   bitbucket.js   repositories(project) · repository · branches · commits · file · pullRequests · pipelines
                   index.js       status() · config (data/config/devtools.yaml) · 5-minute cache · host.service('devtools')
                 src/routes/devtools.js   /api/v1/devtools/…  (all GET, plus PATCH config for Owners)
```

`host.service('devtools')` is what the Product Factory, the Software Factory and Teammates call. No child app
holds a token or talks to Atlassian itself.

## Read-only by construction

`transport.js` exports `createReader({ host, authorization, fetch })` → `read(path, query)`. It builds the URL from a
fixed origin, refuses a path that is not relative or that changes the origin, and calls
`fetch(url, { method: 'GET', headers, signal })` with nothing else. Connectors receive only `read`. Paging follows a
response's `next` link only after checking it has the same origin. There is no other network code in the folder, and
a test reads the folder's source to assert it (no `method:` other than `'GET'`, no `body`).

Errors become values, not exceptions on a screen: `{ ok: false, reason: 'not-configured' | 'unauthorised' |
'scope' | 'not-found' | 'unreachable', scope?, message }`. A 403 from Bitbucket names the scope it wanted; that is
passed on as "this token cannot read pull requests (needs read:pullrequest:bitbucket)".

## Jira

Scoped tokens only work at `https://api.atlassian.com/ex/jira/<cloudId>`. The cloud id comes from
`https://<JIRA_SITE>/_edge/tenant_info`, read once (a third fixed host for that single path) and kept in memory.
Search uses `GET /rest/api/3/search/jql` with a JQL that always has the configured project keys in front
(`project in (…) AND (…)`), so a search cannot reach outside the slice. An issue is returned as NooblyJS's own shape:
`{ key, url, type, summary, status, statusCategory, assignee, parent, sprint?, storyPoints?, updated }`; field ids for
Sprint and Story Points are looked up by name from `/field` once.

## Bitbucket

`GET /2.0/repositories/<workspace>?q=project.key="DT"` and per repository `…/refs/branches`, `…/commits`,
`…/src/<commit>/<path>`, `…/pullrequests`, `…/pipelines`. A repository becomes
`{ name: 'acme/nooblyjs-ai-harness', project, branch, language, lastCommit: { hash, at, message, author }, url }`.

## Platform

- `data/config/devtools.yaml`: `{ bitbucket: { workspace, projects: [], repositories: ['nooblyjs-ai-harness'] }, jira: { projects: [] } }`.
- Import writes or updates a repository file in `data/platform/repositories/` with `source: bitbucket` and the
  snapshot; access fields are only set when the file is new (read-only). The seed's files keep `sampleData: true`.
- The Integrations tab gets real rows for Jira and Bitbucket from `devtools.status()`.

## An initiative's repositories and Jira project

- Product Factory `catalogue.yaml`: a product gains `repositories: []` and `jiraProject`.
- Opportunity and spec records gain `repositories: []`, `jiraProject` and `jiraIssues: []`, copied from the product
  when created.
- Architecture (the item's architecture artefact) owns the final `repositories` list; its screen has a
  "Repositories" card with labels chosen from Platform's catalogue (the same label control as portfolios).
- The handoff passes `repositories` (not just a count); the Software Factory's intake maps a work item to a
  repository from that list and refuses one outside it.

## Agents

`host.service('devtools').tools(context)` returns tool definitions (`jira_search`, `jira_issue`,
`bitbucket_commits`, `bitbucket_pull_requests`, `bitbucket_file`) whose handlers call the same reads after
`platform.checkAgentWork({ repo, needs: 'readCode' })` and write an audit record. Teammates' `runTask` passes them
to the model; the scripted (no model) path answers from the same reads, so step 6 works offline.

## Tests

- `test/services/devtools.test.js`: the transport refuses everything but a relative GET on its host; scope and
  auth failures become reasons; Jira search is always inside the configured projects; shapes from recorded fixtures.
- `test/devtools.test.js`: the seven steps through the API with a fake `fetch` injected into `createApp`.
- `test/e2e/devtools.spec.js`: Integrations, Repositories, the product's defaults, the Architecture card, with axe.
- `test/live/devtools.live.js` (`npm run test:live:devtools`): real GET requests to both tools.
