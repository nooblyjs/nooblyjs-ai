#!/usr/bin/env bash
# Make a tiny demo repository for trying the factory: `calc`, a Node project
# with a test suite and a .factory/config.json that declares one gate.
#
#   examples/make-demo-repo.sh /tmp/calc
set -euo pipefail
dir="${1:?usage: make-demo-repo.sh <folder>}"
mkdir -p "$dir/test" "$dir/.factory"
cd "$dir"
git init -q -b main

cat > package.json <<'JSON'
{ "name": "calc", "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > README.md <<'MD'
# calc

A tiny calculator library. Run the tests with `npm test`.
MD
cat > add.js <<'JS'
export const add = (a, b) => a + b;
JS
cat > test/add.test.js <<'JS'
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { add } from '../add.js';

test('add', () => assert.equal(add(2, 3), 5));
JS
cat > .factory/config.json <<'JSON'
{
  "gates": {
    "test": { "command": "node --test", "timeoutMs": 60000 }
  }
}
JSON

git add -A
git -c user.name=demo -c user.email=demo@example.com commit -qm "calc: add()"
echo "Demo repo ready: $dir"
