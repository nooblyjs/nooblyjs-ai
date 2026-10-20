---
name: test-slots
kind: test
product: slots
designId: INF-031
designVersion: 1
status: live
deployedAt: "{{ago:2h}}"
deployed:
  - { service: api, version: 0.9.4 }
  - { service: web, version: 4.12.0 }
tests:
  - { suite: e2e, passed: 41, total: 42, failing: ["Slot hold expires while the customer is paying"] }
  - { suite: load, passed: 1, total: 1 }
costPerDay: 18
---
