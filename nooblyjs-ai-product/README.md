# nooblyjs-ai-product

The **Product Factory** of NooblyJS AI: signals → ideas → specs → architecture (C4 views, ADRs) → UX and UI, with
RICE scoring, a roadmap, readiness checks and drafting agents. A hosted app: the NooblyJS AI host
(`../nooblyjs-ai-host`) imports `index.js` and calls `register()`, which mounts its screens (a UI module in the
host's frame) and its API at `/product/api/v1`. Drafting runs as teammate tasks (`host.service('teammates')`).

```bash
npm install
npm test        # offline, mock provider
npm start       # standalone for development, with a dev sign-in: http://localhost:11005/product
npm run seed    # writes the seed story into data/product/ (-- --reset to start again)
```

Needs Node 24 and `nooblyjs-core` next to the monorepo (`../../nooblyjs-core`). How it is built: `CLAUDE.md` and
`.claude/steering/` (product, structure, tech). Its phase history is `docs/roadmap-history.md`.
