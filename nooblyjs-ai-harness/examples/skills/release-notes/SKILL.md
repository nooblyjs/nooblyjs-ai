---
name: release-notes
description: Use when the user asks for release notes, a changelog entry, or "what changed" between versions or over recent commits
---
# Writing release notes

1. Find the range. If the user named versions or a number of commits, use that. Otherwise use the commits since the latest tag (`git describe --tags --abbrev=0`), or the last 10 commits if there are no tags.
2. Run `git log --no-merges --format="%h %s" <range>` and, for anything unclear, `git show --stat <hash>`.
3. Group the changes: **New**, **Improved**, **Fixed**, **Internal**. Leave out typo fixes and merge noise.
4. Write each item for a USER of the project: what they can do now, not which file changed.
5. Fill in `template.md` from this skill's folder (Read it). Show the result; don't write a file unless asked.

Details for this request, if any: $ARGUMENTS
