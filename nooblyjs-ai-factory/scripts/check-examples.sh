#!/usr/bin/env bash
# Run every documented `factory run --script` example against a fresh demo repo, and check
# it still ends the way its phase doc says. Later phases add stations (review, repair,
# approval…) that older scripts don't know about; this catches that before a reader does.
#
#   npm run check:examples        (offline; scripted models; a few seconds per example)
#
# examples/examples.txt: <phase> <issue> <script> <extra flags, or -> <expected status>
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
while read -r phase issue script extra want; do
  [[ -z "$phase" || "$phase" == \#* ]] && continue
  tmp=$(mktemp -d)
  examples/make-demo-repo.sh "$tmp/calc" >/dev/null
  [[ "$extra" == "-" ]] && extra=""
  extra=${extra//=/ }
  got=$(FACTORY_HOME="$tmp/home" node bin/factory.js run "examples/issues/$issue" --repo "$tmp/calc" --script "examples/scripts/$script" $extra --allow-unsandboxed 2>&1 \
        | sed 's/\x1b\[[0-9;]*m//g' | grep -oE "^(delivered|gate_failed|changes_requested|needs_info|parked|agent_failed|no_changes|suggested|merged)\b|finished: error.*" | head -1)
  if [[ "$got" == "$want" ]]; then echo "✓ $phase $script → $got"; else echo "✗ $phase $script: wanted $want, got ${got:-nothing}"; fail=1; fi
  rm -rf "$tmp"
done < examples/examples.txt
exit $fail
