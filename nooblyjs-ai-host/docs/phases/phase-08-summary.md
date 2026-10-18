# Phase 8 — Knowledge Repository: summary

**Status:** done. Built 2026-10-10 and signed off the same day, with the decisions below accepted as written. Spec: `.claude/specs/phase-08-knowledge-repository/`
(requirements, design, tasks: all 11 done). Work is in three repos: `nooblyjs-ai-knowledge` (the Wiki Platform),
`nooblyjs-ai-host` and `nooblyjs-ai-product`. **Nothing is committed** in any of them (Phases 6 and 7 are not committed either,
and `nooblyjs-ai-knowledge` already had about 40 uncommitted files of yours before this phase, which I left alone).

To see it on a fresh seed, run `npm run seed -- --reset` (it wipes `data/`) and `npm start`, then follow the six
steps below. On your existing `data/wiki/` the sample is not imported by itself: sign in as Stevie, open
**Wiki → Administration → Sources** and press **Import the sample export**.

## How this phase differs from the roadmap

You chose to **extend the Wiki Platform's own modules** and to **keep it at `/wiki`**, with a sample export, and
to leave search as it is. So this phase did not build a Knowledge app at `/knowledge` with the mockup's screens.
It added the missing pieces to the wiki. The roadmap and steering docs now say `/wiki`.

## What is there

