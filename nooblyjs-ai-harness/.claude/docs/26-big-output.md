# Phase 26: Big output without losing it

**Goal:** a 20,000-line test log shouldn't lose its middle, where the one failing test is.

---

## Truncation throws information away

Since Phase 08, every tool result above ~40,000 characters was cut in the middle:

```
ok 1 … ok 14999   ← start kept
… [1,203,441 characters omitted] …
ok 49998 … done   ← end kept
```

Start and end are usually the useful parts, but not always. The failing test at line 30,000 was simply gone, and the only way back was to run the command again with different filtering (if it's even repeatable).

## Page it instead (`src/tools/truncate.js`)

Now the loop saves the **whole** output to a file first, and the model gets:

```
ok 1
…                                    (~12,000 characters of the start)
… [47,212 lines not shown: lines 612–47823 of 50,000] …
…                                    (~8,000 characters of the end)
ok 50000

[Output too long for one message. The full output is saved in
 ~/.noobly/projects/<slug>/checkpoints/<conversation>/tool-results/toolu_01X.txt
 (50,000 lines, 1,234,567 characters). Read it with offset/limit (e.g. offset=612), or Grep it with path set to that file.]
```

Then, as usual:

```
Grep({ pattern: "FAIL", path: ".../toolu_01X.txt", output_mode: "content" })   → :30000:FAIL: parser test
Read({ file_path: ".../toolu_01X.txt", offset: 29990, limit: 20 })
```

The preview is cut at **whole lines** (and says exactly which lines are missing), so the model can Read precisely the part it skipped.

## Details that matter

- **One place for it:** the loop does this for **every** tool, so Bash no longer cuts its own output, and WebFetch keeps whole pages. MCP tool results get it for free.
- **Where:** next to the conversation's checkpoints (Phase 21), named by the tool call id. `--continue` finds them again.
- **Access:** that folder is added to Read's (and now Grep's) readable folders, like skills and memory. It is outside the project, so the sandbox and deny rules don't need changes.
- **Compaction (Phase 08)** clears big old tool results to save space. Now it first saves each one (if it wasn't saved already) and leaves the **path** instead of *"run the tool again"*. Clearing loses nothing.
- **Without a place to save** (tests, a session without checkpoints), everything behaves as before: cut in the middle, and WebFetch cuts pages at 30,000 characters.

## A deliberate non-feature: no automatic cleanup

The roadmap suggested deleting the files with the session. But a session can be resumed any time (`--continue`, `/resume`), and its history points at those files. So they live exactly as long as the conversation's other saved state; deleting old conversations (`~/.noobly/projects/…`) deletes them too.

## What we learned

- **Paging beats truncation**: keep everything, show a window, hand over the key.
- Put a cross-cutting rule in **one place** (the loop), and remove the per-tool copies.
- Say **exactly** what was left out (line ranges), so the next step can be precise.
- The context window is a cache, not the storage: the disk is the storage.
- How Claude Code appears to do it: large tool results are persisted to a file, and the model gets a preview and the path (it happened in the session that planned this phase).
