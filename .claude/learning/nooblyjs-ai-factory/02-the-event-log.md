# nooblyjs-ai-factory: the event log

**Lesson 02 · about 10 minutes · 2026-10-10**

## What you'll learn

- Why the factory never edits its own records: it only adds a new event, and the current state is worked out from the events.
- How an **idempotency key** makes "did I already do this?" a rule of the store, so a retry can't repeat an action.
- How the store is kept as plain YAML files, and why it can be rebuilt from them at any time.

## The idea, in plain words

Think of a bank statement. The bank doesn't store "your balance is £500" and change it every time you spend. It stores every transaction, in order, and the balance is what you get when you add them up. If the balance is ever wrong, you can add the transactions again and get the right answer.

The factory works the same way. Every change is written as an **event**: "run r1 started", "step build finished", "pull request opened". Events are only ever added at the end. Nothing is edited and nothing is deleted. The things the factory needs to know right now, such as which runs exist and what state each is in, are **projections**: tables worked out from the events, held in memory.

Why bother? Two reasons from the code's own notes:

- **Crash safety.** A change is one line added to a file. If the process dies, the line is either there or it isn't. There is no half-updated row to repair.
- **Nothing is lost.** Because the history is kept, you can always answer "what happened, and in what order?" That history is what `factory logs` reads, and it is the audit trail.

There's a second rule. An event can carry a **key**, a unique label for the action it represents. If an event with that key already exists, appending it again does nothing. That matters when a step might run twice after a crash: the second attempt is turned away by the store, not by hope.

Where the analogy stops: a bank's ledger lives on its own servers. Here the ledger is a set of plain text files in the factory's home folder, and the tables are rebuilt from them every time the store opens.

## Where it lives in this repo

- `src/models/store/events.js`: the store itself. `openStore()` gives you `append`, `read`, `hasKey`, and a way to group several appends into one unit.
- `src/models/store/projections.js`: the tables. Each projection says which events it cares about (`keyOf`) and how to fold one event into its row (`reduce`). `runs` is the one that tracks runs.
- `src/models/store/files.js`: writes and reads the daily YAML files, using a lock folder so that two processes don't write at once.
- `src/models/store/recovery.js`: finds runs that were left unfinished after a crash and recovers them from the log.
- `test/models/store.test.js`: tests that show the rules in action. Its first two tests are the clearest examples.

## A small piece of code

The append, with its idempotency check (`src/models/store/events.js:180-186`):

```js
    append(stream, type, data, { key } = {}) {
      return transaction(() => {
        if (key && keys.has(key)) return null;
        const current = /** @type {NonNullable<typeof tx>} */ (tx);
        /** @type {FactoryEvent} */
        const e = { seq: lastSeq + 1, stream, type, data: structuredClone(data), at: isoNow(clock), key: key ?? null };
        log.push(e);
```

- Line 180: `append` takes a stream (what the event is about, such as `run:r1`), a type, the data, and an optional key.
- Line 182: if the key has been seen before, the function returns `null`. This is the idempotency rule.
- Line 185: the event gets the next sequence number (`seq`) and a timestamp. Sequence numbers give one global order.
- Line 186: the event is added to the end of the log. Nothing before it is touched.

How a projection folds an event into a table (`src/models/store/projections.js:166-169`):

```js
    const next = p.reduce(current ? structuredClone(current.data) : null, event);
    if (!next) continue;
    undo?.push([p.table, id, current]);
    rows.set(id, { data: next, seq: event.seq });
```

- Line 166: the reducer receives the row as it was, and a copy is made first, so the reducer can't change the old row by accident.
- Line 169: the new row replaces the old one. The row remembers the `seq` of the event that last changed it.

## Try it

Run the two focused store tests. They show, in plain assertions, the ordering and the idempotency rule. Both use a temporary folder, not your real factory home:

```bash
cd <workspace>/nooblyjs-ai-factory && node --test --test-name-pattern="append and read|idempotency key" test/models/store.test.js
```

You should see `pass 2` and `fail 0`. Then open `test/models/store.test.js` and read the first test. Each line of it is a rule you've just seen.

*Note on the full store test file:* it runs 17 tests, some of which start real runs and spawn processes. On this machine it took about 90 seconds, and once went past a two-minute limit. Running just the two named tests above is the quick check.

## Words to know

- **Event**: one record of something that happened, with a type, a stream, data, a time and a sequence number.
- **Stream**: the thing an event is about, such as `run:r1`. Used to read one run's history on its own.
- **Sequence number (`seq`)**: the event's place in the global order. Each new event gets the next number.
- **Idempotency key**: a unique label on an event. A second event with the same key is ignored.
- **Projection**: a table in memory, worked out from the events. The factory's current state is made of these.
- **Reducer**: the function that folds one event into one row of a projection.
- **Rebuild**: throwing away the tables and replaying every event from the start. `factory db rebuild` does this.
- **Transaction**: several appends saved together, so either all of them are written or none are.
- **Lock folder**: a folder whose creation acts as a lock, so only one process writes to the log at a time.
- **HEAD**: a small file that records the last sequence number and where it was written.

*Older docs mention SQLite as the store. That was the state before NooblyJS Phase 7. The code now uses plain YAML files, as the header of `files.js` says.*

*You'll meet these later: `performEffect` (which uses keys to make outside actions, such as a push, safe to repeat) and `recovery.js` (which uses the log to pick up interrupted runs).*

## Summary: what you've learnt

- You know the factory never edits its records; it adds events, and the current state is worked out from them.
- You know why this makes crashes safe: a change is one added line, not a half-updated row.
- You know an idempotency key turns a repeated action into a no-op, enforced by the store.
- You know the events live in plain daily YAML files, and the tables can be rebuilt from them.
- You can run the two focused store tests and point to the lines that enforce those rules.
