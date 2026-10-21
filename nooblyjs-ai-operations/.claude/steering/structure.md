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
| `src/repos/index.js` | Records over `host.store` |
| `public/js/module.js` | The UI module: Releases, a release, Deployments, Policies |

## Data (`data/operations/`)

| Path | What |
| --- | --- |
| `policies.yaml` | Operations' policies (defaults) |
| `releases/REL-NNN.md`, `releases/next-id` | One per release, with its evidence, notes, deployments and history |

## Services (`host.service('operations')`)

`releaseFor(id)` (the write gate asks whether two people approved it), `releases()`, `decideApproval` (the lifecycle
engine relays each person's decision on a release's deploy approval).
