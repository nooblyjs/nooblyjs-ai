# nooblyjs-ai-host: how NooblyJS starts

**Lesson 01 · about 10 minutes · 2026-10-10**

## What you'll learn

- NooblyJS is one program that holds the whole platform, and other apps plug into it.
- `app.js` is the single entry point, and it builds things in a fixed order.
- A "hosted app" is a separate repo that NooblyJS loads at start-up and gives a place on the page.

## The idea, in plain words

Think of NooblyJS as a shopping centre. The building (the host) owns the lights, the doors and the security desk
(sign-in). Each shop (a hosted app, such as the Product Factory or the Software Factory) runs its own business,
but it has to open in a unit the centre provides, use the centre's door, and follow its rules. The shop does not
build its own building.

In code, the building is `app.js`. It does the boring shared jobs first: a web server, security headers, sign-in,
and the shared service registry (`nooblyjs-core`). Only after those are ready does it let the shops in. Each shop is
listed in `data/config/hosted-apps.yaml` and is opened by calling its `register()` function.

The analogy stops working in one place: a shop cannot start a second building. Children must not listen on a port
or call the registry's `initialize()` themselves, because only the host does that.

## Where it lives in this repo

| Path | Why it matters |
| --- | --- |
| `app.js` | The entry point. `createApp()` builds everything without listening; the bottom of the file starts the server. |
| `src/noobly.js` | `mountNoobly()`: the NooblyJS layer (events, audit log, roles, Home, chat) and the loading of hosted apps. |
| `src/hosted-apps.js` | Reads `hosted-apps.yaml`, checks each entry, and calls each app's `register()`. A failing app is logged and shown as unavailable; it does not stop NooblyJS. |
| `data/config/hosted-apps.yaml` | The list of apps and their mount paths (`/product`, `/factory`, `/wiki`…). |
| `package.json` | `npm start` runs `node --env-file-if-exists=.env app.js`. |

## A small piece of code

This is the start of `createApp()` in `app.js`, lines 84 to 93, trimmed of comments:

```js
// app.js:84
export async function createApp({ config, devtoolsFetch, devtoolsGitRemote, teamsFetch, graphFetch }) {
  const serviceRegistry = require('nooblyjs-core');
  if (serviceRegistry.initialized) {
    throw new Error('nooblyjs-core is already initialised in this process. NooblyJS runs one app per process.');
  }
  // STEP 0: Data folder and seed (before nooblyjs-core writes its own files into it)
  const { store, seeded } = await prepareData(config);
```

- Line 84: `createApp` takes a `config` and returns the running app. Tests call it too, on port 0, so they can run the
  whole thing without a real port. The other arguments let a test hand in a fake Jira, Bitbucket or Microsoft, so
  nothing reaches a real system.
- Line 86: the registry can be set up only once per process. That is why the message says "one app per process".
- Line 93: the data folder is prepared before anything else writes to it. Order matters: a folder must exist before
  files go into it.

The steps after this are numbered `STEP 1`, `STEP 2` and so on in the same file. Notice that the server starts
listening only at the bottom (`server.listen`, around line 414), after everything is mounted.

## Try it

Run one test file that starts the whole app on a random port and checks the shell it serves:

```
cd <workspace>/noobly
node --test test/shell.test.js
```

It runs offline, and it should pass. It writes only to a temporary data folder. Read the first `describe` or `test`
in that file to see what the shell is expected to contain.

## Words to know

- **Composition root**: the one file where everything is put together (`app.js`).
- **Host**: NooblyJS itself. It owns the server, sign-in and the shared services.
- **Hosted app**: a child repo that NooblyJS loads and mounts at a path.
- **`register()`**: the function each hosted app exports. NooblyJS calls it with the Express app, the registry and a `host` object.
- **`serverManager`**: the name the docs use for `nooblyjs-core`'s service registry, the shared set of services (cache, logs, queues).
- **Mount path**: the URL prefix an app lives under, such as `/product`.
- **`createApp()`**: builds the app without listening. Tests use it; `npm start` uses it and then listens.

## Summary: what you've learnt

- You know that NooblyJS is one program, and that `app.js` is where everything starts.
- You know the order matters: the data folder and the shared services come before the apps.
- You know that a hosted app is listed in a YAML file, given a mount path, and opened through `register()`.
- You know that a broken app is shown as unavailable, and NooblyJS keeps running.
- You know how to run one offline test that starts the whole app.
