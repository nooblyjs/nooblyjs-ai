# nooblyjs-core: the service registry

**Lesson 01 · about 10 minutes · 2026-10-10**

## What you'll learn

- nooblyjs-core is a toolbox of shared services (logging, caching, queues, search, sign-in and more).
- One object, the **service registry**, creates those services and hands them out.
- Apps ask the registry for a service by name and a provider, and never build their own.

## The idea, in plain words

Imagine a hotel. The kitchen, laundry and boiler room are shared. Each guest does not build a kitchen. There is one
front desk (the registry) that knows where each shared service is and hands guests what they ask for.

In nooblyjs-core the front desk is one object, created once and exported at the bottom of `index.js`. Every other repo
gets the same object through `require('nooblyjs-core')`. That is why NooblyJS can only start the registry once per process.

The analogy stops working in one place: a hotel guest can check out. The registry stays for the life of the process.

## Where it lives in this repo

| Path | Why it matters |
| --- | --- |
| `index.js` | The `ServiceRegistry` class. `initialize()` is at line 54; the singleton is exported at line 972. |
| `src/` | One folder per service: `logging`, `caching`, `queueing`, `searching`, `authservice`, `aiservice`, `filing`, `workflow`… |
| `src/views/modules/monitoring` | Used by the registry for its own monitoring pages. |
| `app.js` and `app-noauth.js` | Two ways to run a demo server, one with sign-in and one without (for UI work only). |
| `test/` | The tests. Its `CLAUDE.md` says `tests/`, but the folder is `test/`; trust the code. |

## A small piece of code

This is how a hosted app asks the registry for a logger. It comes from `nooblyjs-ai-product/index.js`, line 61:

```js
// nooblyjs-ai-product/index.js:61
const log = serverManager.logger(serverManager.getDefaultProviderType('logging'), { instanceName: NAME });
```

- `serverManager` is the registry, passed in by NooblyJS. The app did not create it.
- `getDefaultProviderType('logging')` asks which logging provider the host chose.
- `{ instanceName: NAME }` names this app's copy, so its log lines are labelled and it doesn't mix with another app's.

## Try it

From the `nooblyjs-core` folder, run one of its tests for the AI service:

```
cd <workspace>/nooblyjs-core
node --test test/unit/aiservice/aiservice.test.js
```

Read the first few lines of that file to see how a test asks for a service, and where it gets the registry from.

## Words to know

- **Service registry**: the object that creates and hands out shared services.
- **Provider**: one way of doing a service, for example the `memory` cache or a Redis cache.
- **Singleton**: one object for the whole process. `module.exports = new ServiceRegistry()` makes one.
- **`instanceName`**: a label that lets two apps have their own copy of the same service.
- **`initialize()`**: connects the registry to the Express app and the event emitter. It runs once.

## Summary: what you've learnt

- You know nooblyjs-core is a shared toolbox, and that the registry is the front desk for it.
- You know the registry is created once per process and exported as one object.
- You know an app gets a service by name and provider, with its own `instanceName`.
- You know that a repo's own docs can be out of date, and that the code is the reference.
