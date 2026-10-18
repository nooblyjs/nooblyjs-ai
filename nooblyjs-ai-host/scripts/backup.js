// npm run backup               copies DATA_DIR to a new dated backup in BACKUP_DIR, with a manifest of every file's hash
// npm run backup -- --list     the backups there are
// npm run backup -- --verify <name>   checks a backup against its manifest
// NooblyJS can be running: each file is written whole (tmp + rename), so a copy never holds half a file.
import path from 'node:path';
import { loadConfig, ConfigError } from '../src/config.js';
import { createBackups, verifyBackup } from '../src/services/backup.js';

try {
  const config = loadConfig();
  const backups = createBackups({ dataDir: config.dataDir, backupDir: config.backup.dir, keep: config.backup.keep, log: console });
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    const all = await backups.list();
    if (!all.length) console.log(config.backup.dir ? `No backups in ${config.backup.dir}.` : 'BACKUP_DIR is not set.');
    for (const b of all) console.log(`${b.name}  ${b.createdAt}  ${b.files} files  ${(b.bytes / 1024 / 1024).toFixed(1)} MB  ${b.audit.records} audit records`);
  } else if (args.includes('--verify')) {
    const name = args[args.indexOf('--verify') + 1];
    if (!name) throw new ConfigError('Say which backup: npm run backup -- --verify noobly-20261011-020000');
    const r = await verifyBackup(path.isAbsolute(name) ? name : path.join(config.backup.dir, name));
    console.log(r.ok ? `${r.name} is intact: ${r.files} files, ${r.audit.records} audit records over ${r.audit.days} days.` : `${r.name} is DAMAGED:\n  ${r.problems.join('\n  ')}`);
    process.exitCode = r.ok ? 0 : 1;
  } else {
    const made = await backups.create();
    console.log(`Backed up ${config.dataDir} to ${made.path}: ${made.files} files, ${(made.bytes / 1024 / 1024).toFixed(1)} MB, ${made.audit.records} audit records over ${made.audit.days} days.`);
  }
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : `Backup failed: ${err.message}`);
  process.exitCode = 1;
}
