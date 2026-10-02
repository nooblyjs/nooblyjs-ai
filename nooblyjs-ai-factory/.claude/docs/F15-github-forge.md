# Phase F15: The GitHub forge

**Goal:** the same factory, a real forge. Issues come from GitHub, PRs go to GitHub, and what people do on GitHub (label, review, merge) drives the runs.

Since F03 every station has talked to a **Forge interface** (`getIssue`, `comment`, `pushBranch`, `openOrUpdatePR`, `findPR`, `merge`), with a local, file-based forge behind it. F15 adds a second implementation. **No station changed**, apart from `await`ing forge calls that had been synchronous: a remote forge is async, and the local one never showed that.

---

## The pieces

```
GitHub ──webhook (signed)──▶ factory serve --webhooks ──▶ verify ─▶ parse ─▶ handle ──▶ event log
   ▲                                                                                     │
   │   REST + GraphQL (token, control plane only)                                        ▼
   └──────────────────────── GitHub forge ◀── stations (triage, approval, deliver, merge) ◀── scheduler
```

| File | What it does |
|---|---|
| `src/forge/github/client.js` | `fetch` + a token. Rate limits: wait for `x-ratelimit-reset` (or `retry-after`), up to `maxWaitMs`, then fail clearly. 5xx and network errors: back off 1s, 2s, 4s. 4xx: fail at once, with GitHub's message. |
| `src/forge/github/forge.js` | The Forge interface on GitHub (below) |
| `src/forge/github/webhooks.js` | `verifySignature` (HMAC-SHA256, constant time), `parseWebhook` (event → command), `handleWebhook` (command → events) |
| `src/server/webhooks.js` | `POST /webhooks/github` on `127.0.0.1`, 1 MB cap, unsigned → 401 |
| `src/forge/index.js` | `forgeFor(request)`: a run's request says which forge; `githubSettings()` from `config.json` |
| `src/commands/github.js` | `factory github poll`: for when GitHub can't reach you |

## The GitHub forge, method by method

| Method | On GitHub | Worth knowing |
|---|---|---|
| `getIssue` | `GET /issues/{n}` | Issues are filed by **people**; `fileIssue` throws |
| `comment` | `POST /issues/{n}/comments` | **Idempotent**: each comment carries a hidden `<!-- factory:key -->`; the same key is never posted twice (a retried station after a crash) |
| `pushBranch` | `git push` from the mirror | The token goes to git as `GIT_CONFIG_*` **environment variables** (an `http.extraheader`), never on the command line, where `ps` shows it to every user on the machine |
| `openOrUpdatePR` | `POST /pulls`, `PATCH /pulls/{n}` | One PR per head branch, updated in place. The body ends with `<!-- factory-run: <run> <sha> -->`, which F05's reconcile uses to recognise "this PR already shows this commit" |
| draft ⇄ ready | **GraphQL** `markPullRequestReadyForReview` | REST can't change it. A small, real example of why a client needs both |
| `setStatus` (new) | `POST /statuses/{sha}` | A commit status `factory: delivered` (or the first problem). Check runs are richer, but they need a **GitHub App**; statuses work with a personal token |
| `merge` | `PUT /pulls/{n}/merge` | Autonomy L3 only (F12); "already merged" is success |

The status is set as an **effect** (F05): intended → done, keyed by run, sha and verdict.

## Webhooks: what GitHub tells us, and what it means

| Event | Becomes |
|---|---|
| `issues` labelled `factory` (or opened/reopened with it) | a queued run: `forge: { kind: 'github', owner, name }`, the issue inline |
| `pull_request` closed + merged, on a `factory/…` head | `run.merged` (the run shows **merged**, and who) |
| `pull_request_review` = changes requested, by someone in `github.allowedUsers` | `pr.changes_requested` + a rewind to **repair**: the F13 fixer gets the person's words, first |
| anything else | ignored, politely (202, "not an event the factory acts on") |

Three rules make this safe:

1. **Verify before you parse.** A webhook URL is public; anyone can POST to it. GitHub signs the raw body with a shared secret (`X-Hub-Signature-256`). Compare with `crypto.timingSafeEqual`: an ordinary `===` returns sooner the earlier the strings differ, and that timing leaks the signature a byte at a time.
2. **Handle redeliveries.** GitHub resends on timeouts and people press "Redeliver". Each delivery id is an idempotency key (F05), so the same delivery never makes a second run or a second repair.
3. **Not everyone can steer the factory.** Labelling an issue is gated by GitHub's own permissions (triage access). Reviews are open to more people, so `changes requested` is only acted on from `github.allowedUsers`. Otherwise a drive-by reviewer could make the factory spend money writing whatever they asked.

### A person's review, back to the fixer

This was F13's repair loop waiting for a real reviewer. `describeFailure` checks for a human review **first**:

