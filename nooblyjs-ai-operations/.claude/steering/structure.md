---
inclusion: always
---

# nooblyjs-ai-operations: structure

How this repo is laid out. The hosted-app contract it follows is `../../nooblyjs-ai-host/.claude/steering/structure.md`
§2a (summarised in `nooblyjs-ai.md` here); what Operations does is root `product.md` §3.7.

## Files

| Path | What |
| --- | --- |
| `index.js` | `register(app, serverManager, options)`: checks everything, then mounts the API and the frame's pages; listens for `approval.decided`; returns the rail entry, nav, status card, `services` and `seed` |
| `server.js` | Standalone (`npm start`, port 11010): the same `register()` with the stand-in host (`test/fixtures/host.js`) |
| `src/routes/index.js` | The API at `<mountPath>/api/v1`: signed in, every write audited, one error shape |
| `src/services/releases.js` | Releases: create (one feature in Release), ask for the deploy approval (the risk threshold), the relayed decision, deploy steps, advance, rollback, deployments |
| `src/services/evidence.js` | The evidence pack, read from the lifecycle, the Test section and Security |
| `src/services/notes.js` | Release notes: the release agent's teammate task, with a scripted draft |
| `src/services/policies.js` | `policies.yaml` with its defaults: the rollout, the risk threshold, the agent, the feature-flag tool |
| `src/deployers/` | The deployer adapter: `deploy(release, step)`, `rollback(release, reason)`. Only `mock.js` (through Infrastructure) |
| `src/monitors/` | Phase 23, the monitoring adapter: `burned(sloId)`, `burn` (the mock's), `measure(goal)`. Only `mock.js` |
| `src/services/slos.js` | SLOs from quality attributes at the first deploy; budgets; alerts to on call (once per level) |
| `src/services/incidents.js` | Incidents: declare (and the signal), notes, resolve (the SRE agent's review), accept (Knowledge), follow-ups |
| `src/services/outcomes.js` | Outcome reviews: scheduled, due (the lifecycle's approval), the goals, closed; an idea from a missed goal |
| `src/repos/index.js` | Records over `host.store` |
| `public/js/module.js` | The UI module: Releases, a release, Deployments, Policies |

## Data (`data/operations/`)

| Path | What |
| --- | --- |
| `policies.yaml` | Operations' policies (defaults) |
| `releases/REL-NNN.md`, `releases/next-id` | One per release, with its evidence, notes, deployments and history |
| `slos/SLO-031-1.md`, `incidents/INC-NNN.md`, `outcome-reviews/OR-031.md` | Phase 23 |
| `monitor.yaml` | The mock monitor's burned minutes and measures |

## Services (`host.service('operations')`)

`releaseFor(id)` (the write gate asks whether two people approved it), `releases()`, `decideApproval` (the lifecycle
engine relays each person's decision on a release's deploy approval, and on an outcome review), `home()` (the SRE),
`slosFor(itemId)`, `incidents()`, `outcomeReviews()`, `measure({ measure, today, target })` (Phase 25b: the monitor's value
today, for Product's key results). `outcome_review.closed` carries `measured` (each goal's measure, before, now,
target, met) and `text` and `href` (Phases 25a and 25b).
