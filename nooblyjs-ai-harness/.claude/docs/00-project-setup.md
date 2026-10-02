# Phase 00: Project setup

**Goal:** a skeleton that runs, has a test command, and has a place for everything we'll add later.

---

## 1. The file map

```
nooblyjs-learn-harness/
├── bin/
│   └── noobly.js              ← the command you run. Tiny: it loads tsx, then src/cli.js
├── src/
│   ├── cli.js                 ← reads flags (-p, --model, --echo…) and picks a mode
│   ├── index.js               ← lets other code `import { Session } from 'nooblyjs-learn-harness'`
│   ├── config/
│   │   └── defaults.js        ← model names, prices, system prompt: all settings in one place
│   ├── core/                  ← the "brain": no screen, no HTTP
│   │   ├── session.js         ← remembers the conversation (Phase 2)
│   │   ├── commands.js        ← /help, /clear, /cost …
│   │   ├── cost.js            ← tokens → dollars
│   │   └── messages.js        ← small helpers for message data
│   ├── providers/             ← how we reach a model
│   │   ├── anthropic.js       ← the real Claude API over HTTP (Phase 1)
│   │   └── echo.js            ← a fake model for trying things out and for tests
│   ├── ui/                    ← everything you see (Ink / React)
│   │   ├── start.jsx          ← mounts the app in the terminal
│   │   ├── App.jsx            ← the chat screen
│   │   ├── theme.js           ← colours
│   │   └── components/        ← Banner, Message, PromptInput, StatusBar, Thinking
│   └── util/
│       └── log.js             ← debug log (NOOBLY_DEBUG=1 → ~/.noobly/debug.log)
├── test/                      ← one test file per module
├── package.json               ← project name, dependencies, scripts
├── tsconfig.json              ← tells tsx how to understand JSX
└── .claude/
    ├── specs/                 ← PRD, Architecture, roadmap (the plan)
    └── docs/                  ← these notes (what was built)
```

**Rule of thumb:** `core/` never imports from `ui/`, and `ui/` never talks to `providers/` directly. Arrows only point one way: UI → core → provider.

## 2. `package.json`, explained

```jsonc
{
  "type": "module",                     // use modern `import`/`export` (ES modules)
  "bin": { "noobly": "bin/noobly.js" }, // `npm link` turns this into a real `noobly` command
  "engines": { "node": ">=22" },        // we rely on built-in fetch, node:test, parseArgs
  "scripts": {
    "start": "node bin/noobly.js",      // npm start
    "test": "node --import tsx --test …"// npm test
  },
  "dependencies": {
    "ink": "…",            // React for the terminal: boxes, colours, layout
    "react": "…",          // Ink is built on React
    "ink-text-input": "…", // a ready-made text input box
    "ink-spinner": "…",    // the ⠋⠙⠹ spinner
    "tsx": "…"             // lets Node run .jsx files without a build step
  }
}
```

### Why did we switch from CommonJS to ES modules?

The repo started with `"type": "commonjs"` (the old `require()` style). **Ink only ships as an ES module**, so the whole project now uses `import`/`export`. Mixing the two styles is possible but confusing, so we picked one.

| CommonJS (old) | ES modules (now) |
|---|---|
| `const fs = require('fs')` | `import fs from 'node:fs'` |
| `module.exports = { x }` | `export { x }` |
| `__dirname` works | use `new URL('../file', import.meta.url)` instead |

### What is `tsx` and why do we need it?

Our UI is written in **JSX**, the HTML-like syntax React uses:

```jsx
<Text color="cyan">Hello</Text>
```

Node can't run that directly. `tsx` quietly converts it to normal JavaScript as each file loads:

```js
jsx(Text, { color: 'cyan', children: 'Hello' })
```

That's why `bin/noobly.js` starts with `register()` from `tsx`, and why tests run with `node --import tsx`. `tsconfig.json` contains `"jsx": "react-jsx"`, which tells tsx to use React's modern JSX transform (so you don't need `import React` in every file).

## 3. How `noobly` starts

```
$ noobly -p "hi"
   │
   ▼
bin/noobly.js      register tsx → import src/cli.js
   │
   ▼
src/cli.js         parseArgs() reads the flags
   ├─ --help / --version  → print and exit
   ├─ makeProvider()      → echo (--echo) or anthropic (needs ANTHROPIC_API_KEY)
   ├─ new Session(...)
   ├─ -p given?  → runOnce(): send, print answer, exit
   └─ otherwise  → import ui/start.jsx → render the Ink app
```

`parseArgs` is built into Node (`node:util`), so there's no extra package for flags.

## 4. Tests

- Runner: Node's built-in `node:test` (no Jest/Mocha needed).
- Assertions: `node:assert/strict`.
- Every test is **offline**. Where a model is needed, we pass in a fake one.

```bash
npm test
```

| File | What it proves |
|---|---|
| `test/cost.test.js` | Token → dollar maths is right |
| `test/anthropic.test.js` | We send the right URL, headers and body; API errors become readable errors |
| `test/session.test.js` | History is re-sent every turn; failures don't corrupt history; `/clear` resets |
| `test/commands.test.js` | Slash commands do what they say |
| `test/ui.test.jsx` | UI components render the right text (using Ink's `renderToString`) |

**Try it:** break something on purpose (change `input: 4` to `input: 5` in `defaults.js`) and run `npm test`. See the failure, then undo the change.

## 5. Debugging

```bash
NOOBLY_DEBUG=1 noobly --echo
tail -f ~/.noobly/debug.log     # in another terminal
```

We never `console.log` inside the UI: Ink owns the screen, and stray prints would scramble it. That's what the debug log file is for.

## What we learned

- A CLI is just a script with a shebang (`#!/usr/bin/env node`) plus a `bin` entry in `package.json`.
- Pick **one** module system. Ink forced ES modules on us.
- Build steps can be avoided: `tsx` compiles JSX on the fly.
- Keeping `core/`, `providers/` and `ui/` separate pays off right away in tests.
