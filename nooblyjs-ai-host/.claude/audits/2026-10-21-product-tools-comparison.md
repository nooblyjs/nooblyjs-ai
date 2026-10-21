# Product: NooblyJS against Productboard and Aha! (2026-10-21)

Asked 2026-10-21: "look at … Productboard and Aha! and compare it to the features of our product capability … check if
they have good features we don't have and add it to the next phase of enhancements." What they lack that we have, and
what we lack that is worth having, are below; the second list is root roadmap **Phase 25**.

How this was done: the vendors' product pages, Aha!'s own comparison of the two, their help centres on prioritisation
and ideas, and 2026 reviews (sources at the end). Marketing pages name features, not how they behave: where a line
says how one works, it comes from a help article. Nothing was tried in a trial account. Our side is what
`nooblyjs-ai-product` (and Design, Operations, the lifecycle) does today, read from the code.

## The three side by side

| Area | Productboard | Aha! Roadmaps (with Ideas and Discovery) | NooblyJS Product today |
| --- | --- | --- | --- |
| **Feedback in** | A feedback inbox from customer submissions, people logging it, and integrations (support, CRM, chat); AI groups it into themes and insights | Ideas from portals, in-app widgets, dynamic forms, polls, proxy entries; AI feedback analysis for themes and related requests | **Signals**: a title, theme, product, source, count and week, clustered by Ada. Seeded only, no connector; Operations raises signals from production; Teams meeting notes become elicitation sessions |
| **Evidence linked to work** | An insight (a highlighted snippet of feedback) is linked to a feature with an importance; the **Customer Importance Score** counts who asked, weighted by importance | Ideas are linked to features when promoted; votes and comments stay with the idea | A signal becomes an idea (`POST /signals/:id/idea`); elicitation candidates quote the sentence they came from. No snippet → feature link with importance, no count of who asked |
| **Customers and segments** | Users and companies, segment filters, "VIP customer views and tracking", feedback trends by segment | Idea voters and their organisations; vote weighting | None: no customer or company records |
| **Ideas portal** | A customer portal: published ideas people vote on and comment on | Branded customer or internal portals; votes with limits and weights; proxy voting by sales and support; comments; idea statuses | None. Ideas are internal, made by a person or from a signal |
| **Closing the loop** | Notify followers of a feature's progress | Followers are told automatically when their idea ships | The lifecycle tells people who decide; nobody who asked for the idea is told it shipped. Operations writes release notes; the outcome review measures the goals |
| **Strategy** | Objectives (OKR tracking) linked to initiatives and features | Vision, goals and initiatives linked to releases, epics and features; positioning, personas, competitors as strategy documents | Strategic themes, portfolios, value streams (documents from templates), portfolio epics → epics → features, products as labels. Spec goals have measure, today and target. No objectives or key results; no personas or competitors documents |
| **Prioritisation** | Drivers (0–5 criteria, weighted), custom formulas, Customer Importance Score, prioritisation board | Scorecards (default or custom metrics and weights), popularity, AI business-priority hints | **RICE** per idea; "Business case complete" before an idea is accepted, with an estimate from the factory's history. One fixed scoring model |
| **Roadmaps** | Timeline, column and grid views; shareable by link or embed | Roadmaps by initiative, team or portfolio; Gantt; saved views; live presentations, webpages, PowerPoint embeds | One quarter view from `roadmap.yaml`: planned spans per stage, read only, typed into a file. No views, no sharing, no editing in the app |
| **Releases and dependencies** | Release planning | Releases, Gantt, cross-team dependencies | Releases are Operations' (one per feature); Design records feature dependencies; neither shows on a roadmap |
| **Capacity** | Not offered (per Aha!'s comparison); allocation reports | Capacity planning for people and teams against estimates | None. A business case has a people-days estimate, compared with nothing |
| **Reports** | Built-in reports: feedback analytics, efficiency and allocation | 75+ reports, pivots, dashboards, analytics across workspaces | Metrics in NooblyJS (lead time, spend by portfolio and value stream, DORA, idea → outcome); nothing on feedback or allocation |
| **Discovery** | Spark: customer discovery, competitive analysis | Aha! Discovery: participant database, interview outreach, transcript analysis, AI insight reports; whiteboards, wireframes, prototypes | Elicitation: stakeholders, sessions with notes (Teams), candidate requirements quoting their source, the NFR walk, open questions. UX journeys, flows and research; UI screens |
| **AI** | Spark, one agent across discovery, analysis, specs and launch, with 150+ prompts | Elle: research, drafting, prototypes; a prompt library and custom agents | Drafting agents for every artefact as accounted teammate tasks (checked by Platform, billed, audited); agents never accept anything |
| **Integrations and API** | 25+ integrations, an open API and an MCP server | 30 integrations with field mapping | Jira and Bitbucket through NooblyJS's write gate; the Product API; Knowledge (the wiki has MCP; Product does not) |

## What we have that they don't

- **One loop from idea to outcome.** The idea, its business case, the spec, Design, Engineering, Build, Test, the
  release and the outcome review are one lifecycle item with approvals and a trace; neither tool goes past the
  handoff to delivery (Aha! sells Develop separately; Productboard stops at the delivery integration).
- **Requirements with their sources**: elicitation candidates quote the sentence they came from, a person accepts
  them, and the NFR walk turns targets into quality attributes, gates and SLOs.
- **Architecture in the product flow**: container views as code, ADRs, the standards check, quality attributes.
- **Business cases estimated from what the factory actually spent** on similar items.
- **Outcome reviews** that measure the spec's goals after release and close the item.
- **Agents that are accountable**: every draft is a teammate task with a cost and an audit record; people decide.

## What they have that is worth having (Phase 25)

In order of value to the PRD-031 kind of work, most first:

1. **Customer evidence**: a feedback inbox (notes from people, Teams, email, Jira, and a support-tool connector
   `[PLACEHOLDER]`), each note's snippets linked to an idea, feature or spec with an importance, and a **customer
   importance score** on every idea. Signals become what Ada clusters the notes into, not counts typed into a file.
2. **Customers and segments**: people and companies (from a CRM `[PLACEHOLDER]`, or typed in), with segment, plan and
   value; filter the board and the evidence by segment.
3. **An ideas portal** inside NooblyJS for colleagues (stores, support, sales): submit, vote with a limit, comment,
   vote on a customer's behalf; statuses in words. Customers outside Acme `[CONFIRM]`.
4. **Closing the loop**: everyone who asked for, voted for or was linked to an idea is told in NooblyJS (and Teams)
   when its feature is released, and again with the outcome review.
5. **Objectives and key results**, linked to themes, epics, features and ideas; key results read from Metrics and
   the monitor; outcome reviews move them.
6. **Configurable prioritisation**: drivers (0–5, weighted, one per objective if wanted) and a formula beside RICE,
   with customer importance as an input; scores on the board, and why in words.
7. **Roadmaps people can use**: built from the items themselves (not a typed file), edited in the app, in views (Now ·
   Next · Later, timeline, by portfolio, theme or objective), with releases and Design's dependencies on them; saved
   views; a read-only page to share.
8. **Capacity**: each team's capacity per quarter in people-days, against the business cases' estimates; over-planned
   quarters said in words.
9. **Strategy documents**: vision, positioning, personas and competitors from templates, which agents read when they
   draft.
10. **Product reports**: feedback over time and by segment, allocation by theme and objective, in Metrics.

**Your answers (2026-10-21), which reshape the list:** feedback comes in as planned (1); **the customer is the
portfolio** (2 becomes segments by portfolio, value stream and product: no customer or company records, no CRM, no
revenue); the portal is **for colleagues only, always** (3), and **Viewers submit and vote** (a new `suggest`
permission); **scoring stays RICE** (6 is dropped: the objective and customer importance show beside the score);
**objectives and capacity run by Now · Next · Later**, not by quarter (5, 8). Phase 25a is 1–4, Phase 25b is 5 and 7–10.

Left out on purpose: AI prototyping and whiteboards (UI screens and the Factory already build), a prompt library
(the wiki has one), PowerPoint embeds, and a Product MCP server (later, with Knowledge's).

## Sources

- Aha!, "Aha! Roadmaps vs. Productboard: how to choose the best roadmap software":
  https://www.aha.io/blog/aha-roadmaps-vs-productboard-how-to-choose-the-best-roadmap-software
- Productboard, product overview: https://www.productboard.com/product/
- Productboard AI and Spark: https://www.productboard.com/resources/productboard-ai ·
  https://marketplace.atlassian.com/apps/2807407353/productboard-spark-ai-built-for-product-managers
- Productboard help: Customer Importance Score https://support.productboard.com/hc/en-us/articles/360058215013 ·
  drivers https://support.productboard.com/hc/en-us/articles/360056348954 · rubrics
  https://support.productboard.com/hc/en-us/articles/28306158464787 · prioritisation
  https://support.productboard.com/hc/en-us/sections/360009666214-Prioritization
- Aha! ideas: https://www.aha.io/ideas · prioritising customer ideas
  https://www.aha.io/support/roadmaps/strategic-roadmaps/best-practices/prioritize-customer-ideas · proxy votes
  https://www.aha.io/blog/sales-and-support-teams-can-vote-for-ideas-on-behalf-of-customers · vote limits
  https://www.aha.io/blog/allocate-customer-votes-ideas-portals
- Aha! launches: https://www.aha.io/blog/collection/aha-product-launches
- Reviews (2026): https://www.featurebase.app/blog/aha-review · https://www.capterra.com/p/144020/Aha/reviews/2838838 ·
  https://www.stork.ai/en/productboard
