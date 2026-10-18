---
inclusion: always
---

# Product Factory engine: this repo in NooblyJS

> **Read `NOOBLY.md` first** (in this folder; generated from noobly). noobly owns everything shared, and this file does not
> repeat it: the hosted-app contract is `../nooblyjs-ai-host/.claude/steering/structure.md` §2a, the cross-app services are
> `../nooblyjs-ai-host/.claude/steering/tech.md` §8b, governance and the permissions matrix are `../nooblyjs-ai-host/.claude/steering/product.md`,
> and the one roadmap is `../nooblyjs-ai-host/.claude/steering/roadmap.md` (with the hosted-app checklist this repo must pass).
> If this file and noobly disagree, **noobly wins**: follow it and fix this file in the same change.
>
> NooblyJS mounts this repo at **`/product`**. This file gives only this repo's values for the contract, where it
> differs from the defaults, and what it is like today.

## 1. This repo's values

| | |
| --- | --- |
| Entry | `index.js` (`"main"`, `"exports"`) |
| `register()` | default mount `/product`, name `product`, styles `css/product.css`, data under `data/product/`. It owns every URL under `/product` (`/product/specs/PRD-031`): the frame answers and this repo's UI module draws them |
| Standalone | `npm start` runs `server.js` (nooblyjs-core's `createShell()` and kit); the `host` is the stand-in in `test/fixtures/host.js` (dev sign-in by the `X-Dev-Person` header or the `/login` picker) |
| Dependencies | `js-yaml`, `nooblyjs-core`, `nooblyjs-ai-common`, `nooblyjs-ai-harness`; `express` for `server.js` only |
| `agent.action` | `system: 'product'`. Drafts are teammate tasks by work type; in production a draft without Teammates is refused (503), never mocked |
| `services`, events | `host.service('product')` is in noobly `tech.md` §8b; events in `structure.md` |

## 2. Screens (this repo's UI module)

The Product Factory screens are this repo's, like Teammates' (`../nooblyjs-ai-host/docs/hosted-apps/porting-an-app.md`).
`public/js/module.js` exports the route table; each page in `public/js/pages/` takes
`render(view, { params, query, ctx, route })` and talks to the API only through `ctx.api` (which sends the
host's CSRF token). Rules:

- Build with the kit (`/ui/js/html.js` and `/ui/js/components/`); everything into HTML goes through `html```.
- Every selector in `public/css/` starts with `[data-module="product"]` (tested).
- Pages never touch `history`, `popstate` or `<body>`; links are plain `<a href>` the frame turns into navigation.
- Status is said in words; colour is only a second signal. axe runs on every nav page in NooblyJS's e2e suite.
- The screens were designed from mockups (the original design brief), which are not kept in this repo; the built screens are now the reference.

## 3. Platform (NooblyJS Phase 9)

**NooblyJS Phase 9 (Platform).** Hosted, a draft request and a queued draft ask `host.service('platform').checkAgentWork({
system: 'product', workType, teammateId, itemId })`: at the budget it is refused with Platform's words (402
`budget_reached`), and Platform records the refusal. The month's spend on the status card is Platform's
(`spendFor('product')`). A failed draft keeps the refusal's code as `errorCode`. Standalone, `budget.yaml` applies as before.

## 4. This repo today

Built in NooblyJS Phase 5 (the engine, its screens and the hosted-app contract) and wired to real teammate drafting,
Knowledge context and Platform routes in Phases 6, 8 and 9. The phase history is `docs/roadmap-history.md`; what is
still open is in `../nooblyjs-ai-host/.claude/steering/roadmap.md`, "Hosted apps: open work".
