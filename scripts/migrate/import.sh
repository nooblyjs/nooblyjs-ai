#!/usr/bin/env bash
# Imports one EngX repo into this monorepo as a nooblyjs-ai project (migration-plan.md §6).
#
#   scripts/migrate/import.sh <engx-repo-dir> <project-dir> [<extra-exclude-file>]
#
# Copies the repo without runtime data or secrets (exclude.txt), moves its Kiro steering into .claude/steering (the
# EngX shared-rules copy is dropped: the host's `npm run steering:sync` writes .claude/steering/nooblyjs-ai.md),
# rebrands it (rebrand.mjs) and prints the company references left to resolve by hand. The project dir must not
# exist yet; node_modules is never copied.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:?engx repo dir}"
dest="${2:?project dir}"
[ -e "$dest" ] && { echo "$dest already exists" >&2; exit 1; }

extra=()
[ -n "${3:-}" ] && extra=(--exclude-from="$3")
rsync -a --exclude-from="$here/exclude.txt" "${extra[@]}" "$src/" "$dest/"
if [ -d "$dest/.kiro/steering" ]; then
  mkdir -p "$dest/.claude/steering"
  for f in "$dest/.kiro/steering/"*; do
    [ "$(basename "$f")" = engx.md ] && continue
    [ -e "$dest/.claude/steering/$(basename "$f")" ] && { echo "both .kiro and .claude have steering/$(basename "$f")" >&2; exit 1; }
    mv "$f" "$dest/.claude/steering/"
  done
fi
rm -rf "$dest/.kiro"
node "$here/rebrand.mjs" "$dest"
