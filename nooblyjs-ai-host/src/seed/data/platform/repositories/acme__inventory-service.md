---
name: acme/inventory-service
branch: main
team: platform-team
access: read
readCode: true
pushAgentBranches: false
openPrs: false
merge: false
indexKnowledge: false
stack: Java 21 · Spring Boot
notes: ''
build: { install: ./gradlew build -x test, test: ./gradlew test, image: temurin-21 }
gates: ''
lastActivity: '2 w ago'
sampleData: true
---

Stock levels per store. Read only, not indexed. Sample repository.
