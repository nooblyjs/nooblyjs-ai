# nooblyjs-ai-product: signals, ideas, and specs

**Lesson 02 · about 15 minutes · 2026-10-24**

## What you'll learn

- The **five types of input** to the Product Factory: signals (metrics, alerts), customer feedback, ideas, features and epics.
- How **ideas** turn into **specs** and then **architecture** and **design**.
- How **RICE scoring** (Reach, Impact, Confidence, Effort) helps prioritize, and how the **roadmap** shows capacity and priorities.

## The idea, in plain words

The Product Factory is a funnel: signals and feedback come in, ideas emerge, we size and prioritize them, and the best ones flow into the Software Factory to be built.

Think of a real product team. You have a product manager watching metrics (signals) and reading customer feedback. Someone has an idea for a new feature. The PM writes a spec: what is the feature, who does it serve, why do it now? They size it (how much work?), score it with RICE (is it worth the work?), and if it scores well, it goes on the roadmap. The dev team sees it there and plans the sprint.

The Product Factory works the same way. **Signals** come from NooblyJS's metrics or from external sources (monitoring alerts, support metrics). **Ideas** are written as text and often come from customer feedback or from team brainstorms. An **idea** can be:

- A small feature (1–2 days of work): can be built directly
- A bigger feature (1+ weeks): needs a **spec**—a detailed specification
- Part of a **portfolio**: grouped under an epic or a portfolio epic

When an idea is big enough, Product drafts a spec (with Ada, a teammate agent). The spec has:
- **Outcome**: what the user will be able to do that they can't do today
- **Acceptance criteria**: how we know it's done
- **Business case**: how much it will cost, how much value it delivers
- **Value**: RICE-scored

The roadmap shows what's coming: ideas and features grouped by priority (Now, Next, Later) and by team capacity. When Design is happy with the architecture and sketches, the idea becomes a story and flows to the Factory.

## Where it lives in this repo

| Path | Why it matters |
| --- | --- |
| `src/services/hierarchy.js` | Portfolio epics, epics, and features in a catalogue. RICE scoring and portfolio tracking. |
| `src/services/signals.js` | Metrics and external signals (alerts, feedback sources). |
| `src/services/ideas.js` | Ideas: create, search, accept. Link ideas to features. |
| `src/services/specs.js` | Specifications: write, review, approve. Each spec has a readiness fact. |
| `src/services/business-cases.js` | The business case for an idea or epic (cost, value). Drafted by Ada (teammate task). |
| `src/services/readiness.js` | Checks for each spec: is it ready to hand off to Design? (Business case, requirements elicited, no open questions) |
| `src/models/` | The data shapes: ideas, specs, signals, portfolio hierarchy, as Markdown files. |
| `public/js/pages/roadmap.js` | The roadmap page: ideas grouped by Now/Next/Later with their RICE scores and assigned capacity. |

## A small piece of code

**`src/services/hierarchy.js:40–70`** — The portfolio hierarchy (epics and features):

```javascript
// Epics and features are the catalogue. An idea links to a feature.
export async function listCatalogue(store, { with: includes } = {}) {
  const hierarchy = await store.readJSON('hierarchy/catalogue.yaml');
  
  return {
    epics: hierarchy.epics.map(epic => ({
      id: epic.id,                    // EPIC-001
      title: epic.title,
      area: epic.area,                // e.g. "Checkout"
      value: epic.rice,               // RICE score
      status: epic.status,            // open, in-progress, done
      features: epic.features,        // FEAT-007, FEAT-008, …
    })),
    features: hierarchy.features.map(feature => ({
      id: feature.id,                 // FEAT-001
      title: feature.title,
      epic: feature.epic,             // which EPIC does it belong to?
      ...
    })),
  };
}
```

This shows the hierarchy: portfolio is divided into epics, epics contain features, and ideas link to features.

**`src/services/ideas.js:80–110`** — Creating an idea:

