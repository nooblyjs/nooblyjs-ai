# nooblyjs-ai-design: from spec to stories

**Lesson 01 · about 15 minutes · 2026-10-24**

## What you'll learn

- What the **Design app** does: takes a spec from Product and turns it into a design with stories ready for Engineering.
- The **four layers of design work**: business requirements, solution architecture, functional analysis, and stories.
- How **agents draft** and **people accept**, and why acceptance is a human decision.

## The idea, in plain words

Product writes a spec: "Add the ability to search by price range." They say what the user will do, why it matters, and what success looks like. But that's not enough to build. You need to know:

- **Which systems** does this touch? (backend APIs, frontend, search service)
- **How do the systems talk** to each other? (interfaces, data flow)
- **What quality does it need**? (how fast, how reliable, what data privacy rules)
- **What's the actual work?** (break it into stories, each small enough for one sprint)

The Design app answers all four questions. It's the bridge between **Product** (who decides what to build) and **Engineering** (who builds it). Product says "why", Design says "how", and Engineering says "done".

The workflow:

1. **Product hands off a spec** → Design gets the item with the spec
2. **Business requirements** → Design writes (or drafts with an agent) what the spec requires, quoted
3. **Solution architecture** → Design draws the systems, their interfaces, and quality attributes
4. **Functional analysis** → Design details what changes in each system
5. **Stories** → Design breaks the work into stories, each one a lifecycle item that goes to Engineering

People accept each layer. If something is wrong, they edit it. Once accepted, that layer is fixed (agents never overwrite it).

## Where it lives in this repo

