# Writing skills for a teammate

> NooblyJS Phase 26. A **skill** is a named piece of know-how in the shared skill library that any teammate can hold at
> a level from 1 to 3. When a teammate works, the skills that fit the task go into its instructions.

## What a skill is

A skill has three parts (`src/services/team.js` `createSkill`):

| Part | Limit | What it's for |
| --- | --- | --- |
| **Name** | 60 characters | What people pick from the library: "Architecture decision records", "Ticket triage" |
| **Description** | 160 characters | One line saying what the skill does. It helps choose the skill for a task |
| **Instructions** | 20,000 characters | How to do it. This is what the teammate reads |

A teammate holds a skill at a **level** (1 to 3). The level orders skills when no skill clearly fits a task.

## How a skill is chosen for a task

- A teammate with four skills or fewer uses all of them.
- With more, the skills whose name, description and instructions best match the task's words are used (at most three;
  `src/services/retrieval.js` `selectSkills`). When nothing matches, the strongest three by level are used.
- A caller can name one skill (`skill` in the task) to use it alone; a skill the teammate doesn't hold is refused (400).

So: **name and describe a skill with the words people use when they ask for that kind of work.**

## Writing good instructions

1. **Say what good looks like.** The shape of the answer ("context, decision, options considered, consequences"), how
   long, and what it must always include.
2. **Say what never to do.** "Never cite a source you could not read." "Never apply anything yourself." Rules like these
   are where a skill earns its keep.
3. **One skill, one job.** "Spec drafting" and "Plain-language explanation" are two skills, not one.
4. **Keep facts out.** Facts about the company belong in Knowledge (uploads) or memory, which are cited; a skill is how,
   not what.
5. **Mark unknowns.** Ask for `[PLACEHOLDER: what is missing]` instead of an invented fact, as every NooblyJS draft does.
6. **Don't hand out power.** A skill can't give a teammate a tool, a budget or a decision. Those come from the
   teammate's settings and NooblyJS's permissions, and text never changes them.

## An example

```
Name:         Infrastructure as code
Description:  Turns an architecture into infrastructure resources and code
Instructions: Map each container, store and quality attribute to a resource. Reuse the approved blueprints, say what
              each resource costs a day, and never apply anything yourself.
```

## Adding one

- On a teammate's page · Skills · **Add skill** (it takes a level), or upload a skill pack when hiring. Through the API:
  `POST /api/v1/skills { name, description, instructions }` adds it to the library, and `POST
  /api/v1/teammates/:slug/skills` gives it to a teammate at a level (a manager: `approve`). Change one with `PATCH
  /api/v1/skills/:id`. Each change is audited.
- Try it: give the teammate a task that should use it. The task's answer says which skills were used (`skillsUsed`).
