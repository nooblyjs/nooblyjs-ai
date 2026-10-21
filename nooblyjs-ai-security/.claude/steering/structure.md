---
inclusion: always
---

# nooblyjs-ai-security: structure

How this repo is laid out. The hosted-app contract it follows is `../../nooblyjs-ai-host/.claude/steering/structure.md`
§2a (summarised in `nooblyjs-ai.md` here); what Security does is root `product.md` §3.5.

## Files

| Path | What |
| --- | --- |
| `index.js` | `register(app, serverManager, options)`: checks everything, then mounts the API and the frame's pages; returns the rail entry, nav, status card, `services` and `seed` |
| `server.js` | Standalone (`npm start`, port 11009): the same `register()` with the stand-in host (`test/fixtures/host.js`) |
| `src/routes/index.js` | The API at `<mountPath>/api/v1`: signed in, every write audited, one error shape |
| `src/services/threat-models.js` | One per item (`TM-031`), drafted by the security agent (a teammate task, `threat-modelling`) from the Product section's container view; decided by a person |
| `src/services/stride.js` | The scripted draft: each relation that crosses a trust boundary gets STRIDE threats (`THR-031-1`), each with a mitigation (`MIT-031-1`) that is a requirement or a quality attribute |
| `src/services/scans.js` | `scanChange()`: each policy gate through the scanner, findings recorded, the SBOM; closes a finding on its fix run's passing scan |
| `src/services/findings.js` | Findings (`FND-001`): severity, owner, fix-by, state (open, fixing, closed, accepted); "Draft a fix as a PR"; risk acceptance and its expiry |
| `src/services/policies.js` | `policies.yaml` with its defaults: fix-by days, gates and their levels, who may accept which risk, approved packages, denied licences, default owners |
| `src/services/approvals.js` | The `threat-model` approval in the lifecycle engine (`requestAppApproval`, `closeAppApproval`) |
| `src/services/checks-trace.js` | `checksFor(itemId)` and `trace(itemId)` in NooblyJS's one shape (Phase 16f) |
| `src/services/summary.js` | The status card and the Security engineer's home |
| `src/services/event-words.js` | The sentence Activity shows for each event this app emits |
| `src/scanners/` | The scanner adapter: `scan(kind, target, policies) → findings`, `sbom(target)`. Only `mock.js` |
| `src/repos/index.js` | Records over `host.store` |
| `src/seed/` | The seed story: `policies.yaml` and two findings on PRD-031 |
| `public/js/module.js` | The UI module: Threat models, a threat model, Findings, a finding, Risk register, Policies |

## Data (`data/security/`)

| Path | What |
| --- | --- |
| `policies.yaml` | Security's policies (sample defaults) |
| `threat-models/TM-NNN.md` | One per item; versions replace each other, the history is kept in the record |
| `findings/FND-NNN.md`, `findings/next-id` | One per finding |
| `scans/scans.yaml` | Every scan, appended: its results and how many components its SBOM had |

## Services (`host.service('security')`)

`draftThreatModel`, `threatModelFor`, `findingsFor`, `riskFor` (for Release, Phase 22), `scanChange` (the Software
Factory's verify station), `scanEnvironment` (Phase 21: DAST and the image scan in an environment), `acceptRisk`, `home`, `checksFor`, `trace`, `decideApproval`. The Software Factory's
`startWork` is what "Draft a fix as a PR" calls; its `run.finished` links the fix to its PR.
