---
name: acme/stores-service
branch: main
access: read-prs
readCode: true
pushAgentBranches: true
openPrs: true
merge: false
indexKnowledge: true
stack: Java 21 · Spring Boot
notes: ''
build: { install: ./gradlew build -x test, test: ./gradlew test, image: temurin-21 }
gates: Unit · contract tests
lastActivity: 'yesterday'
sampleData: true
---

Stores, their opening hours and pickers. Sample repository.
