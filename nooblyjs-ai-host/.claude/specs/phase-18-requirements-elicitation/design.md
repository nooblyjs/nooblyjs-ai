# Phase 18 — Requirements elicitation: design

> **Status: built 2026-10-21, waiting for review.** Requirements: `requirements.md`. Summary: `.claude/phases/phase-18-summary.md`.

## Where it lives

| Place | What |
| --- | --- |
| `nooblyjs-ai-factory/product/src/services/elicitation.js` | One file per spec: stakeholders, sessions, candidates (the scripted draft and Ada's task), accept, merge, reject, criteria, the NFR walk, questions, the readiness fact, the views |
| `…/product/src/routes/elicitation.js` | `/elicitation/:id` and its writes, `/nfr-catalogue` |
| `…/product/index.js` | Creates it after the architecture service; its services; the `teams.meeting_notes_posted` listener; `readinessFacts` adds its fact |
| `…/product/src/routes/specs.js` | The spec's JSON carries `requirements` |
| `nooblyjs-ai-factory/design/` | `nfr-catalogue.yaml`: a `prompt` per category; the `nfrCatalogue` service |
| `nooblyjs-ai-factory/public/product/js/pages/elicitation.js`, `spec.js` | The Elicitation page; the spec's Requirements card |
| `nooblyjs-ai-host/src/lifecycle/services/engine.js` | `stageReadiness`: a product fact that carries `check.passed`/`check.failed` is an extra check of that item |
| `nooblyjs-ai-host/src/teams/bot.js` | `teams.meeting_notes_posted` carries the notes, the meeting and who was in it |
| `nooblyjs-ai-host/src/services/for-you.js`, `work-roles.yaml`, `public/js/pages/home/for-you.js` | The Business analyst |

## The data

```
data/factory/product/elicitation/PRD-033.md
  stakeholders  [{ id: STK-033-1, name, kind: person | team | outside, role: affected | decides | consulted, personId?, teamId? }]
  sessions      [{ id: SES-033-1, kind: interview | workshop | meeting, title, at, with, notes, source: manual | teams, by }]
  candidates    [{ id: CAN-033-1, text, kind: functional | nfr, category?, target?, quotes: [{ session, quote }],
                   status: proposed | accepted | merged | rejected, into?, reason?, requirement?, decidedBy?, draftedBy }]
  requirements  [{ id: REQ-033-01, text, kind, category?, target?, quotes, from: [CAN-…], acceptedBy, acceptedAt,
                   criteria: [{ id: AC-033-01-1, text }] }]
  nfr           { performance: { status: answered | not-applicable, answers: [{ text, target, requirement | candidate }], reason?, by, at } }
  questions     [{ id: Q-033-1, kind: question | assumption, text, owner, status: open | answered, answer? }]
data/factory/design/nfr-catalogue.yaml    categories: [{ key, label, prompt, entries }]
```

## The API (`/factory/product/api/v1`)

| Route | Permission | What |
| --- | --- | --- |
| `GET /elicitation/:id` | `read` | The view: everything above, the walk in words ("7 of 7 categories walked"), the summary |
| `POST /elicitation/:id/stakeholders` · `/sessions` · `/questions` | `draft` | Add one |
| `PUT /elicitation/:id/questions/:qid` | `draft` | Answer it |
| `POST /elicitation/:id/candidates/draft` | `draft` | Ada's candidates from every session's notes (a teammate task, `requirements-elicitation`) |
| `POST /elicitation/:id/candidates/:cid/accept` · `merge { into }` · `reject { reason }` | `accept-requirement`, people only | Decide one |
| `POST /elicitation/:id/requirements/:rid/criteria` | `draft` | An acceptance criterion |
| `PUT /elicitation/:id/nfr/:category` | `draft` | `{ answers: [{ text, target }] }` or `{ notApplicable: true, reason }` |
| `GET /nfr-catalogue` | `read` | The Design section's catalogue |

## Candidates

The scripted draft (and the stand-in when no model is configured) reads every session's notes sentence by sentence,
leaves out a speaker's label ("Store manager: …"), and keeps each sentence with a cue word (need, must, should, want,
has to, expects, requires, would like) as a candidate quoting it. Words like "ms", "seconds", "load" or "peak" make it
an NFR of that category. A model's answer is kept only where each candidate has its text and quotes. A candidate merged
into another is folded into the requirement the other becomes.

## Readiness

`readinessFacts(PRD-…)` returns the spec's seven facts and, while the spec has questions, `questions-answered` with
its words (`check.passed`, `check.failed`) and the open ones as its detail. The engine shows a fact with words as one
more check of that item, unless the stage already has a check of that key; so a spec with no questions still has seven.

## Teams

"post meeting notes to PRD-033" already posted the teammate's notes to the item's thread; the event now carries them,
and the Product section adds a `meeting` session (`source: teams`) when the item is a spec.
