# Linked Documents for Content Jobs

How a workflow that builds wiki content emits a **Linked documents** band — the row of
cards showing what a page relates to.

Readers get that band from the **Link documents** dialog. This document is for the other
producer: the jobs in `noobly-app-wiki-workflows` that generate pages from
ARIS, Target Process, git repositories and the rest. A job usually knows the relationships
better than anyone — it just walked the model that contains them — so it should write them
down rather than leaving the reader to rediscover them by hand.

**Implementation detail** — the grammar, the routes and the access model — is in
`CLAUDE.md` under *Linked documents*. This document is the guide for writing a job.

---

## What you are producing

A single fenced block anywhere in the page's markdown:

````markdown
```linked-documents
title: Related landscapes
across: 4
- Solution Design/Application Landscapes
- Solution Design/Reference Landscapes/overview.md | Reference overview
```
````

| Line | Required | Meaning |
|---|---|---|
| `title:` | no | Section heading. Omit for the default, "Linked documents". |
| `across:` | no | Cards per row. Omit and the band fits as many as the width allows. |
| `- <reference>` | yes | One link. Order is reading order — it is preserved exactly. |
| `- <reference> \| <label>` | no | Same, with the card title overridden. |

A reference may point at a **document or a folder**. Folders are usually the more useful
link: they carry an item count and a cover preview, and they stay valid while the files
inside them churn.

There is no separate index file. The links live in the markdown, because path is identity
in this wiki and the documents are what gets cloned, versioned and read outside the app.

---

## The one thing that goes wrong: reference paths

**References are relative to the SPACE's content root, not to your job's
`contentfolder`.**

A solution-design job writes into:

```
../knowledge-content/engineering/Solution Design      ← your contentfolder
../knowledge-content/engineering                      ← the space content root
```

So a link to the Application Landscapes folder is:

```
- Solution Design/Application Landscapes             ✅ space-root relative
- Application Landscapes                             ❌ resolves to the wrong place
```

Get this wrong and nothing errors. The card renders, muted and dashed, saying *"This link
no longer resolves"* — which looks like a broken target rather than a broken job.

Use the helper rather than string-joining:

```js
const links = require('../../common/content/linkedDocuments');

const spaceRoot = path.dirname(this.settings.contentfolder);   // see note below
const ref = links.spaceRelativeRef(spaceRoot, absolutePathOfTarget);
if (ref) items.push(ref);        // '' means "outside the space" — do not emit it
```

`spaceRelativeRef` resolves both arguments first, so relative and absolute inputs mix
freely, normalises Windows separators, and returns `''` when the target sits outside the
space root. **Always check for `''` and skip** — emitting an unresolvable reference is
the same failure as getting the prefix wrong.

> **On `spaceRoot`.** Every current job's `contentfolder` is exactly one level below its
> space root (`.../engineering/Solution Design`, `.../engineering/Product Management`,
> `.../engineering/Infrastructure Design`), so `path.dirname(contentfolder)` is right
> today. It is a convention, not a guarantee — if a job ever writes two levels down, pass
> the space root through workflow settings instead of deriving it.

### Should you name the space?

A reference can be prefixed — `[Engineering Space]/Solution Design/Landscapes` — but a job
normally **should not**.

Several spaces are views of one content root (Engineering, Retail, Fintech and People
all sit on `knowledge-content/engineering`). A bare reference resolves against whichever
space the reader is currently in, so one generated link works correctly for all four. Name
a space and you pin the link to that one — a reader in another space sees *"Not available
in your spaces"*, and a space rename breaks it outright.

Prefix only when you genuinely mean "the copy in that space, and no other".

---

## Writing the block

`common/content/linkedDocuments.js` is self-contained (only `node:path`), so any workflow
can require it directly — the same arrangement as `common/content/wikiBlocks.js`.

```js
const path = require('node:path');
const links = require('../../common/content/linkedDocuments');
const filesystem = require('../../common/architecture/filesystem/filesystem');

function buildLandscapePage(folder, subfolders) {
    const spaceRoot = path.dirname(this.settings.contentfolder);

    const items = subfolders
        .map((sub) => links.spaceRelativeRef(spaceRoot, sub.absolutePath))
        .filter(Boolean);

    const block = links.buildLinkedDocumentsBlock(items, {
        title: 'Related landscapes',
        across: 4
    });

    let markdown = renderTheUsualPage(folder);          // your existing content
    markdown = links.setLinkedDocumentsBlock(markdown, block);

    filesystem.writeFile(pagePath, markdown);           // → writeMarkdownPreserving
}
```

Two helpers do the work:

