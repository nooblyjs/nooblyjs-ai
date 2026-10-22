# Phase 25a — Customer evidence, the ideas portal, the feedback form, closing the loop: requirements

> **Status: in progress (started 2026-10-22).** Root `roadmap.md` Phase 25a; the comparison it came from is
> `.claude/audits/2026-10-21-product-tools-comparison.md`.

> Asked 2026-10-22: "Lets make the feedback tool just a feedback from on a link ... no need to log in", "the link can
> be used by anyone who gets it", "Email address: Please drop it. No limit of submissions. 10 open is good", "yes go
> ahead".

Goal: every idea shows who asked for it, for which portfolio, and how much it matters to them; colleagues put ideas
forward and vote; anyone with a product's feedback link can say something without signing in; and every colleague who
asked hears when it ships and whether it worked.

## Decisions taken before starting

From 2026-10-21 (roadmap Phase 25) and 2026-10-22 (above):

- **Sources of feedback:** typed in by a person, a Teams message (pasted in, its source "Teams"), a Jira issue (read
  through NooblyJS's devtools by its key) and the **feedback form on a link**. No support-tool connector, no email.
- **The customer is the portfolio.** No customer records, no CRM, no revenue. A note is about a portfolio, value stream
  and product from the catalogue (the product names the other two).
- **The feedback form needs no sign-in.** Anyone who gets the link can use it, inside Acme or not. There is **no limit
  on submissions** (and no rate limit: the host's general limit covers `/api/…` only, not this page). Its senders are
  not told anything back, are not counted as colleagues who asked, and no email address is asked for. It keeps the
  host's CSRF check, which works signed out (the double-submit cookie is set on the page's GET).
- **The portal is for colleagues only, always**: everyone signed in to NooblyJS. The form is not the portal.
- **`suggest`**: a new permission every access role has, Viewer included; agents never.
- **Votes:** 10 open votes per person (a vote on an idea that has shipped or closed no longer counts). A vote on
  behalf of a colleague counts against the person who casts it.
- **Scoring stays RICE.** Customer importance shows beside the score and never changes it.
- **Being told** is a notice on the person's For you page and a message in Teams when they have the NooblyJS app
  there (as approvals are). Who to tell: the people (NooblyJS records) who voted for, follow, or whose notes are linked
  to the item, its idea and its feature. Named colleagues with no NooblyJS record and form senders are not told.

## R1 — The feedback inbox, notes and insights
- Product · Feedback lists notes (`NOTE-0001`), newest first, filtered by portfolio, value stream, product, source and
  "not linked yet". A note keeps its text (redacted on the way in: email, phone and ID numbers, `util/redact.js`), its
  source, the colleague it came from (a NooblyJS person or a name) or through (who logged it), its product (and so its
  portfolio and value stream), and when.
- A person with `draft` logs a note. With the source Jira and an issue key, the text is the issue's summary and
  description, read through `host.service('devtools').jira.issue(key)`; when Jira can't be read the person is told why.
- A person with `draft` links a snippet of a note to an idea, feature or spec with an importance (nice to have,
  important, critical): an **insight**. Unlinking is the same permission. Each is audited and an event.
- **Ada suggests** (a teammate task, `feedback-triage`): for each unlinked note, the idea or spec it is most likely
  about, the snippet and an importance, and the signal it belongs to. The suggestions are proposals on the note; a
  person accepts or declines each (agents refused, audited). The note's text goes to Ada as quoted data, never as
  instructions; the scripted answer (no model) matches words in the note to titles and signal themes.
- **Signals count real notes**: a note can belong to one signal (Ada's suggestion accepted, or a person's choice). A
  signal with notes says "3 notes"; a seeded signal keeps its sample count beside it ("3 notes · 412 tickets (sample
  data)"). Clicking a signal lists its notes.

## R2 — Customer importance
- Every idea, feature and spec has its customer importance, from its insights: how many colleagues asked, across how
  many portfolios, how many say critical, and the form notes apart ("3 colleagues across 1 portfolio; 1 says critical ·
  1 form note"). Insights on a spec's idea count for the spec too.
- The board's cards show it under the RICE score, which does not change. The board's filters already narrow by
  portfolio, value stream and product; the evidence in the inbox does the same.

## R3 — The `suggest` permission
- In NooblyJS's matrix (`BUILT_IN_PERMISSIONS` and the seed `roles.yaml`): Viewer, Contributor, Approver, Architect,
  Owner. Submitting, voting, commenting and following in the portal need it. An agent is refused (403, audited) even
  with the permission.

## R4 — The ideas portal
- Product · Ideas portal, for anyone signed in: the ideas with their status in words (Suggested, On the board, Being
  specced, In progress, Shipped, Closed, Merged into IDEA-019), their portfolio and product, votes and followers.
- Submit an idea for a product (`suggest`): it is an idea with the status **suggested**, not on the board yet.
- Vote (`suggest`), within 10 open votes; past the limit the person is told why and which votes they could take back.
  Take a vote back. Vote **on behalf of** a colleague (a name, kept with the vote).
- Comment and follow (`suggest`). The submitter and voters follow by default.
- A person with `draft` **merges** a suggested idea into another (votes, followers and comments carried over; the
  merged one says where it went) and **promotes** a suggested idea to the board (status open).

## R5 — The feedback form on a link
- A person with `draft` makes a link for a product (`/product/f/<token>`, 32 random bytes in base64url) on the Feedback
  page, and can switch it off or replace it (a new token; the old one stops working). Each is audited.
- The page is outside sign-in and the frame: one server-rendered HTML page, no script, with the product's name, one
  text box (2,000 characters), an optional name, a hidden spam field and the CSRF field. Nothing of NooblyJS is shown.
- A submission is a note from "Feedback form", tagged with the link's product, redacted, audited as from an anonymous
  sender (`feedback.form_submitted`), and answered "Thanks, we've got it". A switched-off or unknown link says the form
  is closed (404). The spam field filled in is thanked and dropped.

## R6 — Closing the loop
- When a release first reaches production (Operations' `release.deployed` to Production), everyone to be told about its
  item gets "<feature or item> shipped" with the release notes and a link (NooblyJS's new `notify.tell`).
- When its outcome review closes (`outcome_review.closed`), they are told again: "0 of 3 goals met", with a link.
- Each message is told once per person per event (kept in Product's `feedback/told.yaml`), audited by the host.

## R7 — The PM's home
- For you · Product manager gains "Customer evidence": new notes not linked yet, Ada's suggestions waiting, portal
  ideas waiting to be merged or promoted, and who will be told when the next release ships.
- Every For you page shows the person's notices (R6).

## Test script (roadmap Phase 25a)

The roadmap's products are swapped here to match the seed: PRD-031 is the **Delivery** product's and IDEA-019 the
**Checkout** product's.

1. Priya logs three notes from store managers about slots selling out (one a Teams message) and one from support about
   a customer who wants to edit an order. Ada suggests linking the three to PRD-031 and the fourth to IDEA-019 "Edit
   order until picking starts"; Lerato accepts with "critical" and "important": PRD-031 shows "3 colleagues across 1
   portfolio; 1 says critical". The phone number in one note is redacted.
1a. Lerato makes a feedback link for the Delivery product and opens it in a private window, signed out: she submits
   "Slots were gone by 9am again". It lands in the inbox as a note from "Feedback form", tagged Delivery, and PRD-031
   shows "… · 1 form note" once she links it. She submits five more in a row and all are taken; a message carrying
   instructions to Ada is kept as plain text. After she switches the link off, it says the form is closed.
2. Signals: "Slots sell out before 10:00" counts the notes behind it; a click shows them. The board filtered by the
   Delivery product shows PRD-031's evidence and not IDEA-019's (Checkout).
3. Naledi (Viewer) submits "Let me add to my order after paying" in the portal and votes; past the limit she is told
   why. Thabo votes on behalf of a store manager. An agent's vote is refused (403) and audited.
4. Lerato merges Naledi's idea into IDEA-019 (votes and followers carried over) and promotes it to the board.
5. Slots 1.0 reaches production: everyone linked to PRD-031's ideas and insights gets "Same-day slots shipped", with
   the release notes; after the outcome review, "0 of 3 goals met" with a link.

**Done when:** steps 1–5 and 1a pass.