```javascript
export async function createIdea(store, { title, description, source, feature } = {}) {
  const id = nextId('idea');           // IDEA-001
  
  const idea = {
    id,
    title,
    description,
    source,                            // "customer feedback", "team brainstorm", …
    status: 'proposed',                // proposed → accepted → (sent to Factory)
    rice: null,                        // scored later
    feature: feature || null,          // link to FEAT-007 if it's part of a feature
    createdAt: now(),
  };
  
  await store.write(['ideas', `${id}.md`], {
    ...idea,
  }, description);
  
  return idea;
}
```

An idea is simple: a title, description, source, and a link to a feature (if it's part of something bigger).

**`src/services/specs.js:50–90`** — A spec has a readiness check:

```javascript
export async function specReadiness(spec) {
  const checks = {
    businessCaseComplete: !!spec.businessCase?.approvedAt,
    requirementsElicited: spec.requirements.length > 0,
    noOpenQuestions: spec.questions.filter(q => !q.answeredAt).length === 0,
    architectureAccepted: !!spec.architecture?.approvedAt,
  };
  
  return {
    ...checks,
    ready: Object.values(checks).every(v => v),    // all checks must pass
    missingFor: Object.entries(checks)
      .filter(([_, v]) => !v)
      .map(([k]) => k),                             // what's blocking readiness?
  };
}
```

A spec is ready to hand off to Design when: business case is done, requirements are elicited, there are no open questions, and architecture is accepted.

## Try it

Start NooblyJS and navigate to Product:

```bash
cd ../nooblyjs-ai-host
npm start
# Open http://localhost:11001/product
```

Explore:

1. **Feedback** — Customer notes and insights (Phase 25a)
2. **Ideas** — The ideas portal and the ideas list with their status
3. **Specs** — Create a spec by clicking on an idea
4. **Roadmap** — The plan: Now/Next/Later with RICE scores and capacity
5. **Architecture** — C4 views, ADRs, and quality attributes (in the Design app)

Then check the data:

```bash
# Ideas
cat ../nooblyjs-ai-product/data/product/ideas/IDEA-*.md

# Specs
ls ../nooblyjs-ai-product/data/product/specs/

# Roadmap
cat ../nooblyjs-ai-product/data/product/roadmap.md
```

## Words to know

- **Signal**: A metric, alert, or external data source (e.g., "checkout abandonment up 5%"). Signals feed into ideas.
- **Idea**: A proposed feature or improvement. Can be small (build directly) or large (needs a spec).
- **Spec**: A detailed specification for a large idea. Includes outcome, acceptance criteria, business case, and readiness checks.
- **Feature**: A named piece of work (FEAT-001). Ideas link to features, and features belong to epics.
- **Epic**: A larger project (EPIC-001). Features belong to epics, and epics organize the work.
- **Portfolio epic**: A higher-level epic that groups several epics (e.g., "Payment systems" groups checkout, refunds, reconciliation).
- **RICE**: Reach (how many users), Impact (how much do they benefit), Confidence (how sure are we), Effort (how much work). Multiplied together for a score.
- **Roadmap**: A view of what's coming, grouped by Now/Next/Later with their RICE scores and team capacity.
- **Readiness**: A set of checks that must pass before a spec can be handed off (business case done, requirements gathered, architecture accepted).
- **Business case**: An estimate of cost and value. Drafted by Ada (a teammate agent) with numbers from past similar work.

## Summary: what you've learnt

- **The Product Factory is a funnel: signals and ideas in, prioritized work out.** Metrics and feedback become ideas, ideas become specs, and specs become architecture and design.
- **Specs are detailed and checked.** A spec isn't ready to hand off until the business case is done, requirements are gathered, and architecture is accepted.
- **RICE scoring priorities the roadmap.** Reach × Impact × Confidence ÷ Effort gives a score that helps decide what to do next.
- **Portfolio structure groups work.** Portfolio epics → epics → features. Ideas link to features.
- **Readiness gates keep flow moving.** A spec can't go to Design until it passes its checks. The Factory can't start until Design hands off.
- **Ideas can be small or large.** Small ideas go directly to the Factory. Large ones become specs and go through elicitation and architecture first.
- **Everything is linked end-to-end.** An idea traces to a feature, a feature to an epic, an epic to a RICE score, and the score to the roadmap.
- **Agents draft, people decide.** Ada drafts specs and business cases. People review, question, and decide whether an idea is worth doing.
