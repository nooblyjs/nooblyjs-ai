# Start, stop and check NooblyJS

NooblyJS is one Node process that hosts every app. Its state is the `data/` folder.

## Start

```bash
npm start            # node --env-file-if-exists=.env app.js
```

Wait for the line `NooblyJS is listening`. Then check:

1. `GET /healthz` answers `{"status":"ok","version":"…"}` (no sign-in needed).
2. Sign in and open Home. The rail shows every app; one that failed to start says **Unavailable** (the log has
   `could not mount <package>` with the reason). NooblyJS runs without it.
3. Platform · Settings · Integrations shows what is connected, and whether Jira and Bitbucket are **Record only** or
   **Sending**.

## Stop

Stop the process (Ctrl+C, or your service manager's stop). NooblyJS finishes writes in progress: every file is written
whole (to a temporary name, then renamed), so stopping never leaves half a file. A Software Factory run that was in
flight keeps its last state in the Factory's log: open it in Factory · Runs after the start to see whether it went on
`[CONFIRM: not tested as part of Phase 13]`.

## After an unexpected stop

1. Start NooblyJS. Read the first lines of the log for a hosted app that did not mount.
2. Open Platform · Audit log: the last records before the stop are there.
3. If a file is reported unreadable (`Unreadable YAML stream …`), do not edit it by hand. Restore that folder from
   last night's backup into a new folder ([backup-restore.md](backup-restore.md)) and compare.

## Upgrade

1. `npm run backup` and note the name it prints.
2. Stop NooblyJS. Update the code in every repo (`nooblyjs-ai-host` and its siblings are released together). `npm install` in `nooblyjs-ai-host`
   (its postinstall also installs every sibling, nooblyjs-core first; `NOOBLY_SKIP_SIBLINGS=1` installs nooblyjs-ai-host only).
3. `npm test` (offline).
4. Start NooblyJS and do the three checks above.
5. To go back: stop, restore the backup into a new data folder, point `DATA_DIR` at it, and start the old version.
