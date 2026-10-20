# nooblyjs-ai-infrastructure

NooblyJS **Infrastructure**: infrastructure designs drafted from an approved architecture, the environments built
from them, provisioning runs, drift and cloud cost.

It is a **hosted app** (a micro-frontend) for NooblyJS. NooblyJS (`../nooblyjs-ai-host`) imports `index.js`, calls
`register(app, serverManager, options)`, and this app attaches its API and its UI module under
`/infrastructure`. NooblyJS draws the rail, the sidebar and the chat; this app draws the content area.

- What it does and shows: `.claude/steering/product.md`
- Platform rules and the `register()` contract: `.claude/steering/stack.md`
- Layout, API, data and events: `.claude/steering/structure.md`
- **Progress:** NooblyJS's roadmap, `../.claude/steering/roadmap.md` ("Hosted apps: open work"); history in `docs/roadmap-history.md`

## Run it on its own

Clone the NooblyJS repos side by side (this one needs `../nooblyjs-core`).

```bash
npm install
npm start                  # http://localhost:11008  → sign in at /login (Stevie is the Owner)
npm test                   # offline: mock provisioner, stand-in host
npm run seed -- --reset    # rewrite data/infrastructure/ with the INF-031 story
```

Standalone mode is for development: it uses a dev sign-in and refuses to start with `NODE_ENV=production`.
Everything the app stores is a readable file under `data/infrastructure/`.

## Not yet

It is hosted by NooblyJS at `/infrastructure` (NooblyJS Phase 9a). There is no real provisioner yet (only `mock`), and the
drafting agent is not wired up. See the roadmap.
