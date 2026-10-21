# nooblyjs-ai

**NooblyJS AI** in one repository: an engineering-lifecycle platform (idea → spec → architecture → design → build →
ship, where AI agents draft and people decide), the agent harness it runs on, and a desktop app for any LLM.

| Project | What it is |
| --- | --- |
| [`nooblyjs-ai-host`](nooblyjs-ai-host) | The host: one process and one frame for every app. Home, the lifecycle engine, onboarding and people, team chat, Platform and governance, Metrics, Microsoft Entra and Teams, Jira and Bitbucket (integrations off until configured) |
| [`nooblyjs-ai-factory`](nooblyjs-ai-factory) | The Software Factory, one app at `/factory` with two parts: the **Product section** ([`product/`](nooblyjs-ai-factory/product): signals, ideas, specs, architecture, UX and UI, drafting agents; at `/factory/product`) and the **line** (issues in, verified PRs out; also the `factory` CLI) |
| [`nooblyjs-ai-infrastructure`](nooblyjs-ai-infrastructure) | Infrastructure: designs, environments, provisioning runs, drift, cloud cost, on a mock provisioner (hosted at `/infrastructure`, or standalone) |
| [`nooblyjs-ai-teammate`](nooblyjs-ai-teammate) | Digital Teammates: hire, configure, budget and bill named AI agents (hosted at `/teammates`, or standalone) |
| [`nooblyjs-ai-knowledge`](nooblyjs-ai-knowledge) | The knowledge repository: wiki, datasources, AI answers with citations, MCP (hosted at `/wiki`) |
| [`nooblyjs-ai-harness`](nooblyjs-ai-harness) | `noobly`, the agent runtime and AI coding CLI every agent runs in |
| [`nooblyjs-ai-desktop`](nooblyjs-ai-desktop) | Projects, documents and chat for any LLM (standalone) |

## Run it

Needs **Node 24** and [`nooblyjs-core`](https://github.com/nooblyjs/nooblyjs-core) checked out next to this repo. Core also
holds the AI module every project calls models through: `nooblyjs-ai-common` (one way to call every model provider,
including Bedrock, Vertex AI and Azure; the model catalogue; cost), at `nooblyjs-core/src/aiservice/common`:

```bash
git clone https://github.com/nooblyjs/nooblyjs-core.git
git clone https://github.com/nooblyjs/nooblyjs-ai.git
cd nooblyjs-ai
npm install            # installs every project, in dependency order (scripts/each.js)
npm run seed           # the host's sample story (the fictional Acme Retail)
npm start              # the host, with every app on the rail: http://127.0.0.1:11001
npm test               # every project's tests, offline
npm run start:teammate # one app on its own (also :infrastructure, :desktop, :knowledge, :factory, :harness)
```

The shared rules every project follows are in `nooblyjs-ai-host/.claude/steering/nooblyjs-ai-shared-rules.md`, copied
into each project's `.claude/steering/nooblyjs-ai.md` by `npm run steering:sync`. The whole factory, across the full
lifecycle from business case to production and back, is in [`.claude/steering/`](.claude/steering): `product.md`,
`design.md`, `stack.md` and `roadmap.md`.
