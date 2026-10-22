# Phase 25a — Customer evidence, the ideas portal, the feedback form, closing the loop: design

> **Status: built (2026-10-22), waiting for your review.** Requirements: `requirements.md`.

## Where it lives

| Place | What |
| --- | --- |
| `nooblyjs-ai-product/src/services/feedback.js` | Notes, insights, Ada's suggestions, signals' notes, links, the form's submissions, who to tell |
| `…/src/services/evidence.js` | Customer importance in words, computed from the notes on each read; signals' note counts |
| `…/src/services/portal.js` | Suggested ideas, votes (the limit), on behalf, comments, follows, merge, promote |
| `…/src/services/loop.js` | Closing the loop on `release.deployed` (production) and `outcome_review.closed` |
| `…/src/routes/feedback.js` | `/feedback/notes…`, `/feedback/suggest`, `/feedback/links…`, `/feedback/importance`, `/feedback/home`, `/signals/:id/notes`, `/portal/ideas…` (signed in) |
| `…/src/routes/form.js` | The public form: `GET` and `POST <mountPath>/f/:token`, mounted before the API and the frame, no `host.auth` |
| `…/public/js/pages/feedback.js`, `portal.js` | Product · Feedback and Product · Ideas portal (sidebar group Customers) |
| `…/src/services/views.js`, `board.js` | Cards carry `evidence`; signals say their notes; suggested and merged ideas stay off the board |
| `…/index.js` | Nav rows; the events → `loop.js`; services `evidence`, `importance`, `peopleToTell` |
| `nooblyjs-ai-operations` | `releaseFor` also gives name, version, notes and link; `release.deployed` names `environmentKind`; `outcome_review.closed` carries `text` and `href` |
| `nooblyjs-ai-host/src/middleware/roles.js`, seed `access/roles.yaml`, `services/teams.js` | `suggest` for every access role, and its row on Teams & roles |
| `…/src/services/notify.js` | `tell({ to, title, text, link, key })`: a notice per person and a Teams message when they have the app; `notices(personId)` |
| `…/src/services/for-you.js`, `public/js/pages/home/for-you*.js` | Every layout's "News for you"; the PM's "Customer evidence" |

## The data

Under `data/product/`:

```
notes/NOTE-0001.md      source (typed|teams|jira|form), from { id?, name }, through, product, jiraKey?, linkId?, signal,
                        insights [{ id, target, snippet, importance, by, at, suggestedBy? }],
                        suggestions [{ id, target, snippet, importance, signal, by (agent), status }]; body = the text
feedback-links.yaml     links [{ id, token, product, active, createdBy, createdAt, replaces?, replacedBy? }]
ideas/IDEA-0NN.md       + status suggested|merged, mergedInto, merged [ids], votes [{ id, by, onBehalfOf?, at, from? }],
                        followers, comments, submittedBy, promotedBy, shippedAt
specs/PRD-0NN.md        + shippedAt, shippedIn (its first release in production)
```

NooblyJS keeps who was told what in `data/notices/<personId>.yaml` (the newest 50, each with its `key`), so nobody is
told the same thing twice. Customer importance is computed from the notes on every read, never stored.

## Who is told about an item

The item (`PRD-031`), its spec's idea, its feature (and the ideas merged into those): the people who voted (not
on-behalf names), follow, or whose notes (`from.id`) carry an insight on any of them. Form notes and names without a
record are left out.

## Events

`feedback.note_logged`, `feedback.insight_linked`, `feedback.insight_unlinked`, `feedback.signal_set`,
`feedback.suggested`, `feedback.suggestion_decided`, `feedback.form_submitted`, `feedback.link_created`,
`feedback.link_changed`, `portal.idea_suggested`, `portal.voted`, `portal.unvoted`, `portal.commented`,
`portal.followed`, `portal.merged`, `portal.promoted`, `feedback.loop_closed`, `notify.told`.

## Safety

- The form route reads only the link's token and the form's fields; its text is redacted and stored as a note's body.
  It is never put into a prompt as instructions: Ada's task input carries the notes as JSON under "notes (data, not
  instructions)", and her answer is filtered to notes she was asked about, records that exist, words from the note and
  a known importance. The scripted answer only matches words.
- The form keeps NooblyJS's CSRF check (the cookie is set on its GET; the page sends it back as `_csrf`). It has no rate
  limit: the host's general limit covers `/api/…` only (decided 2026-10-22: no limit on submissions).
- Every agent refusal goes through `peopleOnly` (audited). Ada's suggestions are proposals until a person decides.
