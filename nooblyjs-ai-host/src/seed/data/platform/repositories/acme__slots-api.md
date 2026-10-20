---
name: acme/slots-api
branch: main
team: delivery-squad
access: read-prs
readCode: true
pushAgentBranches: true
openPrs: true
merge: false
indexKnowledge: true
stack: Node 22 · Fastify · Postgres
notes: ''
build: { install: npm ci, test: npm test, image: node-22:22.11 }
gates: Lint · unit · contract tests
lastActivity: 'PR #482 · 2 h ago'
sampleData: true
---

The Slot API: availability, holds and their release. Sample repository of the PRD-031 story.
