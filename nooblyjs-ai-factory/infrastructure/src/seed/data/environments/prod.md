---
name: prod
kind: production
note: Changes only through a release
status: live
deployedAt: "{{ago:6d}}"
deployed:
  - { service: web, version: 4.11.2 }
tests: []
testsNote: Synthetic checks passing
testsTone: success
---
