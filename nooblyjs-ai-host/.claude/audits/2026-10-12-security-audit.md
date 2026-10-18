# Security audit — all of NooblyJS (2026-10-12)

> **Verdict: not safe to run anywhere other people can reach it, until S-01 to S-03 are fixed.** S-01 lets anyone who
> can reach the port, signed in or not, download any file in the `nooblyjs-ai-host` folder (including `.env`, with the Jira,
> Bitbucket and Entra secrets) and re-point the reader at any folder on the machine. NooblyJS listens on 127.0.0.1 by
> default and nothing was listening while this was written, so as far as this audit can tell it has not been exposed;
> see S-01 for what to check.
>
> Companion: `2026-10-12-production-readiness-audit.md`. Earlier review: `docs/security/phase-13-review.md` (this audit
> covers what it did not: the hosted apps, nooblyjs-core's own routes and the sibling repos' dependencies).

## How it was done

- **Every route, called for real.** NooblyJS was started with all five hosted apps on a throwaway data folder (the seed
  story), with every outbound network call blocked (nothing could reach Jira, Bitbucket, Microsoft or a model). A probe
  recorded each route registered on any Express router (971), then called each one **signed out** and, for every write,
  **signed in as Naledi K. (Viewer, the lowest access role)**. Anything that answered instead of refusing was followed up
  by hand. S-01 was repeated with `NODE_ENV=production`.
- **Code reading** of the composition root (`app.js`, `src/noobly.js`, `src/config.js`, `src/middleware/`), the Teams bot's
  token check and connector, the Electron window, the Edge extension, the hosted apps' route guards, the wiki's workflow
  engine and Markdown rendering.
- **`npm audit --omit=dev` in all eight repos**, and a search of every repo's tracked files for committed secrets.
- Not done: a penetration test, a review by anyone outside the build, load or fuzz testing, the Teams app in a real
  tenant. `[CONFIRM: an independent review before production]` still stands.

The probe and its raw results are not in the repository (they were run from a scratch folder). Recommendation S-01.5
turns the probe into a test.

## Summary

| ID | Severity | Finding | Where |
| --- | --- | --- | --- |
| S-01 | **Critical** | Anyone, signed out, can read any file in the `nooblyjs-ai-host` folder (`.env` included) and point the file reader at any folder | nooblyjs-core filing API |
| S-02 | **High** | The wiki's older routes check only that you are signed in: a Viewer can edit, delete and automate | nooblyjs-ai-knowledge |
| S-03 | **High** (Critical while others use a development instance) | A wiki workflow step runs its author's JavaScript in `node:vm`, which is not a sandbox; on by default outside production | nooblyjs-ai-knowledge |
| S-04 | **High** | Known-vulnerable dependencies: 3 critical and 9 high in nooblyjs-core, 13 high in the wiki; NooblyJS's own audit cannot see them | nooblyjs-core, nooblyjs-ai-knowledge |
| S-05 | **High** | Password sign-in stays open beside Microsoft sign-in, and `admin@localhost` keeps its password in a file in `data/` | nooblyjs-core authservice, `app.js` |
| S-06 | Medium | Rate limiting covers `/api/` only: the hosted apps' APIs and `/services` have none | `app.js:169` |
| S-07 | Medium | The wiki renders Markdown to HTML without sanitising it; the Content-Security-Policy is the only barrier | nooblyjs-ai-knowledge front end |
| S-08 | Medium | Wiki and Jira text, and repository files, reach agents' prompts; the wiki's own agents bypass Platform's checks | knowledge, devtools, Factory |
| S-09 | Medium | A Viewer can set the wiki AI endpoint and key the server calls, and mint a 24-hour bearer token | nooblyjs-ai-knowledge |
| S-10 | Medium | `data/` and backups are not encrypted, and hold personal data, the audit log and password hashes | storage, backups |
| S-11 | Medium | An audit record is written after the response and its failure is only logged | `src/middleware/audit.js:9` |
| S-12 | Low | Several unauthenticated status endpoints say more than they need to | nooblyjs-core, Teammates |
| S-13 | Low | `deprecated`: Entra sign-in runs on `passport-azure-ad` | nooblyjs-core |
| S-14 | Low | Request bodies up to 10 MB on every route | `app.js:115` |
| S-15 | Low | The Electron window accepts any certificate for its local address | `apps/electron/main.js:183` |
| S-16 | Low | Two routes sign a person out when they are refused | nooblyjs-core, Teammates |

