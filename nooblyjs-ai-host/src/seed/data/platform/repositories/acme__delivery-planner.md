---
name: acme/delivery-planner
branch: main
team: delivery-squad
access: read
readCode: true
pushAgentBranches: false
openPrs: false
merge: false
indexKnowledge: true
stack: Python 3.13
notes: ''
build: { install: pip install -r requirements.txt, test: pytest, image: python-3.13 }
gates: ''
lastActivity: '5 d ago'
sampleData: true
---

Plans van routes and slot capacity per store. Agents may read it, not change it. Sample repository.
