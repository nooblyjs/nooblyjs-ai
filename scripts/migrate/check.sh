#!/usr/bin/env bash
# The grep gate for a migrated project (migration-plan.md §6 rule 4): no EngX or company names, no secrets.
#
#   scripts/migrate/check.sh <dir> [<dir>…]
#
# Exits 1 when anything is found. Lines that must stay go in scripts/migrate/allow.txt as `path:regex`.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
allow="$here/allow.txt"
status=0
for dir in "$@"; do
  hits=$(grep -rniE 'engx|shoprite|checkers|usave|work-repositories' "$dir" \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.temp --exclude=package-lock.json \
    --binary-files=without-match 2>/dev/null || true)
  if [ -f "$allow" ] && [ -n "$hits" ]; then
    while IFS=: read -r p re; do
      [ -z "$p" ] || [ "${p:0:1}" = "#" ] && continue
      hits=$(printf '%s\n' "$hits" | grep -vE "^[^:]*${p}:[0-9]+:.*${re}" || true)
    done < "$allow"
  fi
  secrets=$(find "$dir" -path '*/node_modules' -prune -o \( -name '.env' -o -name '*.key' -o -name '*.pem' -o -name '*.pfx' -o -name 'sessions.json' \) -print 2>/dev/null)
  if [ -n "$hits" ]; then echo "== $dir: brand/company references"; printf '%s\n' "$hits" | head -100; status=1; fi
  if [ -n "$secrets" ]; then echo "== $dir: secret-looking files"; printf '%s\n' "$secrets"; status=1; fi
  [ $status -eq 0 ] && echo "== $dir: clean"
done
exit $status