- **`buildLinkedDocumentsBlock(items, options)`** — takes reference strings or
  `{ ref, label }` objects, drops empties and duplicates (first occurrence wins, so your
  ordering survives), caps at 60 (the platform's own limit), and returns `''` when nothing
  is left. Concatenate it unconditionally: a page with no links simply gets no band.
- **`setLinkedDocumentsBlock(markdown, block)`** — replaces an existing band or inserts one
  **above** any trailing page furniture (`comments`, `liked`, `reviews`,
  `sharedlinkvisits`), so the band reads as part of the page instead of sitting under the
  comment thread. An empty `block` removes the band.

It **must** be a triple-backtick fence. The wiki parser detects `linked-documents` by
fence only, never by indentation — its name is ordinary English, and prefix detection
would otherwise swallow any paragraph opening "Linked documents …". An indented variant is
silently ignored. This is the same rule the `document` block follows.

---

## Ownership: pick one of three

A page can have links from your job *and* links a reader added through the **Link
documents** dialog. Decide which of you owns the band, because the wiki cannot tell the two
apart — nothing in the file records where a link came from.

### 1. The reader owns it — emit nothing (default)

Do nothing. `writeMarkdownPreserving` treats `linked-documents` as a singleton and carries
the reader's band across your regeneration, exactly as it already does for `comments`,
`liked` and `document`.

This is what every existing job does today, for free. If your job has no relationships
worth publishing, stop here.

### 2. Your job owns it — emit the block

Emit the band as above. A block in the new content wins outright; the reader's is
discarded.

Pick this when the links are **derived** — subfolders of a landscape, components of a
solution, repositories in a group. Because the source system is the truth, a link you stop
generating actually disappears, which is the behaviour you want when a folder is deleted.

Tell readers, on the page, that the band is generated — otherwise curation there is quietly
lost on the next run.

### 3. Additive — merge

```js
const existing = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : '';
markdown = links.mergeLinkedDocuments(existing, markdown);   // BEFORE the write
filesystem.writeFile(pagePath, markdown);
```

Generated links first, then any reference already on the page that this run did not
produce.

**The trade-off is real.** A link your job generated last run and has now dropped —
because its source disappeared — is indistinguishable from one a reader added, so it is
carried forward and the band never shrinks. Use this only when the job *contributes*
suggestions rather than describing a structure.

Call `mergeLinkedDocuments` **before** `writeFile`. It only understands the
linked-documents block; comments, annotations and likes are restored afterwards by
`writeMarkdownPreserving`.

---

## Checking your work

**On disk.** Open the generated `.md`. The block should be a bare fence with
space-root-relative references and no `[Space]` prefixes.

**In the wiki.** Open the page. Every card should show a real title, and a folder card
should show an item count. A muted dashed card means one of two things:

| Card says | Cause |
|---|---|
| *This link no longer resolves* | The reference is wrong — almost always job-relative instead of space-root-relative — or the target has been deleted. |
| *Not available in your spaces* | The reference names a space the reader cannot reach, or the path is curated away by that space's `excludedPaths`. Usually means you prefixed a space you should not have. |

**Without the UI.** The resolve endpoint answers the same question the cards do, in one
call — useful from a test script:

```
POST /applications/wiki/api/linked-documents/resolve
{ "spaceName": "Engineering Space",
  "refs": ["Solution Design/Application Landscapes"] }
```

Each result comes back as `kind: "folder" | "file" | "missing" | "hidden"`, with the title,
item count and last-modified date the card will show. Anything other than `folder` or
`file` is a link your readers will see as broken.

The whole wiki API sits behind a bearer middleware, so `Authorization: Bearer
$WORKFLOW_API_TOKEN` works — the same pre-shared service token the schedule API and the
build-context step already use. A personal token from **Profile → API tokens** works too;
see [MCP-Server.md](MCP-Server.md).

> `hidden` is a **per-caller** verdict, not a property of the reference — it means *this
> caller, asking about this space, may not see that path*. Two consequences when you are
> debugging: ask about the space your readers actually use, and remember the
> `WORKFLOW_API_TOKEN` service account is a member of no space, so a **private** space
> answers `hidden` for it even where real readers see a perfectly good card. Its `admin`
> role does not exempt it. A `missing` verdict, by contrast, really is about the path.

---

## Reference

**`common/content/linkedDocuments.js`** (workflows repo)

| Export | Purpose |
|---|---|
| `spaceRelativeRef(spaceRoot, target)` | Absolute path → reference. `''` when outside the root. |
| `buildLinkedDocumentsBlock(items, options)` | Items → fenced block. `''` when empty. |
| `setLinkedDocumentsBlock(markdown, block)` | Place, replace or remove the band. |
| `mergeLinkedDocuments(oldContent, newContent)` | Additive ownership (model 3). |
| `parseLinkedDocuments(markdown)` | Read a band back out. |
| `normaliseRef(ref)` / `refKey(ref)` | Canonical form; case-insensitive identity. |

**`common/content/wikiBlocks.js`** — `linked-documents` is in `SINGLETON_TYPES`, so
`writeMarkdownPreserving` carries a reader's band across a regeneration. Without that entry
every job run would silently destroy hand-curated links.

### Keep three implementations in step

The grammar exists three times, and they must agree:

| Where | File |
|---|---|
| Jobs | `noobly-app-wiki-workflows/common/content/linkedDocuments.js` |
| Platform | `src/wiki/components/linkedDocumentBlocks.js` |
| Browser | `public/js/markdown/markdown-parser.js` → `parseLinkedDocuments` |

The platform and browser copies are pinned against each other by
`tests/backend/components/linkedDocumentBlocks.test.js`, which asserts a byte-identical
round trip. The workflows copy is in a separate repository and **is not covered by that
test** — the same cross-repo lockstep that already applies to `contextProcessor.js`. If the
grammar changes, change all three.
