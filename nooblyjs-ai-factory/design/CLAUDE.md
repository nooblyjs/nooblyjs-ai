# CLAUDE.md

Guidance for Claude Code in this folder.

This folder is the Software Factory's **Design section** (Phase 16c, root `product.md` §3.2a): from an item's Product
handoff it writes the **business requirements** (`BR-031-01`, each quoting the spec, accepted by a person with
`accept-requirement`), the **solution architecture** (impacted systems from Platform's repositories with their owning
team, NFRs from the NFR catalogue and the quality attributes, the feature landscape), the **functional analysis**
(interfaces with both sides named, technical requirements per system) and the **stories** (`STORY-031-1`) that build
each feature. Each story is a lifecycle item of its own and goes to Engineering with its own Design handoff.

| | |
| --- | --- |
| Where it answers | `/factory/design` (API at `/factory/design/api/v1`; pages in `../public/design/`) |
| Who mounts it | the Factory's `register()` (`../src/services/sections.js`) |
| Its data | `data/factory/design/`: `nfr-catalogue.yaml`, `items/<itemId>/design.md` |
| What other apps call | `host.service('design')`: `readinessFacts`, `designFor`, `items`, `acceptRequirement` |
| What it calls | `workflows` (items, `syncStories`, `handoffStory`), `product.designInputs`, `platform.repositories`, `teammates.runTask`, `knowledge.find` |

- `index.js`: `register()`, `NAV`. `src/repo.js`: the files. `src/services/design.js`: the rules. `src/services/drafts.js`:
  the scripted drafts (pure functions). `src/services/drafter.js`: who drafts, as a teammate task. `src/routes.js`: the API.
- Agents draft; people accept, edit, merge, split and hand off. Agents are refused every acceptance and handoff, in the
  route and in the service, and the refusal is audited.
- A draft only adds what is missing: it never overwrites what a person accepted or edited. Ids are never reused.
- The Architecture rows of the Design group are still the Product section's code and pages (`../product/`).

The shared rules are the Factory's copy: `../.claude/steering/nooblyjs-ai.md`. The spec is
`../../nooblyjs-ai-host/.claude/specs/phase-16c-design-section/`.

```bash
node --test "design/test/**/*.test.js"   # from nooblyjs-ai-factory/: this section's tests (offline)
```
