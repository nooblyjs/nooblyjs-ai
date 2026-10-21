# CLAUDE.md

Guidance for Claude Code in this repository.

`nooblyjs-ai-security` is NooblyJS's **Security** app (root roadmap Phase 19, root `product.md` §3.5): its screens (a UI
module in the NooblyJS frame), its API at `/security/api/v1`, **threat models**, **findings**, the **risk register** and
**policies**. It scans every Software Factory run through its **scanner adapter** (only the mock exists until a scanner
is approved, root `stack.md` §6). Progress is tracked in NooblyJS's one roadmap, `../.claude/steering/roadmap.md`; the
Phase 19 spec is `../nooblyjs-ai-host/.claude/specs/phase-19-security-by-design/`.

## Part of NooblyJS (read first)

This repo is hosted by **NooblyJS** (`../nooblyjs-ai-host`) at `/security` (rail label Security, icon `key`, between
Factory and Infra). Before changing how it starts, serves pages, signs people in, stores data, emits events or scans
anything, read `.claude/steering/nooblyjs-ai.md` (the shared rules, imported below: noobly owns them, and the full
contract is `../nooblyjs-ai-host/.claude/steering/structure.md` §2a) and `.claude/steering/structure.md` (this repo's
layout). Where anything here conflicts with NooblyJS, NooblyJS wins.

@.claude/steering/nooblyjs-ai.md

## Commands

```bash
npm start      # node --env-file-if-exists=.env server.js   (standalone on :11009; NooblyJS loads index.js instead)
npm test       # node --test --test-timeout=20000 "test/**/*.test.js"   (offline, mock scanner, a stand-in host)
npm run seed   # writes the seed story into data/security/ (-- --reset to start again)
```

The roadmap's test script runs in the real app as `../nooblyjs-ai-host/test/security.test.js` (Security, the Software
Factory and Digital Teammates hosted).

## Rules this code keeps

- **People decide, agents draft.** Accepting a threat model needs `accept-threat-model` (Architect, Owner); accepting a
  risk needs `accept-risk` for low and medium, an Owner for high and critical. An agent is refused `people_only` and
  the refusal audited, even with an Owner's role.
- **A threat model's approval is the lifecycle engine's** `threat-model` approval: decided here or on Home · Approvals,
  the same rules run (`services.decideApproval`), and the approval is recorded once.
- **Closing a finding needs proof**: only the scan of the run made for it (`request.noobly.findingId`), no longer
  finding it, closes it. There is no "close" button.
- **Environments are scanned too** (Phase 21): `scanEnvironment` (DAST, the image scan) runs as one of an environment's
  suites for the Factory's Test section; its findings are linked to the environment, the preview's pull request and
  its story, and the suite fails at `environmentScans`' level (default high).
- **Nothing pretends to be a real scan.** The mock scanner says so on every gate, in the PR's SBOM section and on
  Policies; `SECURITY_SCANNER` other than `mock` is refused at start.
- **Time is the host's clock** (`host.clock`): fix-by dates and risk expiries move with NooblyJS's dev clock. Never
  `Date.now()` for them.
- **Policies are data** (`data/security/policies.yaml`); every value there is a Phase 19 default `[CONFIRM]`.

This project lives in the `nooblyjs-ai` monorepo; `nooblyjs-core` is a separate repo next to it (`file:../../nooblyjs-core`).
