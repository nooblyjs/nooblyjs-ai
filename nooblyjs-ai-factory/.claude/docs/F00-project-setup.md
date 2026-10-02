# Phase F00: Project setup

**Goal:** a skeleton that runs, has a test command, and uses the harness as a **dependency**, not a copy.

---

## The big idea: harness vs factory

You spent 30 phases building `noobly`, a **harness**: one agent, one conversation, usually with you at the keyboard. A **factory** is a different kind of program. It doesn't think or edit code itself. It **decides what work runs, where, with what limits, and what happens to the result**.

```
            harness (noobly)                          factory
   ┌───────────────────────────────┐      ┌────────────────────────────────────┐
   │ model ⇄ loop ⇄ tools          │      │ intake → queue → workspace → agent │
   │ one conversation              │ ◄─── │ → checks → review → PR → measure   │
   │ a human watching              │ uses │ many jobs, mostly unattended       │
   └───────────────────────────────┘      └────────────────────────────────────┘
          the WORKER                               the CONTROL PLANE
```

A car factory doesn't reinvent the welding robot. It buys robots and designs the **line** around them: what arrives, in what order, how it's checked, what happens when a weld fails. In our factory, `noobly` is the robot.

So Rule 1 of this project: **the factory never contains a second agent loop.** Every agent it runs is a `noobly` session.

## 1. The file map

```
nooblyjs-learn-factory/
├── bin/
│   └── factory.js            ← the command you run. One line: import src/cli.js
├── src/
│   ├── cli.js                ← `factory <command>`: a table of commands, --help, --version
│   ├── index.js              ← the library entry (grows each phase)
│   ├── harness.js            ← THE ONLY FILE that imports noobly (see §3)
│   └── util/
│       ├── ids.js            ← ids that sort by time: ws-mh3k2c9a-4f1a2b
│       ├── clock.js          ← time you can control in tests
│       ├── paths.js          ← ~/.factory ($FACTORY_HOME)
│       └── log.js            ← FACTORY_DEBUG=1 → ~/.factory/debug.log
├── test/                     ← node:test, offline
├── NOOBLY.md  CLAUDE.md      ← instructions for agents working on THIS repo
└── .claude/
    ├── steering/             ← PRD, Architecture, Roadmap (the plan)
    └── docs/                 ← these notes (what was built)
```

## 2. `package.json`: the harness as a dependency

```jsonc
{
  "type": "module",                          // ES modules, like the harness
  "bin": { "factory": "bin/factory.js" },    // npm link → a real `factory` command
  "engines": { "node": ">=24" },             // node:sqlite is stable from 24 (we need it in F05)
  "scripts": { "test": "node --test \"test/**/*.test.js\"" },
  "dependencies": {
    "nooblyjs-learn-harness": "file:../nooblyjs-learn-harness"
  }
}
```

`file:../nooblyjs-learn-harness` tells npm: "this package is the folder next door". `npm install` doesn't copy it; it makes a **symbolic link**:

```
node_modules/nooblyjs-learn-harness -> ../../nooblyjs-learn-harness
```

So a change in the harness is visible to the factory immediately, with no publishing or reinstalling. That's what you want while building both at once.

### No `tsx` this time

The harness needs `tsx` because its UI is JSX. The factory has no terminal UI (its UI will be a web page in F17), so it runs on plain Node. Importing the harness *library* still works under plain Node, because `src/index.js` of the harness never loads the Ink UI. That was worth checking before building on it (it's the first test in `test/harness-smoke.test.js`).

## 3. `src/harness.js`: one door to the harness

Every import of noobly goes through this one file:

```js
export { createSession, query, createMockProvider, EVENT, … } from 'nooblyjs-learn-harness';
// Deep imports (TODO H31: export these from the harness's src/index.js).
export { costOf, hasPrice } from 'nooblyjs-learn-harness/src/core/cost.js';
export { createSandbox, detectBackend } from 'nooblyjs-learn-harness/src/sandbox/index.js';
```

Two kinds of import, deliberately kept apart:

| Kind | Example | Promise |
|---|---|---|
| **Public API** | `createSession`, `query`, `EVENT` | Documented in harness Phase 17. Safe to depend on |
| **Deep import** | `src/core/cost.js` | An internal file. It works only because the harness has no `"exports"` field. It could move tomorrow |

Keeping deep imports in one list turns a vague worry ("we depend on harness internals") into a to-do list for the harness: **harness phase H31** will export exactly these. This is how two projects that evolve together stay honest with each other: **name your seams**.

`nooblyBin()` finds the `noobly` command inside the linked package, for F01 when we run it as a separate process. `$FACTORY_NOOBLY_BIN` can point it somewhere else, which is how tests will swap in a fake.

## 4. Ids that sort by time

A factory creates thousands of things, and you almost always want them newest-first. Put the time **first** in the id and string sorting becomes time sorting:

```
run-mh3k2c9a-4f1a2b
│   │         └── 3 random bytes: two ids in the same millisecond still differ
│   └──────────── milliseconds since 1970, base 36, padded to 9 characters
└──────────────── what kind of thing
```

The padding matters: without it, `"z"` (35) would sort after `"10"` (36). Same trick as ULIDs, UUIDv7 and Twitter Snowflake ids.

## 5. A clock you can control

From F05 on, the factory is full of time: leases expire, heartbeats are late, budgets reset daily, steps time out. Code that calls `Date.now()` directly can only be tested by really waiting. So anything time-dependent takes a `clock`:

```js
const clock = createFakeClock(0);
scheduler.tick();
clock.advance(60_000);   // a minute passes, instantly
scheduler.tick();        // the lease has expired now
```

It's one small file now, and it saves us from slow, flaky tests later.

## 6. Tests

```bash
npm test
```

| File | What it proves |
|---|---|
| `test/harness-smoke.test.js` | The harness library loads under plain Node and runs a scripted session (mock provider); the `noobly` binary is found |
| `test/ids.test.js` | Ids sort by time as plain strings; same-millisecond ids differ; slugs are safe |

Same rule as the harness: **every test is offline.** The mock provider replays scripted replies, so the factory can be tested end to end without an API key.

## 7. Agent instructions for this repo

`NOOBLY.md` tells any agent working on this repo (noobly reads `NOOBLY.md`; Claude Code reads `CLAUDE.md`, which just says `@NOOBLY.md`) the house rules: built-ins only, import the harness through `src/harness.js`, offline tests, one concept per file. From F07 on, the factory itself will work on this repo, so these instructions will matter.

## Try it

```bash
npm install
node bin/factory.js --version
node bin/factory.js --help
npm test
```

## Things noticed on the way

- The harness `package.json` says version `1.0.0`, while its README says v2.0.0. `factory --help` prints the package version. Worth bumping in the harness.

## What we learned

- **A factory is a control plane, not a smarter agent.** Its value is in what surrounds the agent: queues, isolation, checks, humans, measurement.
- **Depend, don't copy.** A `file:` dependency plus one import file keeps the two projects separate but live-linked.
- **Name your seams.** Listing every deep import turns coupling into a to-do list (H31).
- **Build test infrastructure before you need it.** The clock and the ids are tiny now and save a lot later.
- How the commercial factories appear to do it: Devin, Codex and Copilot's coding agent all separate an **orchestrator** (queue, VMs, GitHub integration) from the **agent runtime** that runs inside each VM. Ours will follow the same split, with noobly as the runtime.
