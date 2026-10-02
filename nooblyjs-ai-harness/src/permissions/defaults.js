// Rules that apply unless you remove them. Deny beats allow.

export const DEFAULT_DENY = [
  // Secrets: never read or change these, even with read-only tools. (Read rules stop Grep too.)
  'Read(**/.env*)',
  'Edit(**/.env*)',
  'Write(**/.env*)',
  'Read(**/*.pem)',
  'Read(**/*.key)',
  'Read(**/id_rsa*)',
  'Read(**/id_ed25519*)',
  // Commands that destroy work and can't be undone. (Best effort: see canonicalCommand in rules.js.)
  'Bash(rm -rf:*)',
  'Bash(rm -fr:*)',
  'Bash(rm -Rf:*)',
  'Bash(rm -fR:*)',
  'Bash(git push --force:*)',
  'Bash(git push -f:*)',
];

export const DEFAULT_ALLOW = [
  // Harmless commands that only look at things.
  'Bash(pwd)',
  'Bash(ls:*)',
  'Bash(ps:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git branch)',
];
