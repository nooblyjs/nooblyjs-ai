# Phase 25a — Customer evidence, the ideas portal, the feedback form, closing the loop: summary

**Status:** done (built and reviewed 2026-10-22). Spec: `.claude/specs/phase-25a-customer-evidence/` (tasks 1–10
done). Your decisions on 2026-10-22: the feedback form on a link instead of a support-tool connector, no sign-in
(anyone with the link), no email source, no limit on submissions, 10 open votes. The work is in
`nooblyjs-ai-product`, `nooblyjs-ai-host` and `nooblyjs-ai-operations`.

## What is there

| Area | What |
| --- | --- |
| Product · Feedback | Notes (`NOTE-0001`) typed in, pasted from Teams, read from a Jira issue by key (devtools), or from the form; redacted on the way in. Filters by product, source, "not linked yet", signal. Link a snippet to an idea, feature or spec with an importance (an insight); put a note in a signal or a new one. People only for links and decisions |
| Ada's suggestions | A teammate task (`feedback-triage`). The notes go to her as data; her answer is filtered to existing records and words from the note. The scripted answer matches words and product. A person accepts (choosing the importance) or declines |
| Customer importance | "3 colleagues across 1 portfolio; 1 says critical · 1 form note" on board cards (ideas and specs), the portal and `GET /feedback/importance`; computed from the notes, never stored; RICE untouched. Form notes count apart |
| Signals | Count their notes ("3 notes · 412 tickets · Zendesk (sample data)"); the board links to them |
| The feedback form | `/product/f/<token>`, one server-rendered page, no script, nothing of NooblyJS but the product's name. NooblyJS's CSRF check still applies. No rate limit. A spam field; 2,000 characters. Links are made, switched off and replaced on Feedback (audited) |
| Product · Ideas portal | For everyone signed in (`suggest`, every access role, agents refused): put an idea forward (suggested, off the board), vote within 10, vote on behalf of a colleague, take a vote back, comment, follow. `draft` merges (votes, followers, comments carried) or promotes |
| Closing the loop | On a release's first step into production, and when its outcome review closes, the people who voted for, follow, or whose notes are linked to the item, its idea and its feature are told: NooblyJS's new `notify.tell` puts a notice on their For you page ("News for you") and messages them in Teams where they have the app; once per person per key |
| The PM's home | "Customer evidence": notes not linked yet, Ada's suggestions waiting, portal ideas waiting, who will be told |
| Operations | `releaseFor` gives the release's name, version, notes and link; `release.deployed` says `environmentKind`; `outcome_review.closed` carries its text and link |

## The test script

All in the real app (`nooblyjs-ai-host/test/customer-evidence.test.js`, 7 tests, Product, Design, Factory, Teammates,
Infrastructure, Security, Operations and Knowledge hosted), and in Product's own tests
(`nooblyjs-ai-product/test/routes/feedback.test.js`, 7 tests, which also sign in as Ada to prove the refusals).

1. Priya logs four notes (one from Teams); Ada suggests PRD-031 for three and IDEA-019 for the fourth; Lerato accepts
   one as critical: PRD-031 says "3 colleagues across 1 portfolio; 1 says critical". The phone number is "[phone]".
1a. A link for Delivery, opened signed out: six submissions in a row, all taken; one asking Ada to approve PRD-031 is
   kept as text and nothing is approved; without the CSRF token, 403; switched off, "This feedback form is closed";
   linked, PRD-031 adds "· 1 form note".
2. "Slots sell out before 10:00" says "3 notes · …"; the board filtered by Delivery shows PRD-031's evidence and not
   IDEA-019 (Checkout's).
3. Naledi (Viewer) puts "Let me add to my order after paying" forward and votes; the eleventh vote is refused with
   her votes listed; Thabo votes on behalf of "Store manager, Sandton"; Ada's vote and submission are 403 and audited.
4. Lerato merges it into IDEA-019 (2 votes carried, followers too) and promotes another idea onto the board.
5. Slots 1.0 reaches production: Thabo (his note is linked) has "Same-day delivery slots shipped" on For you with the
   release notes; Teams skipped (no app) and audited; the rest of the rollout tells nobody again; Naledi isn't told.
   After the outcome review: "Same-day delivery slots: 0 of 3 goals met", linking to OR-031.

The roadmap's products were swapped to match the seed: PRD-031 is Delivery's and IDEA-019 Checkout's.

## Tests

Product 171 of 171; Operations 20 of 20; Design 19 of 19; NooblyJS 424, of which 423 pass. The one failure,
`test/kit.test.js` "shell renderers: … nav groups …", fails the same way without this phase's changes: it expects the
sidebar's group markup that nooblyjs-core's renderer doesn't produce yet.

## Not done or open

- Not checked in a browser: Playwright's Chromium needs system libraries this codespace doesn't have
  (`npx playwright install-deps chromium`, which needs sudo). `npm run test:e2e` hasn't been run.
- The feedback form has no rate limit at all, as decided. Anyone with a link can fill the inbox; switching the link off
  or replacing it is the remedy.
- Named colleagues with no NooblyJS record (the store managers) are never told: they have no For you page or Teams
  address in NooblyJS.
