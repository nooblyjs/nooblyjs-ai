// @ts-check
// Phase F18: `factory notify …`
//
//   factory notify test    send a test message to every target in config "notify.targets"
//   factory notify once    send what's new since last time, now (for cron, when `factory serve` isn't running)
import { loadFactoryConfig } from '../config/factory-config.js';
import { createNotifier } from '../notify/notifier.js';
import { openStore } from '../store/events.js';

/** @param {string[]} argv */
export async function notifyCommand(argv) {
  const [sub] = argv;
  const targets = loadFactoryConfig().notify?.targets ?? [];
  if (!targets.length) throw new Error('No notification targets. Add "notify": { "targets": [{ "name": "team", "urlEnv": "SLACK_WEBHOOK_URL", "format": "slack" }] } to ~/.factory/config.json.');
  const store = openStore();
  try {
    const notifier = createNotifier({ store, targets, log: (l) => console.error(l) });
    if (sub === 'test') {
      for (const r of await notifier.test()) console.log(`${r.ok ? '✓' : '✗'} ${r.name}`);
      return 0;
    }
    if (sub === 'once') {
      const queued = notifier.poll();
      const sent = await notifier.flush({ force: true });
      console.log(`${queued} notification(s) in ${sent} message(s).`);
      return 0;
    }
    throw new Error('Usage: factory notify test | once');
  } finally {
    store.close();
  }
}
