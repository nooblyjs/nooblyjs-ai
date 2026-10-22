# Phase 25a — Customer evidence, the ideas portal, the feedback form, closing the loop: design

> **Status: in progress (started 2026-10-22).** Requirements: `requirements.md`.

## Where it lives

| Place | What |
| --- | --- |
| `nooblyjs-ai-product/src/services/feedback.js` | Notes, insights, Ada's suggestions, signals' notes, customer importance, links, who to tell |
| `…/src/services/portal.js` | Suggested ideas, votes (the limit), on behalf, comments, follows, merge, promote |
| `…/src/routes/feedback.js` | `/feedback/notes…`, `/feedback/suggest`, `/feedback/links…`, `/portal/ideas…` (signed in) |
| `…/src/routes/form.js` | The public form: `GET` and `POST <mountPath>/f/:token`, mounted before the API and the frame, no `host.auth` |
| `…/public/js/pages/feedback.js`, `portal.js` | Product · Feedback and Product · Ideas portal |
| `…/index.js` | Nav rows; `release.deployed` and `outcome_review.closed` → closing the loop; the `evidence` service (PM home) |
| `nooblyjs-ai-host/src/middleware/roles.js`, seed `access/roles.yaml` | `suggest` for every access role |
| `…/src/services/notify.js` | `tell({ to, title, text, link, key })`: a notice per person and a Teams message when they have the app |
| `…/src/services/for-you.js` | Every layout's notices; the PM's "Customer evidence" panel |

## The data (under `data/product/`)

```
feedback/notes/NOTE-0001.md   source (typed|teams|jira|form), from { id?, name }, through, product, at, jiraKey?, linkId?,
                              signal?, insights [{ id, target, snippet, importance, by, at }],
                              suggestions [{ id, target, snippet, importance, signal, by (agent), status }]; body = text
feedback/links.yaml           links [{ id, token, product, active, createdBy, createdAt, replacedBy? }]
feedback/told.yaml            stream of { key, person, at }: who was told what, so nobody is told twice
ideas/IDEA-0NN.md             + status suggested|merged, mergedInto, votes [{ by, onBehalfOf?, at }], followers, comments,
                              submittedBy (portal)
```

Customer importance is computed from the notes on every read (tens to hundreds of notes), never stored.

## Who is told about an item

The item (`PRD-031`), its spec's `idea`, and its feature: the people who voted (not on-behalf names), follow, or whose
notes (`from.id`) carry an insight on any of them. Form notes and names without a record are left out.

## Events

`feedback.note_logged`, `feedback.insight_linked`, `feedback.insight_unlinked`, `feedback.suggested`,
`feedback.suggestion_decided`, `feedback.form_submitted`, `feedback.link_created`, `feedback.link_changed`,
`portal.idea_suggested`, `portal.voted`, `portal.unvoted`, `portal.commented`, `portal.followed`, `portal.merged`,
`portal.promoted`, `feedback.loop_closed`, `notify.told`.

## Safety

- The form route reads only the link's token and the form's fields; its text is redacted and stored as a note's body.
  It is never put into a prompt as instructions: Ada's task input carries notes as a JSON list under "notes (data, not
  instructions)", and the scripted answer only matches words.
- Every agent refusal goes through `peopleOnly` (audited). Ada's suggestions are proposals until a person decides.