What held up is listed at the end ("What passed"). It is most of NooblyJS.

---

## Critical

### S-01 — Signed-out file read and reconfiguration through nooblyjs-core's filing API

**What.** nooblyjs-core mounts a filing API at `/services/filing/api/…` (download, upload, file tree, settings, git and sync).
In NooblyJS it answers anyone:

| Request (signed out) | Result |
| --- | --- |
| `GET /services/filing/api/download/.env` | **200, 9,294 bytes: the real `noobly/.env`** (contents not opened by this audit) |
| `GET /services/filing/api/download/package.json` | 200 |
| `GET /services/filing/api/instances`, `/settings`, `/file-tree`, `/analytics` | 200 |
| `POST /services/filing/api/settings` `{ "baseDir": "<another folder>" }`, with a CSRF token from any page | **200 OK**; the next download read a file from that folder |
| `DELETE /services/filing/api/analytics` | 200 |
| `POST /services/filing/api/git/commit`, `/sync/files`, `/sync/notify-change`, `/upload/…` | 400 (input), not 401: the request is accepted for processing |

The same results with `NODE_ENV=production`. The CSRF check does not help: it proves the request came from a page that
could read the cookie, and anyone can get one by opening `/login`.

**Why.** Two halves that each assume the other checks:

- `nooblyjs-core/src/authservice/middleware/services.js:257` exempts `/filing/api/` from the `/services` guard, because
- `nooblyjs-core/src/filing/routes/index.js:71` is meant to apply `options.authMiddleware` — but nothing passes one, and the
  fallback is `(req, res, next) => next()`: it **fails open**.
- `nooblyjs-core/src/filing/providers/filingLocal.js:39` defaults `baseDir` to `'./'`, the process's working folder. Started
  with `npm start`, that is the `nooblyjs-ai-host` folder: `.env`, `data/`, the code.

