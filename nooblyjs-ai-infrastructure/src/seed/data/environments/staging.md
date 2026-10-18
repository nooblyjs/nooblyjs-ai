---
name: staging
kind: staging
note: "Shared · production-sized"
designId: INF-031
designVersion: 1
status: live
deployedAt: "{{ago:3d}}"
deployed:
  - { service: api, version: 0.9.2 }
  - { service: web, version: 4.11.8 }
tests: []
testsNote: "Load test 18:00"
next: "Load test tonight 18:00"
costPerDay: 41
---
