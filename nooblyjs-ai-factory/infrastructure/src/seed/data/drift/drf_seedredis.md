---
id: drf_seedredis
environment: dev-slots
designId: INF-031
resource: redis-cache
resourceName: Redis
setting: maxmemory
expected: 1gb
actual: 512mb
summary: Redis maxmemory changed by hand
short: Drift on Redis config
detail: Redis maxmemory was changed by hand and no longer matches design INF-031.
status: open
foundAt: "{{ago:3h}}"
---
