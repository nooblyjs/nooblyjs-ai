# nooblyjs-ai-knowledge: one router, three kinds of request

**Lesson 01 · about 10 minutes · 2026-10-10**

## What you'll learn

- A hosted app mounts **one** router, and every request under its path goes through it.
- The router sorts each request into one of three kinds: the signed-in API, a plain browser file, or a page.
- Why a URL that looks like a file is treated as a page only sometimes, and what that means for wiki links.

## The idea, in plain words

NooblyJS is the building. The wiki is one tenant that rents a corridor, `/wiki`. Instead of putting a door on every
room, the wiki hands NooblyJS one door (the router) and NooblyJS opens it for requests that start with `/wiki`. Inside, the
wiki decides what each visitor gets:

1. **The API** (`/wiki/api/v1/...`). Only for signed-in people. It answers JSON, and an unknown API URL gets a JSON
   404, never a web page.
2. **Browser files** (`/wiki/js/module.js`, `/wiki/css/...`, `/wiki/vendor/...`). Static files the frame loads.
   If one is missing, you get a real 404.
3. **Pages** (`/wiki/Engineering/Architecture/notes`). Everything else. The wiki does not draw these itself. It
   hands them to NooblyJS's frame, which draws the NooblyJS shell and loads the wiki's UI into it. That is why refreshing a
   deep link works.

The tricky part is step 3. A wiki page can have a dot in its name, like `/wiki/Space/report.v2`, so "has a file
extension" is not enough to call something a file. The rule only treats a URL as a file when it sits in a folder
the browser loads files from, or when it is a top-level name with an extension. Everything else is a page. The
analogy stops at this point: a real building knows its rooms, but here the "rooms" are whatever the person typed in
the address bar.

## Where it lives in this repo

- `index.mjs`: the `register()` function. The router, the sign-in gate and the page fallback are all here.
- `src/hosted/api.mjs`: `createApi()` and `apiNotFound`, the JSON API and its last-resort 404.
- `public/`: the browser files that the static middleware serves. The `NOT_SERVED` set keeps `.html`, `.htm` and `.md`
  out of it, because the frame is the only HTML the app has.
- `test/register.test.mjs`: the contract tests. They check the 401/200/404 answers and that `/wiki/anything` stays
  inside the mount.

## A small piece of code

From `index.mjs` (lines 80-99), trimmed to the routing:

```js
router.use(['/api/v1', '/media', '/avatars'], host.auth);          // 80-81: signed-in only
router.use('/api/v1', createApi({ host, about: { ...about, hosted: { platform } } })); // 82
...
router.use('/api/v1', apiNotFound);                                 // 88: unknown API URL -> JSON 404
const topLevel = (req) => req.path.indexOf('/', 1) === -1;          // 89
router.use((req, res, next) => (topLevel(req) && NOT_SERVED.has(path.extname(req.path).toLowerCase()) ? res.status(404).end() : next())); // 90
router.use(host.express.static(PUBLIC_DIR, { index: false, redirect: false })); // 92: browser files
router.get('/{*rest}', (req, res, next) => {                        // 96: everything else
  const file = FILE_FOLDERS.test(req.path) || (topLevel(req) && path.extname(req.path));
  return file ? next() : host.frame(req, res, next);                // 98: a page goes to the frame
});
app.use(mountPath, router);                                         // 100: mounted once, under /wiki
```

- Line 81: the auth gate is put on the API, media and avatars **before** the API is mounted, so nothing under them
  runs without a signed-in person.
- Line 88: the API's own 404 comes after its routes, so an unknown `/api/v1/...` never falls through to a page.
- Line 92: `redirect: false` matters. Without it, `/wiki` would redirect to `/wiki/` because `public/` is a folder.
- Line 96: `{*rest}` is the Express 5 way of writing "match everything". Express 4 wrote `*`.
- Line 98: the decision in one line. A file if it is in a file folder, or a top-level name with an extension; a page
  otherwise.

## Try it

Run the contract test for this routing and read the names of what passes:

```bash
cd <workspace>/nooblyjs-ai-knowledge
node --test test/register.test.mjs
```

It runs five tests in about three seconds. The test named `the API is under /api/v1: 401 when signed out, an answer
when signed in` is the first kind of request above, seen from the outside.

## Words to know

- **Hosted app**: an app NooblyJS loads and mounts at a path, rather than running its own server.
- **`register()`**: the function NooblyJS calls with its Express app and `host`. It returns the app's description.
- **`host`**: the shared services NooblyJS gives the app: `auth`, `frame`, `express`, `events` and so on.
- **Frame**: NooblyJS's page shell. `host.frame(req, res)` answers a page request with it, and the wiki's UI loads inside.
- **Mount path**: the URL prefix the app lives under (`/wiki`). The router is attached once, at that path.
- **Middleware**: a function that runs on a request before the route. `router.use` adds one. Order matters: the
  first one that answers ends the request.
- **Catch-all route**: `/{*rest}` in Express 5, a route that matches any path.

## Summary: what you've learnt

- You know that the wiki mounts one router under `/wiki`, and that NooblyJS's sign-in sits in front of the API, media and
  avatars.
- You can tell the three kinds of request apart: JSON API, browser file, and page handed to the frame.
- You know why a wiki page with a dot in its name still reaches the frame, and why an unknown API URL never does.
- You know that the order of `router.use` lines is the routing table: the first match wins.
- You can run the contract tests and recognise which result is which kind of request.
