# CLAUDE.md

Guidance for Claude Code in this folder.

This folder is the Software Factory's **Test section** (`quality/`, Phase 16d, root `product.md` §3.2b and §4): quality,
built inside the Factory. It starts with **Test analysis**: for each story in Engineer, test cases from its acceptance
criteria (given/when/then, `TC-031-1-1`), which the AI must automate and at which level (`test-policy.yaml`), a contract
test per interface, an E2E test for its journey and what a person checks by hand, each marked ready by a test analyst.
Before the Engineering sign-off every criterion needs a ready case and every interface a ready integration test.

| | |
| --- | --- |
| Where it answers | `/factory/quality` (API at `/factory/quality/api/v1`; pages in `../public/quality/`) |
| Who mounts it | the Factory's `register()` (`../src/services/sections.js`); its row sits in the Engineering group |
| Its data | `data/factory/quality/`: `test-policy.yaml`, `test-analysis/<storyId>.md` |
| What other apps call | `host.service('quality')`: `readinessFacts`, `casesFor`, `summaryFor`, `stories` |
| What it calls | `workflows` (the story), `design.designFor` (its criteria, interfaces, NFRs), `teammates.runTask` |

Test approvals, test runs, coverage and defects join it with Phases 16e and 20 (until then they are the Factory's own
pages over CHG-008's sample). The shared rules are the Factory's copy: `../.claude/steering/nooblyjs-ai.md`. The spec is
`../../nooblyjs-ai-host/.claude/specs/phase-16d-engineering/`.

```bash
node --test "quality/test/**/*.test.js"   # from nooblyjs-ai-factory/: this section's tests (offline)
```
