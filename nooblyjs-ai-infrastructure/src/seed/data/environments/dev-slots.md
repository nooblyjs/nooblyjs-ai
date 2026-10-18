---
name: dev-slots
kind: dev
product: slots
designId: INF-031
designVersion: 2
status: live
deployedAt: "{{ago:35m}}"
deployed:
  - { service: api, version: 0.9.4 }
  - { service: web, version: 4.12.0 }
tests:
  - { suite: smoke, passed: 12, total: 12 }
costPerDay: 9
# What the provisioner last saw that differs from the design (the drift check compares these).
observed:
  redis-cache: { maxmemory: 512mb }
---
