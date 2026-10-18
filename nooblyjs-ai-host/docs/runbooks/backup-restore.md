# Back up and restore

NooblyJS keeps everything in files under `DATA_DIR`. A backup is a dated copy with a manifest of every file's size and
SHA-256 hash and the number of audit records per day.

## Settings

| Setting | Meaning |
| --- | --- |
| `BACKUP_DIR` | Where backups go. Never inside `DATA_DIR` (NooblyJS refuses). Put it on another disk |
| `BACKUP_KEEP` | How many to keep (14). The oldest are removed after each new one |
| `BACKUP_HOUR` | The hour of the nightly backup, local time (2) |

With `BACKUP_DIR` set, a running NooblyJS makes one backup a night (audit action `backup.created`). NooblyJS can keep
running while a backup is made.

**A backup holds people's names, the audit log and the sign-in store.** Protect `BACKUP_DIR` as carefully as `data/`.
It leaves out logs, the Software Factory's workspaces and caches, and files that hold a secret made at start.

## Make one now, list them, check one

```bash
npm run backup                                      # prints the name, e.g. noobly-20261011-020000
npm run backup -- --list
npm run backup -- --verify noobly-20261011-020000     # every file against the manifest; exit 1 if damaged
```

## Restore

A restore **never overwrites**. It goes into an empty folder.

1. Stop NooblyJS.
2. Move the current data folder away (keep it until you are sure): `mv data data.before-restore`
3. `npm run restore -- noobly-20261011-020000`
   It verifies the backup first, copies it, then verifies the restored folder: every hash, and the audit log's
   records per day. It prints `every hash matches, and the audit log holds its N records over D days`.
   If it says the backup is **damaged**, nothing was restored: use an older one.
4. Start NooblyJS. Sign in, open an item you know and Platform · Audit log.
5. What happened after that backup was taken is not in it. Jira and Bitbucket keep their own history: press **Read
   Jira and Bitbucket now** on an item to bring statuses and pull requests back in step.

To look inside a backup without touching the live folder: `npm run restore -- noobly-20261011-020000 --into ../noobly-look`.

## Test it (do this before a pilot, and each quarter)

`node --test test/backup.test.js` does the whole thing on a temporary folder: use NooblyJS, back up, restore into an
empty folder, start NooblyJS on it, and compare an item and the audit log.