**Exposure today.** NooblyJS binds `127.0.0.1` unless `HOST` is set (`src/config.js`); `.env` has no `HOST`, and nothing was
listening on 11001 during the audit. A page in your browser cannot read the answer (no CORS header). So the open
question is whether NooblyJS was ever reachable from elsewhere: `HOST=0.0.0.0` at any time, a reverse proxy, a dev tunnel
(the Teams Agents Toolkit's F5 opens one; check it pointed at the 3978 forwarder only), or the Electron/remote
setups. `[CONFIRM]`

**Fix.**
1. Make the filing routes fail closed: no `authMiddleware` → refuse every request (`nooblyjs-core`).
2. In NooblyJS, pass `requireSignIn` as the filing API's `authMiddleware`, and put settings, git, sync and analytics-delete
   behind core's admin check (Owners). Better still: NooblyJS does not use these routes for its own pages — do not mount
   core's filing HTTP API at all when hosted, and let the wiki reach filing in-process.
3. Default `baseDir` to a folder inside `DATA_DIR`, never the working folder, and refuse a `baseDir` outside `DATA_DIR`.
4. If any exposure is found under "Exposure today", rotate everything in `.env` (`docs/runbooks/tokens.md`) — the Jira
   and Bitbucket tokens first, since those are production systems.
5. Keep the probe: a test that starts NooblyJS with every hosted app and asserts that every route answers 401/403/404 to a
   signed-out caller (an allow-list for `/healthz`, `/login`, the sign-in pages and scripts), and that every write
   refuses a Viewer unless listed. It found this in one run; it will find the next one.

---

## High

### S-02 — The wiki's older routes have no permission checks

**What.** The hosted wiki (`nooblyjs-ai-knowledge`) applies `host.auth` (signed in) to everything under `/wiki/api/v1`
(`index.mjs:81`), but only the Phase 8 Knowledge routes then ask NooblyJS's permission matrix
(`src/wiki/knowledge/access.js`). The several hundred routes the wiki brought with it ask nothing more. Signed in as a
**Viewer**:

- 12 writes succeeded outright, among them: save AI settings, mint an extension token, rebuild the search index,
  clear execution history, cancel executions, delete the MCP config, clear the tree cache.
- 135 more got past every access check and failed only on the probe's dummy input (400/404), i.e. they would have
  worked with real input: edit a document (`PUT …/ds/content/markdown/{*path}`), create, change and delete spaces,
  connections, workflows, schedules, agents and notifications; import a workflow; run one now.
- 16 were refused (the wiki's own admin checks).

**Why it matters.** Viewer is what everyone gets on first Microsoft sign-in (`roles.yaml` `newPersonRole`), so with
Entra on this is anyone in the tenant. Product, Factory, Infrastructure, Teammates and the lifecycle engine all refused
the same Viewer every write (403); the wiki is the exception.

**Fix.** One guard in front of the wiki's API when hosted: every non-GET needs `draft`, and the admin-type routes
(settings, connections, schedules, agents, workflows, spaces, MCP, cache, index rebuild) need `change-repo-access` or a
new `manage-knowledge` permission. Then narrow per route. Add the wiki to the probe test of S-01.5.

### S-03 — Workflow code runs in `node:vm`, which is not a sandbox

**What.** A wiki workflow's `transform` and `conditional` steps run the author's JavaScript with `node:vm`
(`src/datasources/components/workflowExecutor.js:614`, `executeSandboxedCode` at 775). The code's own comment says it:
`node:vm` "is NOT a security sandbox … a workflow author can escape … and achieve RCE with full server privileges".
It is **off in production** unless `WORKFLOW_CODE_EXECUTION=enabled` (line 786), and **on everywhere else**.

**Why it matters.** NooblyJS runs in development mode today. With S-02, any signed-in person can create such a workflow,
and code that escapes runs as the NooblyJS process: it can read `process.env` (`.env` is loaded into it), `data/`, and
everything the account can reach. The escape itself was not attempted in this audit; the path to it was (S-02).

**Fix.** Default it off everywhere (opt in per environment), allow authoring code steps only to Owners, and move code
execution to an isolated worker process or `isolated-vm` before it is turned on for anyone else.

### S-04 — Vulnerable dependencies the NooblyJS audit cannot see

`npm audit --omit=dev`, 2026-10-12:

| Repo | Result | Notable |
| --- | --- | --- |
| nooblyjs-ai-host, harness, product, teammates, infrastructure, factory | 0 | — |
| **nooblyjs-core** (523 packages) | **3 critical, 9 high**, 1 moderate | `simple-git` (command execution via unsafe options; the filing API's git routes use it, and they are open, S-01); `proxy-addr` (IP spoofing through a trusted subnet; relevant to `TRUST_PROXY`); `node-forge` (signature verification); `passport-azure-ad` (direct); `@google-cloud/storage` chain |
| **nooblyjs-ai-knowledge** (453 packages) | **13 high**, 14 moderate, 1 low | `xlsx` (prototype pollution, ReDoS; **no fix**), `http-proxy-middleware` (direct), `compression` (direct), `socket.io`/`engine.io`/`ws` denial of service, glob matchers |

NooblyJS links its siblings as `file:../<repo>`, so `npm audit` in `nooblyjs-ai-host` reports 0 while the code it runs carries these. The
Phase 13 review ran it in `nooblyjs-ai-host` only.

**Fix.** `npm audit fix` where it is not a major upgrade; plan the majors (`simple-git` 4, `@google-cloud/storage` 8);
replace `xlsx` (SheetJS publishes fixed builds outside npm) or confine spreadsheet parsing to Owners. Run the audit in
every repo on every build (see the readiness audit's CI finding).

### S-05 — Password sign-in beside Microsoft sign-in, and a standing local admin

- With `AUTH_METHOD=azure`, nooblyjs-core's password sign-in (`/services/authservice/api/login`, `?local=1` on the login
  page) stays on. It skips Entra's MFA and conditional access.
- The seeded people's local accounts have random passwords nobody knows (`src/services/people.js:125`): fine. But core
  creates `admin@localhost`, a **core admin** (the `/services` dashboards), and writes its password to
  `data/core/auth/INITIAL_ADMIN_PASSWORD.txt`, where it stays until someone deletes it (backups already leave it out:
  `src/services/backup.js:20`). Nothing in nooblyjs-core switches password sign-in off; the route is always registered.

**Fix.** With Entra on, switch password sign-in off (keep one break-glass account, with a long password held outside
`data/`). Refuse to start in production while `INITIAL_ADMIN_PASSWORD.txt` exists.

---

## Medium

### S-06 — Rate limiting covers `/api/` only

`app.js:169` mounts the general limiter on `/api/`. `/wiki/api`, `/product/api`, `/factory/api`, `/teammates/api`,
`/infrastructure/api`, `/workflows/api` and `/services` have none. Some of those are expensive: a Viewer can start a full
search-index rebuild (S-02). **Fix:** mount the limiter on every app's API path (or app-wide, excluding static files and
the event stream).

### S-07 — Wiki Markdown is not sanitised

The wiki renders documents and AI answers with `marked` into `innerHTML` (`public/app/js/modules/aichatcontroller.js:1243`,
`navigationcontroller.js:2019`), with no sanitiser. `marked` passes raw HTML through. What stops script today is the
policy NooblyJS sends: `script-src 'self'` blocks inline scripts and `on…=` handlers. That is one layer where there should be
two, and anyone who can edit a page (S-02) can try. Not verified with a live payload. **Fix:** sanitise the HTML
(DOMPurify, vendored) before it is inserted. The newer front ends (NooblyJS, the kit, Product, Factory, Teammates,
Infrastructure) escape through the kit's `html` template: no unescaped interpolation was found.

### S-08 — Untrusted text reaches agents

Wiki pages, Jira issue text, pull requests and repository files all end up in prompts. What limits the damage is
enforced server-side: agents are capped at Contributor, cannot approve or merge, every action passes
`checkAgentWork()`, and the Factory has red-team tests (`nooblyjs-ai-factory/test/redteam.test.js`: an issue asking to commit a
key, a repository file asking for a token, a CI-config edit). The gap is the wiki's own AI agents, which call their
provider directly, outside Platform's checks, budgets and audit (mocking audit A6). **Fix:** route them through
Teammates like every other agent action; add a red-team case for a wiki page that carries instructions.

### S-09 — A Viewer controls server-side AI calls and tokens in the wiki

- `POST /wiki/api/v1/settings/ai` (`src/wiki/routes/settingsRoutes.js:89`) stores a provider, **endpoint** and key per
  person, which the server then calls: a request from NooblyJS's network to wherever the person points it. Whether the
  endpoint is checked against private addresses (as the workflow `api` step is) was not confirmed. `[CONFIRM]`
- `POST …/auth/extension-token` (`authRoutes.js:527`) mints a 24-hour bearer token, kept in memory, not revoked at
  sign-out. Person deactivation still applies (NooblyJS re-checks the person on each request).

**Fix:** with S-02's guard, let Owners set AI endpoints for everyone (Platform's model routes already do this); shorten
and revoke extension tokens at sign-out, or switch the extension to the NooblyJS session (the Edge extension already does).

### S-10 — Data at rest

`data/` holds people's names, emails and job titles, the audit log, chat, and the sign-in store (password hashes for local
accounts); backups are plain copies. Neither is encrypted by NooblyJS. POPIA applies to the personal data `[CONFIRM the
retention period and who may hold backups]`. **Fix:** encrypt the disk or volume that holds `DATA_DIR` and `BACKUP_DIR`;
write a retention rule for the audit log and chat; keep backups off the NooblyJS machine.

