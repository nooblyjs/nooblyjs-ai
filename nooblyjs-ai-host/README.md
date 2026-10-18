# nooblyjs-ai-host

The host app for **NooblyJS AI**, an engineering-lifecycle platform: idea → spec → architecture → design → build →
ship, where AI agents draft and people decide. One process serves one frame (rail, sidebar, chat dock) from
`nooblyjs-core`'s UI kit and mounts the hosted apps (Product, Factory, Infrastructure, Teammates, Knowledge) through
their `register()`. It owns Home, the lifecycle engine, onboarding and people, team chat, Platform and governance,
Metrics, and the integrations (Microsoft Entra and Teams, Jira and Bitbucket), which are off until configured.

```bash
cp .env.example .env     # NOOBLY_DEV_LOGIN=true gives a dev sign-in picker; AI_PROVIDER=mock needs no key
npm install
npm run seed             # writes the sample story into data/ (the fictional Acme Retail)
npm start                # http://127.0.0.1:11001
npm test                 # offline
```

Needs Node 24 and `nooblyjs-core` checked out next to the monorepo (`../../nooblyjs-core`). How it works:
`CLAUDE.md`, and the steering docs in `.claude/steering/` (product, tech, structure, roadmap).
