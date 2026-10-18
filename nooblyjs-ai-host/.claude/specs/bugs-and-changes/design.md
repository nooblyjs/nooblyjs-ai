# Bugs and changes: design

> Requirements: `requirements.md`. The log: `tasks.md`.

## 1. The log

- `tasks.md` holds every entry as a Kiro checkbox with the fields as sub-bullets, in two sections: **Bugs** and
  **Changes**. Open entries first, S1 at the top.
- When an entry is verified, its box is ticked and it moves to **Closed** at the end of the file (newest first),
  so the open list stays short. When Closed grows past about 50 entries, the oldest move to `closed.md`.
- Evidence that does not fit in a line (screenshots, a copied `data/` file, a log) goes in `docs/bugs/BUG-NNN/`.
  Never copy real personal data or tokens there.

## 2. Logging a bug

1. Reproduce it on a fresh seed if you can (`npm run seed -- --reset`, then the steps). If it only shows on your
   own data, say so in the entry.
2. Note the dev clock if it was moved (`/dev/clock`): targets, reminders and Metrics depend on it.
3. Note who you were signed in as (the dev picker's seeded people) and their access role.

## 3. Fixing

1. Mark the entry **fixing**.
2. Write the failing test where the code's other tests are: `test/` in `nooblyjs-ai-host` (API tests with `createApp()` on port
   0; lifecycle in `test/lifecycle/`), the sibling repo's own tests otherwise, or a Playwright spec in `test/e2e/` when
   only the browser shows it.
3. Fix, run `npm test` (and the sibling's tests), mark **fixed** with the commit.
4. You check it in NooblyJS and tick the box: **verified**.

## 4. Commits

- One entry per commit where possible; the message starts with the ID: `BUG-004: Approvals count ignores
  withdrawn approvals`.
- Commits end with the `Co-Authored-By` line, and are made only when you ask.
