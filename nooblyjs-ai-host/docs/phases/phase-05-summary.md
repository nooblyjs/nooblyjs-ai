# Phase 5 — Product Factory: summary

**Status:** approved 2026-10-10. Host spec: `.claude/specs/phase-05-product-factory/`. The detailed
spec and the build record are in `nooblyjs-ai-product` (`.claude/specs/phase-05-product-factory-engine/` and its
`roadmap.md`, sub-phases P0–P7).

To see it, run `npm run seed -- --reset` (it wipes `data/`) and `npm start`, then follow the six steps below
as Lerato and Thabo.

This summary was written when the phase was closed. Most of the build happened in other sessions; what was
done at closing was checking it: the story, the screens against their mockups, and the hosted-app checklist.

## What is there

| Area | What |
| --- | --- |
| Product board (Stage 1) | Signals → Opportunities (RICE) → Spec drafting → In review → To architecture, with domain and Mine filters, Top signals and the Q4 roadmap. "Make it an opportunity", "Rescore" and "Draft a spec" |
| Spec | Problem, goals, user stories, acceptance criteria, out of scope; Where this is, Readiness (with one agent action for the gap), Linked knowledge, Reviewers, Versions; Request changes and Approve & send to Architecture |
| Architecture (Stage 2) | Container view (new, existing, external) with **Edit as code**, Decisions with Accept / Discuss, Standards check, and Quality attributes |
| UX Design (Stage 3) | Journey map, flow with its decision branch, research results and an open question with "Run a quick test" |
| UI Design (Stage 4) | Device-frame screen gallery with statuses, design-system reuse, accessibility checks, the handoff preview and **Send to Software Factory** |
| Drafting agents | One pipeline for every stage, on the mock provider, with progress, a budget check and cost roll-up |
| Decisions | Spec approval, the handoff and send-back go through `nooblyjs-ai-workflows`. The Product Factory never approves or moves a stage itself |
| Host | The item's **gate list** on Home's item page (`GET /api/v1/home/items/:id/gates`): the quality attributes, marked not final while a decision is still proposed |

## Test script result (roadmap Phase 5)

Run on 2026-10-09 in a real browser on a fresh seed (`test/e2e/product-factory.story.js`).

| Step | Result |
| --- | --- |
| 1. Turn "Substitutions feel random" into an opportunity and score it (RICE) | PASS |
| 2. Ask Ada to draft a spec: Spec drafting with progress, then In review | PASS |
| 3. Approve PRD-031; Architecture shows the container view; Edit as code updates it | PASS, with one extra action: approval is refused at readiness 6 of 7, so Ada drafts the rollout plan first |
| 4. Thabo accepts ADR-014; the quality attributes become the item's gate list | PASS |
| 5. UX Design and UI Design show their status; accessibility names "Timer needs a screen-reader label" | PASS |
| 6. Send to Software Factory: 6 work items, the estimate $18–$26, the item moves to Build | PASS, across **4** repos (the roadmap said 3; see below) |

The story also checks that a Contributor has no Approve, that a Viewer is refused by the API, and that the
board and the RICE form fit a phone.

Tests: `nooblyjs-ai-host` 109 of 109, `nooblyjs-ai-product` 137 of 137, `nooblyjs-ai-workflows` 24 of 24. `npm run test:e2e`: 34 specs
and the 8-test story, all passing, with 0 WCAG AA violations on the screens they land on.

## Screens against their mockups

Checked by screenshot at 1440px against `brief/noobly-product-factory-{spec,architecture,ux-design,ui-design}`
and the Product board in `brief/noobly-platform.html`. The content matches: headings, sections, sample data,
statuses and actions. Differences:

- **Spec:** the mockup puts Where this is, Readiness, Linked knowledge and Reviewers in a side rail. With the
  chat panel docked (Phase 4) there isn't room at 1440px, so they stack under the spec body. A **Versions**
  card is extra.
- **Architecture:** the mockup labels the connections between layers ("HTTPS · JSON", "gRPC") in the
  diagram. Here they are in a "How they connect" list under it. ADR-014 shows Accept only to someone who may
  accept (an Architect or Owner), where the mockup always shows it.
- **UI Design:** "Open in canvas" is disabled with a note, because Figma isn't connected (`product.md` §12
  Q11). The Web and Store console tabs have no screens in the seed.
- **Product board:** as the mockup. The Roadmap and Insights tabs weren't compared in detail.

**Your eye check is still wanted**: I compared content and structure, not pixel spacing.

## Hosted-app checklist for `nooblyjs-ai-product`

| Step | Result |
| --- | --- |
| 1, 2 | PASS: `register()` only; listed in `hosted-apps.yaml`; the shell lists it first after Home with its nav (`test/product.test.js`) |
| 3 | PASS: a UI module with no `index.html`; switching apps doesn't reload, and the chat thread survives a move between an item's pages (e2e) |
| 4 | PASS: deep links such as `/product/specs/PRD-031` load directly and after a refresh |
| 5 | PASS: signed in only; a Contributor is refused approval, and the refusal is audited |
| 6 | By construction: its logger and queue are the host's providers with instance name `product`. Not checked on `/services/` by eye |
| 7 | PASS: it writes only `data/product/` |
| 8, 9, 10 | PASS through the loader's tests and fixtures (disabled, `register()` throws, a module that throws) |
| 11 | PASS: every selector starts with `[data-module="product"]` (automated); pages abort their requests on leaving |
| 12 | PASS, checked by hand: `npm start` in the repo serves the same frame and API on its own port. Its rail lists only Product; it doesn't show the other apps as "Not running here" |

## Decisions that need your confirmation

1. **Diagram as code is a subset of Mermaid C4** (`product.md` §12 Q7).
2. **Stage numbering:** the Product Factory's screens say Stage 1–4; Lifecycle uses the seven stages.
3. **The handoff says 4 repos**, because the six work items span four. The mockup and the roadmap said 3.
4. **Step 3 needs the rollout plan first.** The readiness gate refuses approval at 6 of 7, so the spec can't be
   approved as seeded without drafting it or overriding in Approvals.
5. **Agents draft on the mock provider** with placeholders in their text until Phase 6.
6. The other decisions recorded in `nooblyjs-ai-product`'s roadmap (D1–D7 and later ones such as D22) were taken
   as their proposed defaults there and are still marked for your sign-off.

## Not built, or left for later phases

- **Jira sync** of the handoff's work items (Phase 12): they are files under `data/workflows/handoffs/`.
- **Real drafting** by teammates with a model (Phase 6), and **Knowledge context and citations** (Phase 8).
- **Open in canvas** (Figma is not an approved or connected tool yet).
- The Software Factory doesn't pick the work items up yet (Phase 7): the item moves to Build and waits.

## Guide points for your review

- Are the artefacts the right shape for your teams?
- Is anything missing from the handoff?