```
A person reviewed the pull request and REQUESTED CHANGES (sam):

n >> 1 truncates odd numbers: use n / 2
```

The fixer commits `Fix (repair 1): changes requested by sam`, and verify, review and deliver run again. The same PR is updated, and its evidence gains a Repairs row. A repair consumes the review, so it isn't applied twice. The repair **budget** still applies: a person who asks five times gets an escalation, not five runs.

## No public URL? Poll

Webhooks need GitHub to reach you. On a laptop, either put a tunnel in front of `factory serve --webhooks` (`smee`, `ngrok`), or ask GitHub instead:

```bash
factory github poll --repo acme/calc          # from cron every few minutes, or by hand
```

It lists open issues with the label, skips ones the factory has an item for, and queues the rest. Polling is simpler and slower; webhooks are faster and need a door. Most real factories support both, for the same reason.

## Configuration

`~/.factory/config.json`:

```json
{
  "github": {
    "tokenEnv": "GITHUB_TOKEN",
    "webhookSecretEnv": "FACTORY_WEBHOOK_SECRET",
    "label": "factory",
    "allowedUsers": ["sam"],
    "webhookPort": 8787,
    "repos": [{ "owner": "acme", "name": "calc", "clone": "/home/me/src/calc" }]
  }
}
```

The config names **environment variables**, never the secrets themselves: config files get copied, committed and pasted into bug reports. The token is only ever read by the control plane. Agents run in workspaces with no token and no network (F02), and never push (F03).

Fine-grained token permissions: *Contents* read/write (push branches, merge), *Pull requests* read/write, *Issues* read/write (comments), *Commit statuses* read/write.

## Tests: a fake GitHub

`test/fixtures/fake-github.js` is a small `node:http` server that answers the endpoints the factory uses, with GitHub's response shapes. It checks the token, records every request, and can pretend to be rate limited. The end-to-end test runs the whole loop offline:

1. a **signed** `issues.labeled` webhook → a queued run; the same delivery again → "already handled"; a wrong secret → 401;
2. the run → a branch pushed, a PR on the fake GitHub whose body is the F14 evidence, a `factory: success` status;
3. a `changes_requested` review from `sam` → the fixer, given sam's words, fixes it → **the same PR**, updated, with a Repairs row;
4. `pull_request.closed` + merged → the run is **merged**.

Plus: rate limit → wait → success (and too long a wait → a clear error); one PR per head, draft → ready through GraphQL; a comment once per key; signatures (forged, tampered, unsigned); review from a stranger → ignored; poll → queued once.

**What I haven't done: the checkpoint against real GitHub.** It needs a token and a repository you own, and it creates real PRs, so it's yours to run:

```bash
export GITHUB_TOKEN=github_pat_…                 # fine-grained, one test repo
factory github poll --repo you/sandbox-repo --autonomy L2
factory serve --until-idle
```

What the fake can't tell us: GitHub's exact eventual consistency (a PR list that doesn't show the PR you just made for a second), secondary rate limits on content creation, and webhook ordering. Those are the next things a real run would teach.

## Limits, on purpose

- **Cloning a private repo** uses git's own credentials (your credential helper), or a local clone named in `github.repos[].clone`. Only the *push* uses the factory's token.
- **One repo per webhook server config**, matched by owner and name. GitHub Apps (many installations, short-lived tokens, check runs) are the grown-up version.
- **Review comments on lines** aren't read, only the review's body. A line comment would need `GET /pulls/{n}/comments`, with the path and line added to the fixer's brief.

## Try it (offline)

```bash
node --test test/github.test.js
FACTORY_WEBHOOK_SECRET=x node bin/factory.js github webhook-test   # the settings serve would use
```

## What we learned

- **An interface pays off when the second implementation arrives.** F03's Forge interface meant F15 changed no station logic. What it *did* expose was a hidden assumption, **synchronous calls**, invisible until a forge had to go over the network.
- **Idempotency at every door.** Comments carry a key, PRs are one-per-head with a run marker, statuses are effects, and webhooks are keyed by delivery id. Networks retry; so must you, safely.
- **Verify, then parse; constant-time compare.**
- **Secrets travel by environment**, never argv or config files, and only in the control plane.
- **Use each API for what it's good at**: REST for most things, GraphQL for draft ⇄ ready, statuses over check runs until there's an App.
- **Humans steer through the forge.** A label starts work, a review sends it back to the fixer, a merge ends it. That's the interface people already know.
- How the commercial factories appear to do it: GitHub's Copilot coding agent starts from an issue assigned to it and iterates on PR review comments; Devin, Codex and Jules open PRs and respond to review comments; Sweep started from labelled issues. Most run as **GitHub Apps** (installation tokens, check runs, fine-grained repository access), which is where this would go next.
