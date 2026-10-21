# Phase 19 — Security by design: summary

**Status:** done, signed off 2026-10-21 (built 2026-10-21; you marked every phase before 20 reviewed). Spec:
`.claude/specs/phase-19-security-by-design/` (all 9 tasks done). Root `product.md` §3.5 is what it builds. The work is
the new hosted app `nooblyjs-ai-security` (at `/security`, rail label Security), the Software Factory (the scan gates,
the SBOM in the evidence, `startWork` for a fix, Design's threat model) and `nooblyjs-ai-host` (the app's place, the
app approvals' refs by `id`, checks and trace, the Security engineer).

## What is there

| Area | What |
| --- | --- |
| The app | Threat models, Findings, Risk register, Policies; standalone with `npm start` (port 11009); passes the hosted-app checklist (`test/register.test.js`, `test/public/module.test.js`) |
| Threat models | `TM-031`, one per item, drafted by the security agent (Rook Vale; Rhea Voss when Rook is off shift, and it says so) as a teammate task from the Product section's container view: STRIDE per relation that crosses a trust boundary, each threat (`THR-031-1`) with a mitigation (`MIT-031-1`) that is a requirement or a quality attribute. Asked for from Design · Solution architecture. Accepted through the lifecycle's `threat-model` approval (`accept-threat-model`: Architect, Owner), on Security or Home · Approvals: the same decision |
| Scans | The scanner adapter (`scan(kind, target)`, only `mock`); the Software Factory's verify station asks Security to scan each run's commit after the repository's gates: secrets, SAST, SCA, licence, IaC, each a gate of its own that fails at or above its policy's level. The PR's evidence has a "Security scan and SBOM" section. A scan that can't be made fails closed |
| Findings | `FND-001`: severity, owner (the repository's, else the default), fix-by from the policy, state (open, fixing, closed, accepted). "Draft a fix as a PR" is a Software Factory run made for the finding (`request.noobly.findingId`); only that run's passing scan closes it, with the proof |
| Risk acceptance | A person, a reason and an expiry (at most 90 days): `accept-risk` for low and medium, an Owner for high and critical, never an agent (refused and audited). An expired acceptance reopens the finding, on the business clock |
| The host | `hosted-apps.yaml`; app approvals find their artefact by `designId` or `id`; Security's checks and trace in the item's Checks and Trace tabs; the Security engineer's work role and home (findings past or near fix-by, threat models waiting, risks ending, items with no threat model) |

## The test script

Run in the real app by `test/security.test.js` (Security, the Software Factory and Digital Teammates hosted), every step
passing:

1. Priya asks for PRD-031's threat model from Design: `TM-031` v1, threats on the slot hold flow, each with a
   mitigation; Priya can't accept it (403, audited); Thabo accepts it on Home · Approvals; PRD-031's Checks show
   Security's check passing.
2. "Slot chart on the store console" on `web-storefront` (its scripted agent adds `chart.js`): the SCA gate fails, the
   finding is opened (medium, PRD-031, the run), and the draft PR shows the finding and the SBOM.
3. The finding is Priya's (web-storefront's owner), fix by in 30 days. Priya asks for a fix: run "Remove chart.js"
   draws the chart as plain SVG; its scan passes and closes the finding, with the proof.
4. A medium finding accepted by Thabo for 30 days; the dev clock 31 days on: it is open again (`risk.expired`).
5. An agent (with an Owner's role) accepting a risk: refused `people_only`, `access.refused` audited.
6. Security · Policies and `/about` say the scanner is the mock, not a real scan.

And Thabo as a Security engineer: his home's tiles are past fix-by, open findings, threat models waiting (none: TM-031
is accepted) and risks ending; PRD-031 is not among the items with no threat model.

## Tests

- New: `nooblyjs-ai-security` (20 tests); the host's `test/security.test.js` (7).
- Changed: `test/services/checks-trace.test.js` (Security is named "Security" when it is not running); the Factory's
  design and intake tests for the threat model route and `startWork`.
- **Whole suites:** host 391 of 391 (384 before). Factory 586 of 590, 4 skipped, none failing. Security 20 of 20.

## Fixed while building

- **The chart script never added chart.js.** The harness's Write refuses a file that exists and wasn't read first, so
  the scripted builder's `package.json` write was dropped and the SCA gate passed. The script reads `package.json`
  first now (`examples/noobly/slot-chart-on-the-store-consol.json`).
- **Checks named Security by its key** when it was not running (`'security'`): `SYSTEM_WORDS` has it now.

## Open questions (defaults taken, `[CONFIRM]`)

1. Fix-by days per severity: critical 7, high 14, medium 30, low 90 (the roadmap's guide point).
2. Who may accept which risk: Architect or Owner for low and medium, an Owner for high and critical.
3. A finding's owner by default: the repository's owner in `policies.yaml`, else Thabo N. (the guide point).
4. Where Security sits on the rail: between Factory and Infra, icon `key`.
5. Which scanners are approved (`stack.md` §6): none yet, so the mock; Phase 15 makes it real.
6. Not looked at in a browser here: Security's six pages and the Security engineer's home. The tests read their APIs and
   check the module's routes.
