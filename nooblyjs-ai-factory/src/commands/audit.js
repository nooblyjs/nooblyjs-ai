// @ts-check
// Phase F24: `factory audit export [--since 30d] [--out audit.jsonl]` · `factory audit verify audit.jsonl`
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { exportAudit, verifyAudit } from '../security/audit.js';
import { openStore } from '../store/events.js';

/** @param {string[]} argv */
export async function auditCommand(argv) {
  const [sub, ...rest] = argv;
  if (sub === 'verify') {
    if (!rest[0]) throw new Error('Usage: factory audit verify <audit.jsonl>');
    const lines = fs.readFileSync(rest[0], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const r = verifyAudit(lines);
    console.log(r.ok ? `✓ ${r.lines} line(s), the chain is intact (last hash ${r.last.slice(0, 16)}…)` : `✗ line ${r.line}: ${r.why}`);
    return r.ok ? 0 : 1;
  }
  if (sub !== 'export') throw new Error('Usage: factory audit export [--since 30d] [--out file] | factory audit verify <file>');
  const { values } = parseArgs({ args: rest, options: { since: { type: 'string' }, out: { type: 'string' } } });
  const store = openStore();
  try {
    const lines = exportAudit(store, { since: values.since ?? '30d' });
    const text = lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : '');
    if (values.out) {
      fs.writeFileSync(values.out, text);
      console.log(`${lines.length} event(s) → ${values.out}`);
    } else process.stdout.write(text);
    return 0;
  } finally {
    store.close();
  }
}
