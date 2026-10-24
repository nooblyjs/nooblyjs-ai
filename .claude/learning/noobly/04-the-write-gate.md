# nooblyjs-ai-host: the write gate (writing to Jira and Bitbucket safely)

**Lesson 04 · about 10 minutes · 2026-10-11**

## What you'll learn

- Why Jira and Bitbucket get special treatment: they are production systems other teams depend on.
- How one function, `writes.send()`, decides whether a write is sent, recorded, waiting, or refused.
- The three locks that must all be open before anything leaves NooblyJS, and what happens when one isn't.

## The idea, in plain words

NooblyJS reads Jira and Bitbucket freely. Writing to them (creating a Jira issue, pushing a branch, opening a pull
request) can affect real teams, so it goes through **one door**: the write gate. Nothing else in NooblyJS can write to
them; a test reads the source code to make sure of it.

Think of it as an **outgoing post room**. Every letter is logged on arrival. The room checks the letter is one of
the kinds it handles, that it comes from someone allowed to send it, and that it makes sense (a reply to a letter
we actually received). Then it looks at three switches: is the post room open today, has the manager said "send"
for this destination, and do we have stamps? If any is off, the letter stays in the out-tray, ready, and nothing
goes out. (Where the analogy stops: some letters are never accepted at all. There is no kind for "merge" or
"delete", so those can't even be put in the tray.)

The three locks:

1. **The deployment**: `DEVTOOLS_WRITES=true` in `.env`.
2. **The Owner**: Jira and Bitbucket each switched from **Record only** to **Send** in Platform · Settings · Integrations.
3. **A write credential**: a separate write token. The read token is never used to write.

## Where it lives in this repo

| Path | Why it matters |
| --- | --- |
| `src/services/devtools/writes.js` | The gate: `send()`, the locks, the outbox, approvals |
| `src/services/devtools/writer.js` | The only HTTP writer: a fixed list of kinds (`KINDS`), each one method on one path |
| `src/services/devtools/git-push.js` | The only `git push`: one commit, to a `factory/…` branch, never forced |
| `src/services/devtools/sync.js` | What asks for writes: issues from a handoff, moving an issue, following pull requests |
| `data/devtools/outbox/` | One file per write attempt, sent or not |

## A small piece of code

The first checks in `send()`, `src/services/devtools/writes.js` lines 145 to 161, trimmed:

```js
if (!KINDS[kind]) return refuse(…, `NooblyJS has no write called "${kind}".`, 'unknown_kind');
if (!base.key) return refuse(base, 'A write needs a key, so the same one is never sent twice.', 'no_key');
if (base.actor.type !== 'system' || !ASKERS[kind].includes(base.actor.id)) {
  return refuse(base, base.actor.type === 'agent' ? 'An agent may not write to Jira or Bitbucket.' : …, 'not_allowed');
}
const before = await byKey(base.key);
if (before?.state === 'sent') return { ok: true, sent: true, … existing: true };
const fact = await facts[kind](request);
if (!fact.ok) return refuse(entry, fact.message, 'facts');
const rule = (await settings()).rules[kind] ?? 'automatic';
if (rule === 'off') return refuse(entry, `… is switched off …`, 'rule_off');
```

- An unknown kind is refused before anything else: there is no way to ask for a merge.
- Every write has a **key**. The same key twice returns the first answer, so a retry never sends twice.
- Only NooblyJS's own parts may ask, and **an agent never may**.
- The **facts** must hold: an issue for a handoff a person approved; a branch called `factory/…` on a repository
  where Platform lets agents open pull requests.
- Then the **rule** (automatic, needs approval, off), and last the three locks. With a lock closed the write is
  saved as **Recorded, not sent**, with the reason, for a person to read in the outbox.

## Try it

Run the gate's tests. They use a fake Jira and Bitbucket, so nothing reaches a real system:

```
cd <workspace>/noobly
node --test test/services/devtools-writes.test.js
```

Read the test named "with DEVTOOLS_WRITES unset, an approved handoff is recorded and nothing is written".

## Words to know

- **Write gate**: the one function every write to Jira or Bitbucket goes through.
- **Record only / Send**: a system's mode, set by an Owner. Record only keeps writes in the outbox and sends nothing.
- **Outbox**: the list of every write attempt and its state (recorded, waiting, sent, failed, refused, discarded).
- **Idempotency key**: the name of a write; the same key is never sent twice.
- **Kind**: one of the writes NooblyJS can make (`jira.create-issue`, `bitbucket.open-pr`…).

## Summary: what you've learnt

- You know only the write gate can write to Jira or Bitbucket, and agents can never cause a write.
- You know a write is sent only when the deployment, an Owner and a write token all allow it.
- You know with any lock closed the write is recorded in the outbox instead, so you can see exactly what would have been sent.
- You know NooblyJS has no way to merge, delete or change settings in those systems: a person merges.
