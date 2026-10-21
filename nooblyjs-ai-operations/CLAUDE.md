# CLAUDE.md

Guidance for Claude Code in this repository.

`nooblyjs-ai-operations` is NooblyJS's **Operations** app (root roadmap Phases 22–23, root `product.md` §3.7): its
screens (a UI module in the NooblyJS frame) and its API at `/operations/api/v1`. **Part 1 (Phase 22)** is releases and
deployments: a release is one feature, released on its own once all its stories have passed Test, with an evidence
pack, release notes, a rollout and a rollback; two people give its deploy approval; the **deployer adapter** (only the
mock until a deployment tool is chosen) applies it through Infrastructure. Part 2 (Phase 23) adds SLOs, incidents and
outcome reviews. Progress is tracked in NooblyJS's one roadmap, `../.claude/steering/roadmap.md`; the Phase 22 spec is
`../nooblyjs-ai-host/.claude/specs/phase-22-release/`.

## Part of NooblyJS (read first)

This repo is hosted by **NooblyJS** (`../nooblyjs-ai-host`) at `/operations` (rail label Ops, icon `upload`). Before
changing how it starts, serves pages, signs people in, stores data, emits events or deploys anything, read
`.claude/steering/nooblyjs-ai.md` (the shared rules, imported below: noobly owns them, and the full contract is
`../nooblyjs-ai-host/.claude/steering/structure.md` §2a) and `.claude/steering/structure.md` (this repo's layout).
Where anything here conflicts with NooblyJS, NooblyJS wins.

@.claude/steering/nooblyjs-ai.md

## Commands

```bash
npm start      # node --env-file-if-exists=.env server.js   (standalone on :11010; NooblyJS loads index.js instead)
npm test       # node --test --test-timeout=20000 "test/**/*.test.js"   (offline, mock deployer, a stand-in host)
npm run seed   # writes the policies into data/operations/ (-- --reset to start again)
```

The roadmap's test script runs in the real app as `../nooblyjs-ai-host/test/release.test.js` (the Factory,
Teammates, Infrastructure, Security and Operations hosted).

## Rules this code keeps

- **Production changes only through a release.** Infrastructure refuses anything else and checks the release's
  `deploy` approval itself before the deployer's change lands (I10).
- **Two different people approve a deploy**, each with `deploy-production`, for themselves or on someone's behalf; an
  agent never. The approval is the lifecycle engine's (`ref.app: operations`): Home · Approvals and this app decide it
  the same way (`services.decideApproval`).
- **A release can't carry an open high or critical finding** without an accepted risk (Security's).
- **Nothing pretends to be a real deployment.** The mock deployer says so on every page and on Policies;
  `OPERATIONS_DEPLOYER` other than `mock` is refused at start.
- **Jira and Bitbucket writes go through NooblyJS's write gate** (`host.service('devtools').release.record`), never
  directly; while the gate is closed they are recorded, not sent.
- **Time is the host's clock** (`host.clock`).

This project lives in the `nooblyjs-ai` monorepo; `nooblyjs-core` is a separate repo next to it (`file:../../nooblyjs-core`).
