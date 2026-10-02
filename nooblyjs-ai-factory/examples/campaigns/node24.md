# Upgrade to Node 24

This repository should run on Node 24 (the current LTS):

- add an `.nvmrc` containing `24`
- set `"engines": { "node": ">=24" }` in package.json
- run the tests on Node 24 and fix anything that fails