| Area | What |
| --- | --- |
| Import with redaction | An export folder (one folder per space) becomes wiki spaces. Before a file is stored, email addresses, phone numbers and South African ID numbers are replaced with `[REDACTED …]`. The seed imports a bundled sample: an Enterprise Space (the process model, one standard) and a Acme Space (a runbook, a code note, a policy, an ADR, a customer-insight page) |
| Sources screen | `/wiki/datasources/sources`: each import, its state, when and by whom, documents per space, what was redacted. An Owner can import again |
| Cited answers, offline | The wiki's AI panel used to fail with no AI agent configured. It now answers from the top three sources' own sentences, cited `[1] [2] [3]`, and says no model wrote it. With an agent configured, the model's answer is unchanged. Every answer with sources is kept with an id |
| Answer actions | Under an answer: **Add to item** (its sources become Linked knowledge on the item's spec), **Save as page**, **This is wrong** |
| Needs review | "This is wrong" flags each cited document. `/wiki/datasources/needs-review` lists them with the reason and who reported it; an Approver marks one reviewed. The count is the nav badge. The Product Factory marks the same documents on any spec that links them |
| Process model | A page with a `process-model` block is drawn as the model around it: on L0, three bands with a chevron per process; below that, the processes under it, a trail back up, and **Used across NooblyJS** with links |
| Knowledge for other apps | `host.service('knowledge')`: `contextFor({ itemId, query })`, `search`, `flagged`, `status`. An app can now name the services it provides (`provides: ['knowledge']`), so the wiki is found whatever it is called |
| Drafts that cite | A Product Factory draft keeps the documents Knowledge gave it as its sources, says how many, and links them to the spec |
| Who may do what | Answer actions take `draft`; clearing a flag takes `approve`; importing takes `change-repo-access` (Owner). An agent is refused all of them. Each is in the audit log |

## Test script result (roadmap Phase 8)

Run on 2026-10-10 through the real apps (`test/knowledge.test.js`) and in a real browser
(`test/e2e/knowledge.story.js`), with no AI agent configured in the wiki.

| Step | Result |
| --- | --- |
| 1. Import the sample wiki export. Sources shows the sync status and document counts | PASS: "Imported", 18 documents (Enterprise Space 13, Acme Space 5). It is a one-off import, not a sync: there is no schedule |
| 2. Ask "How is slot capacity calculated?". An answer with 3 citations. Add to PRD-031 | PASS, with the passages answer (no model). The three sources are linked on PRD-031's spec. **Not run with a real model** |
| 3. This is wrong: recorded, and the document gets a review flag | PASS: three documents flagged, on Needs review and on the spec; Lerato clears one |
| 4. Enterprise Space → L0: three bands from the imported files; Supply drills down; Used across NooblyJS lists PRD-031 and ADR-014 | PASS. The process names and codes are sample data (`[PLACEHOLDER …]` codes) |
| 5. Ingest a document with a phone number and an email address: stored redacted | PASS, for a document that arrives by import. The values are nowhere under `data/wiki/` |
| 6. Ask Ada to draft a spec. The draft cites knowledge documents | PASS in the sense built: her rollout-plan draft for PRD-031 carries the documents Knowledge returned and links them to the spec. The scripted draft's **text** does not quote them (see decision 4) |

Tests: `nooblyjs-ai-host` 150 of 150 · `nooblyjs-ai-knowledge` 32 of 32 · `nooblyjs-ai-product` 141 of 141 · the Knowledge browser
story 4 of 4. The rest of `npm run test:e2e` still passes: 37 specs, the 8-test
Phase 5 story and the 6-test Software Factory story. `nooblyjs-ai-factory` and `nooblyjs-ai-teammate` were not changed
in this phase and were not rerun.

## Hosted-app checklist for `nooblyjs-ai-knowledge` at `/wiki`

| Step | Result |
| --- | --- |
| 1, 2, 4, 5, 7 | PASS (`test/knowledge.test.js`, the wiki's own `register.test.mjs` and `platform.test.mjs`) |
| 3 | PASS in the browser story: the rail opens the Wiki with no reload. It still draws its own top bar and page tree, as before this phase |
| 6 | PASS by reading the code: its core services are instances on the host's registry named `wiki` |
| 8, 9, 10 | PASS for the loader, as in earlier phases: the e2e specs run with the wiki disabled |
| 11 | PASS for the automated half: every selector in its generated CSS is under `[data-module="wiki"]` (`module.test.mjs`). **Not met for the other half:** the wiki's file watcher and timers have no stop, so `close()` does not stop everything |
| Accessibility | The new parts (Sources, Needs review, the answer actions, the process model) pass axe. **The rest of the wiki's UI was not scanned**, and the wiki is not usable at phone width |

## Decisions that need your confirmation

1. **Redaction happens on import only.** A person editing or uploading a page in the wiki is not redacted,
   because that would destroy a contacts page. If upload should count as ingest, say so.
2. **What is redacted:** email addresses, phone numbers, 13-digit ID numbers. **Not names.**
3. **Importing needs an Owner** (`change-repo-access`), and an import reads only the bundled sample or a folder
   an operator puts under `data/wiki/imports/`. A path is never taken from the browser.
4. **"The draft cites knowledge" means the draft carries its sources**, shown as "from N Knowledge sources" and
   as Linked knowledge on the spec. The scripted draft text is the seed's and does not change. With a real
   model the documents are in its context, but nothing checks that its text cites them.
5. **Pages saved from answers are never used as sources for new answers**, so an answer cannot cite itself.
6. **An agent's knowledge is what any signed-in person can open** (team and public spaces), never a private space.
7. **The process model lives in the pages** (a `process-model` block per page), and "Used across NooblyJS" is the
   page's own `linked-items`, resolved to titles by NooblyJS. Nothing computes backlinks from specs.
8. **`npm test` in NooblyJS now runs with `--test-force-exit`**, because a hosted wiki leaves watchers running and
   the test process would never end.

## Not built, or left for later phases

- **The wiki's AI agents still call their provider directly**, outside `nooblyjs-ai-common` and Teammates: no
  budget check, no billing, no `agent.action` record. The governance rules allow that in development only.
  This is the largest gap against NooblyJS's rules in this phase.
- **Team chat and Teams answers do not use Knowledge.** Only Product Factory drafts do.
- **The mockup's Knowledge screens**: Ask & search as a page of its own, Collections with counts, Graph,
  Contributions, Access, and the status card's "Reviewed in 90 days".
- **Connectors and syncs** (GitHub, Confluence, Jira, Zendesk, Google Drive, NooblyJS itself). A source is a folder.
- **Freshness rules** ("14 months old", "contradicts merged code", "superseded but still cited"). A document
  needs review only when someone reports an answer.
- **Semantic search.** Search was not touched, as you asked.
- **Ask about this model, Rebuild context**; "Models to review" on the Architect home.
- **The wiki's storage** is still JSON files and its own layout under `data/wiki/`, not Markdown and YAML.
- **Real data and real process-model codes.** Everything imported is sample data.

## Things to know

- **A first visit to the wiki shows its own "Welcome aboard" setup dialog** over the page, for each person.
- **With the AI panel open, the wiki hides the page at about 900px and below.** I saw it in the browser test and
  did not investigate; the process model was not checked at phone width for that reason.
- **Starting NooblyJS with the wiki takes noticeably longer** (it loads its workflows and builds its index).
- **The wiki's screens are open to everyone signed in**, as before. The new routes are the exception: they ask
  NooblyJS's permissions.
- **`host.can` and `host.clock` were missing from the wiki's test host**; I added them to match the real host.
- **Phase 7 is still open on two points**: no run has reached a PR with a real model, and triage's questions
  do not reach a person in NooblyJS.

## Guide points for your review

- Is the answer quality good enough? With no model it is the best-matching sentences, which is honest and
  blunt. With a model it is the wiki's existing behaviour, which this phase did not test.
- Which sources come next?