### S-11 — Audit is best effort

`src/middleware/audit.js:9` writes the record when the response finishes; a failed write is logged and the change it
describes stands. Product.md §3 says every write is audited. **Fix:** for governance actions (approvals, guardrails,
budgets, writes to Jira and Bitbucket, member changes), write the record before answering and fail the request if it
cannot be written; alert on any `audit write failed` line.

---

## Low

- **S-12 Status endpoints say too much.** Signed out: `/services/authservice/api/status` (number of users, active
  sessions), `/services/working/api/status` (host name, process id), `/services/ai/api/status` (provider),
  `/teammates/api/v1/health` (`provider: mock`). Return `ok` only, as `/healthz` does since Phase 13.
- **S-13 `passport-azure-ad` is deprecated** (Microsoft's replacement is MSAL Node); it is also in S-04's high list.
  Plan the move before Entra sign-in is the only door.
- **S-14 10 MB bodies everywhere** (`app.js:115`): known from Phase 13; lower it per route.
- **S-15 Electron trusts any certificate for its own local origin** (`apps/electron/main.js:183`), so a local process
  could stand in for NooblyJS. Pin the certificate NooblyJS generated (`certs/`) instead.
- **S-16 Refusals that sign you out.** A Viewer calling `PUT /services/authservice/api/users/:email` or
  `POST /teammates/api/v1/admin/keys` was signed out of NooblyJS, not just refused. Not a hole, but a surprising side
  effect; log it as a bug.
- Known from Phase 13 and still true: `style-src 'unsafe-inline'`; long-lived Atlassian write tokens.

---

## What passed

- **NooblyJS's own routes**: every one of the 31 writes under `/api/v1` refused the Viewer (403), and every read needs sign-in
  and `read`. The permission matrix is the only source of permissions; the work role is never read by a check.
- **Product (38 writes), Factory (4), Teammates (43), Infrastructure and the lifecycle engine** refused the Viewer, at the
  route or in the service (Infrastructure and the lifecycle check after looking the item up, so an unknown id is 404).
- **No outbound call** was attempted by any route during the probe, with every outbound address blocked.
- **Writes to Jira and Bitbucket**: the Phase 13 gate is unchanged; no route makes up a write.
- **Teams bot**: RS256 only, Bot Framework issuer, this bot's audience, expiry, and the token's serviceUrl must match
  the activity's; replies go to Bot Framework hosts only (`src/teams/auth.js`, `connector.js`).
- **Sessions**: `HttpOnly`, `Secure` over HTTPS, 12 hours; Passport 0.7 issues a new session at sign-in (no fixation);
  double-submit CSRF on every change; the development person picker and the unsigned Teams mode refuse to start in
  production (`src/config.js`).
- **Headers**: CSP without inline script, `frame-ancestors 'none'`, HSTS in production, `nosniff`, `no-referrer`,
  same-origin opener and resource policies.
- **Edge extension**: `sidePanel` and `storage` only, localhost hosts, Jira pages read as text only.
- **Electron**: context isolation, sandbox, no Node in the page, navigation kept to NooblyJS, external links to the browser.
- **The Software Factory refuses to run a repository's code without a sandbox** outside development.
- **No secrets in any repository.** The one match (`nooblyjs-ai-factory/test/redteam.test.js`) is AWS's published example key.

## Order of work

1. S-01 now (nooblyjs-core + NooblyJS), with the probe as a test. Check "Exposure today"; rotate if in doubt.
2. S-02 and S-03 together (one guard for the wiki; code steps off and Owner-only).
3. S-04 (patch releases now, majors planned), S-05.
4. The Mediums, then the Lows. Then the independent review.