| Path | Why it matters |
| --- | --- |
| `src/services/design.js` | The core rules: write requirements, architecture, analysis, stories. Agents draft; people accept. |
| `src/services/drafts.js` | Pure functions that generate requirements, architecture, and analysis based on the spec and Product's data. |
| `src/services/drafter.js` | Calls a teammate agent (Rhea, the architect) to draft architecture and ADRs. |
| `src/routes.js` | The API: accept requirements, update acceptance criteria, handoff stories to Engineering. |
| `data/design/nfr-catalogue.yaml` | The NFR (non-functional requirement) catalogue: performance, security, reliability, etc. Shared with Product. |
| `data/design/items/<itemId>/design.md` | One item's design: requirements, architecture, stories, all in one file. |
| `public/js/product-pages.js` | Draws the Architecture pages (in Product's scope, since Phase 16b). |

## A small piece of code

**`src/services/design.js:40–80`** — Writing requirements:

```javascript
// Requirements are quotes from the spec, accepted by a person
export async function writeRequirements(item, spec) {
  const requirements = [];
  
  // Extract outcome from the spec
  requirements.push({
    id: `BR-${item.id}-01`,           // Business Requirement 01
    text: spec.outcome,
    source: 'spec.outcome',
    status: 'proposed',               // drafted, not yet accepted
    acceptedBy: null,
    acceptedAt: null,
  });
  
  // Each acceptance criterion becomes a requirement
  spec.criteria.forEach((criterion, i) => {
    requirements.push({
      id: `BR-${item.id}-${String(i + 2).padStart(2, '0')}`,
      text: criterion,
      source: 'spec.criteria',
      status: 'proposed',
      acceptedBy: null,
      acceptedAt: null,
    });
  });
  
  return requirements;
}
```

This shows the pattern: requirements are extracted from the spec, numbered, and marked as "proposed" until a person accepts them.

**`src/services/design.js:100–140`** — The story handoff (to Engineering):

```javascript
export async function handoffStories(item, design) {
  // Only accepted stories can be handed off
  const accepted = design.stories.filter(s => s.status === 'accepted');
  
  if (!accepted.length) {
    return { reason: 'no-accepted-stories' };
  }
  
  // Handoff to Engineering: sync stories to the lifecycle
  const handoff = {
    type: 'design',
    stories: accepted.map(s => ({
      id: s.id,                  // STORY-031-1
      title: s.title,
      description: s.description,
      acceptanceCriteria: s.criteria,
      architecture: design.architecture,
      nfrs: design.nfrs,         // the quality attributes
    })),
    handoffAt: now(),
    handoffBy: person.id,
  };
  
  // Tell the lifecycle: these stories are ready for Engineering
  await host.service('workflows').syncStories(item.id, handoff);
  
  return { success: true, count: accepted.length };
}
```

This shows what Design hands off: a set of stories with their acceptance criteria and the architecture they depend on.

**`src/services/drafts.js:20–60`** — Drafting architecture (a pure function):

```javascript
export function draftArchitecture(spec, repositories) {
  // What systems are touched by this spec?
  const impacted = repositories.filter(repo => 
    spec.description.includes(repo.name)
  );
  
  const architecture = {
    systems: impacted.map(repo => ({
      name: repo.name,
      team: repo.team,           // who owns it
      changes: [],               // what changes
      interfaces: [],            // what data flows in/out
    })),
    
    // Non-functional requirements from the NFR catalogue
    nfrs: spec.nfrs.map(nfr => ({
      id: nfr.id,                // e.g., "PERF-001"
      title: nfr.title,          // "95th percentile latency < 200ms"
      category: nfr.category,    // "Performance"
    })),
    
    adrs: [],                     // Architecture Decision Records (drafts by Rhea)
  };
  
  return architecture;
}
```

This shows how architecture is drafted: it finds the impacted systems, adds quality attributes, and leaves room for ADRs.

## Try it

Start NooblyJS and navigate to Design:

```bash
cd ../nooblyjs-ai-host
npm start
# Open http://localhost:11001/design
```

Watch the flow:

1. **Go to an item** (in the lifecycle, look for one with a spec handoff)
2. **See the Design section** with blank requirements, architecture, and stories
3. **Click "Draft requirements"** → an agent (or a script) fills them in
4. **Accept** the requirements one by one
5. **Click "Draft architecture"** → see the systems and quality attributes
6. **Click "Draft stories"** → see stories broken down by feature
7. **Accept the stories** → they're now ready for Engineering
8. **Handoff** → the stories sync to the lifecycle

Then check the data:

```bash
# See a design
cat ../nooblyjs-ai-design/data/design/items/*/design.md | head -50

# See the NFR catalogue
cat ../nooblyjs-ai-design/data/design/nfr-catalogue.yaml
```

## Words to know

- **Business requirement** (`BR-031-01`): A statement of what the spec requires, quoted from the spec.
- **Solution architecture**: The systems touched, their interfaces, and quality attributes (how fast, reliable, secure).
- **Functional analysis**: What changes in each system, per interface.
- **Story** (`STORY-031-1`): A small piece of work that Engineering can do in one sprint.
- **NFR** (Non-Functional Requirement): A quality attribute (performance, security, reliability, compliance, etc.).
- **Acceptance criterion**: A statement of done for a story. "When the user searches by price, the results load in < 1 second."
- **Handoff**: Sending stories to Engineering. Once handed off, a story is in the lifecycle and can't change here.
- **Draft**: An agent's proposal. A draft is never final; a person always accepts or rejects it.
- **Acceptance**: A person's decision that something (requirements, stories, architecture) is ready to use.
- **Criterion changed**: A person edits a story's acceptance criterion (Phase 20). The Factory's Test section marks which test cases are affected.

## Summary: what you've learnt

- **Design is the bridge between Product (why) and Engineering (how).** Product says what to build; Design says how to build it; Engineering does the work.
- **Design work has four layers: requirements, architecture, analysis, stories.** Each layer is built on the one before it.
- **Requirements are quoted from the spec.** They're not new ideas; they're what Product asked for.
- **Architecture shows the systems, their interfaces, and quality attributes.** It answers: which systems change? How do they talk? What quality do they need?
- **Functional analysis details what changes in each system.** It's the bridge between architecture and stories.
- **Stories are the unit of work for Engineering.** Each story is an item in the lifecycle with its own handoff.
- **Agents draft, people accept.** An agent proposes requirements, architecture, or stories. A person with the right role accepts, edits, or rejects them.
- **A draft never overwrites acceptance.** Once a person accepts a requirement, an agent can't change it.
- **Stories carry their architecture with them.** When a story goes to Engineering, it carries the architecture decisions and quality attributes it depends on.
- **Handoff is final for that layer.** Once Design hands off stories, they're in Engineering's hands. Design can only edit acceptance criteria if a test fails.
