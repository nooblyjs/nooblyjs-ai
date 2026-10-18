# Security review — Phase 13 (2026-10-11)

What was checked before a pilot, what was fixed, and what remains. It was done by reading the code and running the
checks named here on this machine; it is not a penetration test, and nobody outside the build has reviewed it
`[CONFIRM: an independent review before production]`.

## Scope

Everything Phase 13 added (writing to Jira and Bitbucket, the sync, backup and restore), and the parts of NooblyJS a
pilot exposes: sign-in and sessions, the permission checks, the public endpoints, dependencies, and what is kept on
disk.

## What was checked

| Area | Check | Result |
| --- | --- | --- |
| Writes to production systems | Can anything reach Jira or Bitbucket with a write except through the gate? `test/services/devtools.test.js` reads the folder's source: one `fetch` in the reader (GET only), one in the writer (the listed kinds only), `git` run in one file, no `PATCH`/`DELETE`, no `--force`, no merge or decline path | Pass |
| | Is a write sent with any lock closed (deployment, mode, credential)? `devtools-writes.test.js`, `devtools-writes-closed.test.js`: zero requests other than GET | Pass |
| | Can an agent cause a write, approve one, or switch writing on? Refused and audited in each case | Pass |
| | Can a caller make up a write? There is no route that takes one: `POST /api/v1/devtools/writes` is 404 | Pass |
| | Can the writer be pointed at another host or path (request forgery)? The origin is fixed, the path must match the kind, a query string or `..` is refused | Pass |
| | Is the read token ever used to write, or the write token to read? | Pass (tested per request) |
| | Does a credential reach the outbox, the audit log, a log line or the git mirror? The token goes to git in the environment; git's errors are scrubbed; outbox files are checked for it | Pass |
| | Can NooblyJS merge, or count its own merge as a person's? No merge kind exists; a merge by NooblyJS's own Bitbucket account is ignored and audited | Pass |
| Permissions | Mode, rule, send and discard need `change-guardrails` (Owner); a sync needs `draft`; reads need `read`. Refusals are 403 and audited | Pass |
| Backups | A backup inside `data/` is refused; a restore never overwrites; a changed, missing or extra file and a short audit log are detected before anything is restored | Pass |
| Public endpoints | `/healthz` (no sign-in) returned the server's data folder path | **Fixed**: it returns `status` and `version` only |
| | `/api/teams/messages` accepts only a valid Bot Framework token (Phase 12) | Pass |
| Sessions | Cookie is `HttpOnly`, `Secure` on HTTPS, 12 hours; CSRF is a separate double-submit token checked on every change | Pass |
| | Sign-in is rate limited (`/login`, the authservice login) | Pass |
| Headers | CSP: `default-src 'self'`, no remote scripts, `frame-ancestors 'none'`, `object-src 'none'`; HSTS in production | Pass, with one note below |
| Dependencies | `npm audit --omit=dev` in `nooblyjs-ai-host` | 0 known vulnerabilities (2026-10-11) |
| Secrets in the repository | Tracked files that look like secrets: `.env.example` (no values), `secrets.yaml` (references only) | Pass |
| Old trusted-identity sign-in | The legacy wiki's `POST /api/auth/identity` issues a token for any email it is sent. Probed on a throwaway NooblyJS: the hosted wiki does not serve it (404), signed in or not | Not exposed in NooblyJS |

## What remains

| Risk | Why it is open | Proposed |
| --- | --- | --- |
| The legacy standalone wiki (`digital-technologies-knowledge`, and `nooblyjs-ai-knowledge`'s `app.js` on 9101) trusts an email as identity | Outside NooblyJS, and that project is read-only for this work | Switch that endpoint off, or verify the identity, wherever the standalone wiki still runs |
| A backup holds people's names, the audit log and the sign-in store (password hashes when local sign-in is used) | By design: it must restore sign-in | Keep `BACKUP_DIR` as protected as `data/`; encrypt it at rest where it is stored `[CONFIRM where]` |
| `style-src` allows `'unsafe-inline'` | The hosted wiki's legacy pages use inline styles | Remove when those pages are ported |
| Request bodies up to 10 MB | Uploads in Teammates and the wiki | Lower per route once the largest real upload is known |
| The write tokens are long-lived API tokens | Atlassian's scoped tokens | Scope each to the NooblyJS projects and repositories only, and rotate on a schedule (runbook: a leaked token) |
| Jira issue and pull request text comes from work items and agent output | It is sent as plain text (Jira) and Markdown (Bitbucket), never as HTML, and rendered by those tools | None needed; noted |
| `npm audit` was run for `nooblyjs-ai-host` only | The sibling repos have their own dependency trees (the legacy wiki's is large) | Run it in each repo in CI |
| No independent review, no load from real users | — | Before production |

## How to repeat it

```bash
node --test test/services/devtools.test.js test/services/devtools-writes.test.js   # the gate and its refusals
node --test test/devtools-writes-closed.test.js                                    # nothing is sent while a lock is closed
node --test test/backup.test.js                                                    # backup, restore, damage detected
npm audit --omit=dev
```
