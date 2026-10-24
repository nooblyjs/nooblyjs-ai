# nooblyjs-ai-infrastructure: the provisioner adapter

**Lesson 01 · about 10 minutes · 2026-10-10**

## What you'll learn

- The infrastructure app designs environments, but it never talks to a cloud directly.
- All real work goes through one small interface, the **provisioner**, with a plug-in for each cloud or tool.
- Only a `mock` provisioner exists today, because no cloud or tool has been chosen yet.

## The idea, in plain words

Think of a TV with a standard socket. The TV doesn't care whether the power comes from the mains, a generator or a
battery. As long as the plug fits the socket, it works. Change the power source and the TV stays the same.

The infrastructure app has a socket: `plan`, `estimateCost`, `apply` and `detectDrift`. Services call the socket and
never a cloud SDK. Adding a real cloud later means writing one new plug, not changing the services.

The analogy stops working in one place: a TV doesn't change the power it draws. A provisioner can cost money and
change real resources, so the rules for when it may run live in the services, not in the plug.

## Where it lives in this repo

| Path | Why it matters |
| --- | --- |
| `src/provisioners/index.js` | `createProvisioner()`: picks the plug by name. Only `mock` is allowed. |
| `src/provisioners/mock.js` | The mock: it touches nothing outside the process. Apply is a timed wait with progress. |
| `src/services/` | Designs, environments, runs, drift and cost. They call the provisioner, never a cloud. |
| `index.js` line 30 | `NAV`: the screens (environments, designs, runs, testing, blueprints, cost, policies). |
| `.claude/steering/` | Holds the decision that the cloud and tool are not yet chosen (roadmap I9). |

## A small piece of code

The chooser, from `src/provisioners/index.js`, trimmed:

```js
// src/provisioners/index.js
export function createProvisioner({ name = 'mock', stepMs } = {}) {
  if (name === 'mock') return createMockProvisioner({ stepMs });
  throw new Error(`No provisioner called "${name}". Only "mock" exists until a cloud and a tool are chosen (roadmap I9).`);
}
```

- The function takes a name. Anything other than `mock` is refused with a message that says why.
- The error text is the design decision: the code says a real provisioner waits for a choice, rather than guessing one.
- The file's header comment lists the four operations every provisioner must offer: `plan`, `estimateCost`, `apply` and `detectDrift`.

## Try it

Run the infrastructure's registration test, which checks the app mounts and describes itself:

```
cd <workspace>/nooblyjs-ai-infrastructure
node --test test/register.test.js
```

Read the test's first assertion. It shows the app's name, mount path and nav, the same card pattern as the Product Factory.

## Words to know

- **Provisioner**: the part that makes real resources happen, such as creating a server.
- **Adapter**: a plug that makes one tool look like the interface the rest of the code expects.
- **Plan**: what would change, shown before anything is done.
- **Drift**: the difference between the design and what really exists.
- **Blueprint**: a reusable design that an environment can be built from.

## Summary: what you've learnt

- You know the infrastructure services never call a cloud directly.
- You know the provisioner is a small interface, with one mock plug today.
- You know the code refuses an unknown plug and says why, rather than guessing.
- You know that cost, plans and drift are computed by the services, from the design.
