# Bugs and changes: requirements

> **Status: open, ongoing.** This spec has no end. It is the one place to log what is wrong with, or should be
> different in, a phase that is already built. The log is `tasks.md`; how a fix is made is `design.md`.
> New features still go into a roadmap phase (`.claude/steering/roadmap.md`), not here.

## R1. What goes here

1. **Bug (BUG-NNN):** NooblyJS does not do what its spec, the steering docs or a phase's test script say it does.
2. **Change (CHG-NNN):** NooblyJS does what was agreed, but what was agreed should be different: copy, layout, a
   default, a rule, a small piece of behaviour.
3. One log for every repo: `nooblyjs-ai-host` and its siblings (`nooblyjs-core`, `noobly-ai-*`). The entry names the repo; the fix
   is committed in that repo.
4. A phase still waiting for review (Phase 12 and 13 at the time of writing) logs its review findings here too.
5. Not here: new screens, services, integrations or repos. Those are roadmap phases (R5).

## R2. An entry

1. Every entry has an ID that is never reused: `BUG-001`, `BUG-002`… and `CHG-001`, `CHG-002`…. The next free
   numbers are kept at the top of `tasks.md`.
2. A bug records: title, severity, area, repo, phase, found (date), steps, expected, actual. Optional: who found
   it, screenshots or files (under `docs/bugs/BUG-NNN/`), notes.
3. A change records: title, area, repo, phase, asked (date), what and why, and the steering doc it changes, if
   any.
4. Area is one of: Home, Lifecycle, Approvals, Activity, For you, Onboarding, Chat, Metrics, Platform, Product,
   Factory, Teammates, Knowledge, Infrastructure, Dev tools (Jira and Bitbucket), Teams bot, Microsoft 365,
   Shell (rail, sidebar, kit), Seed, Electron, Edge, Docs.
5. Severity, for bugs:

   | Severity | Means |
   | --- | --- |
   | **S1** | A governance rule is broken (an agent approves or merges, a write is not audited, anything is sent to Jira or Bitbucket outside the write gate), data is lost, or a phase's test script cannot pass. Fix before anything else. |
   | **S2** | Wrong behaviour, with a way around it. |
   | **S3** | Cosmetic: copy, layout, a mismatch with the mockup. |

## R3. Status

1. An entry moves **open → fixing → fixed → verified**, or is **won't fix** / **duplicate of BUG-NNN** with a
   reason.
2. **fixed** means the change is made and its tests pass; the entry names the commit(s).
3. **verified** is set only by you, after checking it in NooblyJS. Its checkbox is ticked then, not before.
   (Agents propose, people decide: the fixer never ticks the box.)

## R4. How a fix is made

1. A bug fix starts with a test that fails because of the bug, then the fix that makes it pass. Where no
   automated test can show it (pure layout), the entry says how to check it by hand.
2. `npm test` passes after the fix. A fix in a sibling repo also runs that repo's tests.
3. A fix stays inside the bug. Anything else it uncovers is logged as its own entry.
4. Tests never write to Jira or Bitbucket: use `test/fixtures/atlassian.js`, never a real fetch.

## R5. Changes and the steering docs

1. A change that alters what NooblyJS does or how it is built updates the steering doc that owns it (`product.md`,
   `tech.md`, `structure.md`) in the same commit, and the entry names the section.
2. A change that touches what every repo shares updates `.claude/steering/nooblyjs-ai-shared-rules.md` and runs
   `npm run steering:sync`.
3. A change bigger than a small piece of work (a new screen, service, integration or repo, or more than a
   couple of days) becomes a roadmap phase. The entry is closed as **moved to Phase NN**.
4. The phase specs that are done stay as they were built. A change here does not edit them; their summary in
   `.claude/phases/` may get a line pointing to the entry.
