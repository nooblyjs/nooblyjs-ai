# Phase 19 — Security by design: requirements

> **Status: done, signed off 2026-10-21** (built 2026-10-21). Summary: `.claude/phases/phase-19-summary.md`. Root `product.md` §3.5, `design.md` §8–§9; root `roadmap.md` Phase 19.
> Bugs found while reviewing it go in `.claude/specs/bugs-and-changes/`.

> Asked 2026-10-21: "Yes please commit and push and then do the next phase" (16a–18 still waiting for review).

Goal: every item has a threat model accepted by an Architect, and every PR is scanned, with findings that have an owner
and a fix-by date.

## Decisions taken before starting (2026-10-21, the defaults)

- **The app** is `nooblyjs-ai-security`, hosted at `/security`, rail label **Security** (icon `key`), between Factory
  and Infra (root `product.md` §9 open question 2) `[CONFIRM]`.
- **Fix-by days** per severity (root `product.md` §9 open question 5), in Security's `policies.yaml`: critical 7, high
  14, medium 30, low 90 `[CONFIRM]`.
- **Who may accept which risk**: a low or medium risk takes `accept-risk` (Architect, Owner); a high or critical one an
  Owner `[CONFIRM]`. An acceptance has a reason and an expiry of at most 90 days; when it expires the finding is open
  again.
- **Scanners**: none is approved yet (`stack.md` §6), so the phase runs on the **mock scanner**, and says so on
  Security · Policies. Any other `SECURITY_SCANNER` is refused at start.
- **A finding's owner by default**: the repository's owner in `policies.yaml` (`web-storefront` → Priya S.), else the
  default owner (Thabo N.) `[CONFIRM]` (the roadmap's guide point).
- **The security agent** is Rook Vale (Security Reviewer, Digital Teammates); when Rook can't take work (off shift, as
  in the seed) Rhea Voss (Architect) drafts instead, and the threat model says who did.
- **The threat model** is one per item (`TM-031`), drafted from the Product section's container view: each relation
  that crosses a trust boundary (people's devices, outside systems, the edge, services, data) gets STRIDE threats
  (`THR-031-1`), each with a mitigation (`MIT-031-1`) that is a requirement or a quality attribute. Drafting opens a
  `threat-model` approval (Architect, `accept-threat-model`).
- **Scans as gates**: the Software Factory asks Security to scan each run's commit on a clean checkout (secrets, SAST,
  SCA, licence, IaC) after the repository's own gates; each kind is a gate in the run's evidence, with an SBOM. A gate
  fails when a finding is at or above its policy's level.
- **A fix** is a Software Factory run made for the finding (`request.noobly.findingId`), on the repository's main
  branch; the finding closes only when that run's scan passes for it.

## R1 — The hosted app
Threat models, Findings, Risk register, Policies; passes the hosted-app checklist; standalone with `npm start`.

## R2 — Threat models
Drafted by the security agent as a teammate task, accepted through the `threat-model` approval by a person with
`accept-threat-model` (on Security or Home · Approvals: the same decision); a Contributor can't; an agent is refused and
audited. Design · Solution architecture asks for it and shows it.

## R3 — Scans, gates and the SBOM
The scanner adapter (`scan(kind, target) → findings`), mock first. Build gates for secrets, SAST, SCA and licence, IaC;
the SBOM on each PR.

## R4 — Findings
Severity, owner, fix-by, state (open, fixing, closed, accepted); "Draft a fix as a PR"; closing needs a passing scan.

## R5 — Risk acceptance
A person, a reason and an expiry; agents refused and audited; an expired acceptance reopens the finding (on the
business clock).

## R6 — The Security engineer
The work role and home: findings past or near fix-by, threat models waiting, risks expiring, items with no threat model.

## Test script (roadmap Phase 19)
1. Open PRD-031 · Design · Solution architecture: ask for a threat model. It lists threats on the slot hold flow, each
   with a mitigation. As Thabo, accept it; as Priya, you can't.
2. A Factory run on `web-storefront` fails the SCA gate (the unapproved chart library). The PR shows the finding.
3. The finding has an owner and a fix-by date. Ask for a fix: a PR appears. Its scan passes; the finding closes.
4. Accept a medium risk with a reason and a 30-day expiry. Move the dev clock 31 days: the finding is open again.
5. An agent tries to accept a risk: refused and audited.
6. The scanner adapter is set to `mock` and says so on Security · Policies; nothing pretends to be a real scan.

The run of step 2 is a PRD-031 work item ("Slot chart on the store console") started the way a handoff starts one; its
scripted agent adds `chart.js` to the demo repository.

**Done when:** steps 1–6 pass and `nooblyjs-ai-security` passes the hosted-app checklist.
