---
name: acme/mobile-app
branch: main
team: checkout-squad
access: read-prs
readCode: true
pushAgentBranches: true
openPrs: true
merge: false
indexKnowledge: false
stack: React Native
notes: ''
build: { install: npm ci, test: npm test, image: node-22:22.11 }
gates: Lint · unit
lastActivity: '3 d ago'
sampleData: true
---

The customer app. Not indexed into Knowledge yet. Sample repository.
