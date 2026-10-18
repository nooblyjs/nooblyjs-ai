# Security — Dependency Audit Status

Last reviewed: 2026-09-09

This file records the production dependency audit (`npm audit --omit=dev`) state
and the disposition of each remaining advisory. Run the audit from the repo root.

## Summary

| | Before | After |
|---|---|---|
| Critical | 4 | 0 |
| High | 29 | 2 |
| Moderate | 40 | 10 |
| Low | 3 | 0 |
| **Total** | **76** | **12** |

## Fixed

- **`@google/gemini-cli` (was critical RCE + 4 high)** — **removed** from
  `package.json`. It is a terminal CLI application, not a library, and was
  never imported anywhere in the codebase (`grep` for `gemini-cli` returns no
  source hits). Gemini AI support is provided via the Google API using
  `GEMINI_API_KEY` / `GEMINI_MODEL`, not this package. Removing it also cleared its
  vulnerable transitive dependencies (`@opentelemetry/*`, `protobufjs`,
  `simple-git`, `shell-quote`).
- **`ws`, `uuid`, `gaxios`** and related — resolved via non-breaking `npm audit fix`.

## Removed supply-chain junk

- **`all@^0.0.0`** and **`rimraff@^0.0.1-security`** — removed from the root
  `package.json`. `all` is an empty placeholder; `rimraff` is a typosquat of
  `rimraf` (npm's `-security` hold version). Neither was used; the real `rimraf`
  is retained.

## Remaining — accepted / needs team decision

These have **no non-breaking upstream fix** and removing them would drop features
that are still wired in. They are documented risks, not silent ones.

### `xlsx` (high) — Prototype Pollution + ReDoS — NO npm FIX

- **Advisories:** GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9
- **Reachability:** `src/shared/processors/xlsxprocessor.js` calls
  `XLSX.readFile()` on **user-uploaded** `.xlsx`/`.xls` files, so the advisories are
  reachable via the document-upload path.
- **Why not auto-fixed:** the npm-published `xlsx@0.18.5` line is abandoned. SheetJS
  now ships fixed builds **only** from their own registry.
- **Recommended remediation (requires a deliberate install):**
  ```bash
  npm rm xlsx
  npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
  ```
  Verify `xlsxprocessor.js` still converts after the swap (the `readFile` /
  `utils.sheet_to_json` API is unchanged in current SheetJS).
- **Interim controls:** uploads are already authenticated (wiki API auth guard);
  keep upload size limits in place and treat converter output as untrusted.

### `pptx-parser@1.1.7-beta.9` (moderate, + `jszip`, + `postcss`/`css-loader` cluster)

- **Reachability:** `src/shared/processors/pptxprocessor.js` imports it.
  Per `CLAUDE.md`, `.pptx` conversion is **permanently unsupported** at runtime
  (its converter needs a browser `window`), so the code path does not complete in
  the backend.
- **Why not removed:** it is still `require()`d at module load, so removing the
  package without also removing/guarding the import would throw on load.
- **Recommended remediation (team decision):** either (a) remove `pptx-parser` and
  make `pptxprocessor.js` a no-op/clear error, since the feature is unsupported, or
  (b) replace with a maintained parser. Option (a) also clears the entire
  `postcss@7` / `css-loader@3` / `jszip` transitive cluster (6 of the 12 remaining
  advisories) in one step.

### Prerelease dependencies in a production build

- `multer@2.0.0-rc.4` (release candidate) and `pptx-parser@1.1.7-beta.9` (beta)
  should be pinned to stable releases before a production cut.

## Verification

- Backend test suite after these changes: **1660 passing** (5 suites fail to
  *load* only because the sibling `nooblyjs-core` /
  `noobly-app-wiki-workflows` repos are not present in this
  environment — dependency resolution, not logic).
