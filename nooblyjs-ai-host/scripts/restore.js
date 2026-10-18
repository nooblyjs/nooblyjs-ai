// npm run restore -- <backup>               restores a backup into DATA_DIR, which must be empty or not there
// npm run restore -- <backup> --into <dir>  restores into another folder (to look at one without touching DATA_DIR)
// <backup> is a name in BACKUP_DIR (noobly-20261011-020000) or a path. Stop NooblyJS first. A restore never overwrites:
// to go back to a backup, move the current data folder away, restore, then start NooblyJS.
import path from 'node:path';
import { loadConfig, ConfigError } from '../src/config.js';
import { restoreBackup } from '../src/services/backup.js';

try {
  const config = loadConfig();
  const args = process.argv.slice(2);
  const into = args.includes('--into') ? args[args.indexOf('--into') + 1] : null;
  const name = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--into');
  if (!name) throw new ConfigError('Say which backup: npm run restore -- noobly-20261011-020000   (npm run backup -- --list shows them)');
  const source = path.isAbsolute(name) || name.includes(path.sep) || name.includes('/') ? path.resolve(name) : path.join(config.backup.dir || '.', name);
  const target = into ? path.resolve(into) : config.dataDir;
  const r = await restoreBackup(source, target);
  if (r.ok) console.log(`Restored ${r.name} (taken ${r.createdAt}) into ${r.restoredTo}: ${r.files} files, every hash matches, and the audit log holds its ${r.audit.records} records over ${r.audit.days} days.`);
  else console.error(`Restored into ${r.restoredTo}, but it does NOT match the backup:\n  ${r.problems.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : `Not restored: ${err.message}`);
  process.exitCode = 1;
}
