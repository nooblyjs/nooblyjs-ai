---
name: acme/web-storefront
branch: main
access: read-prs
readCode: true
pushAgentBranches: true
openPrs: true
merge: false
indexKnowledge: true
stack: Node 22 · Next.js
notes: ''
build: { install: npm ci, test: npm test, image: node-22:22.11 }
gates: Lint · unit · e2e · axe
lastActivity: 'PR #481 · 38 min ago'
sampleData: true
---

The customer web shop: basket, checkout and the slot picker. Sample repository.
