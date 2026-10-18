# nooblyjs-core: the service factory

**Lesson 02 · about 10 minutes · 2026-10-10**

## What you'll learn

- A service folder under `src/` exports one factory function. That function builds the service, its routes and its dashboard in one go.
- The provider type decides which engine gets built. The options decide how it is set up.
- The factory does not reject an unknown provider type. It quietly builds the default one, which matters when you make a typo.

## The idea, in plain words

Lesson 01 showed that the registry calls a service's factory and caches what it returns. This lesson is about what happens inside that call.

A factory is a recipe card for building one kind of service. You hand it an order, the provider name, such as `redis` or `memory`, plus some settings. It picks the matching engine, wires in the things that engine needs, and then attaches the service's web pages and API routes. What comes back is a finished object, ready to use.

Think of a kitchen. The order slip says "pasta". The kitchen picks the recipe for that dish, using the ingredients the order gives it. Then it sends out the dish with the menu card and the table sign already in place. The kitchen does not sort the menu and the sign out later. The analogy stops working here: a real kitchen refuses an order it cannot make. This factory does not. An unknown order gets the plainest dish on the menu, and nobody is told.

Terms you will meet:

- **Provider** — one engine behind a service name. Caching has `memory`, `redis`, `memcached`, `file`, `api`, `aws`, `azure` and `gcp`.
- **Routes** — the API endpoints for the service, mounted on Express under `/services/<name>/api/...`.
- **Views** — the dashboard pages for the service, under `/services/<name>/`.
- **`express-app`** — the Express application, passed in through the options. The routes need it to attach themselves.
- **Analytics module** — a small listener that counts what the service does, for the dashboard. You will meet it again later.

## Where it lives in this repo

- `src/caching/index.js` — the factory itself. Every service has one of these at `src/<service>/index.js`.
- `src/caching/providers/` — the engines (`caching.js` is the memory one, `cachingRedis.js` is Redis, and so on).
- `src/caching/routes/index.js` — the API routes. It only registers them if an Express app was passed in.
- `src/caching/views/` and `src/caching/scripts/` — the dashboard page and the browser-side script.
- `index.js:128` — where `ServiceRegistry.initialize()` puts `'express-app'` into the options that every factory later receives.

## A small piece of code

These are the parts of `createCache` that matter most, with the lines in between left out (`src/caching/index.js`):

```js
60  function createCache(type, options, eventEmitter) {
61    const { dependencies = {}, ...providerOptions } = options;
62    const logger = dependencies.logging;
...
67    switch (type) {
68      case 'redis':
69        cache = new CacheRedis(providerOptions, eventEmitter);
70        break;
...
89      case 'memory':
90      default:
91        cache = new Cache(providerOptions, eventEmitter);
92        break;
93    }
...
128    Routes(options, eventEmitter, cache);
129    Views(options, eventEmitter, cache);
130    Scripts(options, eventEmitter, cache);
```

- **Line 60** takes the provider type and the options. The registry supplies both, through `getService()` from lesson 01.
- **Line 61** splits the options in two. `dependencies` (the other services this one needs, such as `logging`) is kept separate from `providerOptions` (the settings for the engine).
- **Lines 67-93** are the choice of engine. One `case` per provider name.
- **Lines 89-91** are the surprise. `case 'memory':` and `default:` share a body, so any name the switch does not know gets the memory cache. There is no error.
- **Lines 128-130** attach the service to the outside world. The factory calls the routes, the views and the scripts with the cache it just built.

Inside `src/caching/routes/index.js:36-38`, the routes do their own check before they register anything:

```js
36  module.exports = (options, eventEmitter, cache) => {
37    if (options['express-app'] && cache) {
```

No Express app means no routes. The service still works, so it can be built in a script or test without a web server.

## Try it

From the nooblyjs-core folder, run the caching route test. It should show 10 passing tests:

```
npx jest test/unit/caching/cachingRoutes.test.js
```

Then open `src/caching/index.js` at line 67 and find the `case` for the provider you care about, for example `'redis'`. Read the one line that builds it.

**Two things in the repo do not agree.** The factory's JSDoc at line 38 says it throws on an unsupported provider type. The code does not throw. A bad name gives you the memory cache. I checked this by calling the factory with the type `bogus`, which returned a `Cache`. Trust the code. The same JSDoc is a reason to be careful: if you mistype a provider name, your cache will quietly use memory, and nothing will say so.

## Words to know

- **Factory** — a function that builds an object from a type name and some options. Here it is `createCache` in `src/caching/index.js`.
- **Provider** — one of several engines behind the same service, chosen by the `type` argument.
- **Dependencies** — other services handed to a service through its options, such as `logging`.
- **Route** — a URL and the code that answers it, for example `GET /services/caching/api/status`.
- **View** — a dashboard page for a service, served under `/services/<name>/`.
- **Express app** — the web server object that routes attach to. It is passed in as `options['express-app']`.
- **Analytics module** — a listener that records a service's activity so the dashboard can show counts.

## Summary: what you've learnt

- You know that each service folder exports one factory, and that the factory builds the engine, the routes and the dashboard together.
- You know that the provider name is a `switch`, and that the options carry the settings and the dependencies.
- You know that routes only attach when there is an Express app, so a service can run without a web server.
- You know that an unknown provider name silently gives you the memory engine, and that the JSDoc says otherwise, so check your spelling.
- You know where to look: `src/caching/index.js` for the factory and `index.js:128` for where the Express app is handed in.

Next up, you'll meet the analytics module and the shared event emitter.
