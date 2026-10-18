#!/usr/bin/env node
// Applies the FUNCTIONAL changes from an EngX file onto its existing nooblyjs twin (migration-plan.md M1).
//
//   node scripts/migrate/merge-hunks.mjs <engx-file> <nooblyjs-file> [--dry-run]
//
// The EngX file is rebranded first. Then every differing hunk is applied unless it only touches branding
// (logo paths, @author lines, the product name's spelling): those keep the nooblyjs side. Line endings of
// the nooblyjs file are kept.
import fs from 'node:fs';
import { rebrandText } from './rebrand.mjs';

const BRANDING = /logo|@author|NooblyJS|nooblyjs|NOOBLY|ENG<sup>|Noobly/i;

function lcsOps(a, b) {
  // Myers-free simple LCS table; files here are a few thousand lines at most.
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hunks = []; let i = 0, j = 0, cur = null;
  const flush = () => { if (cur) { hunks.push(cur); cur = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); hunks.push({ same: a[i] }); i++; j++; }
    else {
      cur ??= { del: [], add: [] };
      if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) cur.add.push(b[j++]); else cur.del.push(a[i++]);
    }
  }
  flush();
  return hunks;
}

const [engxFile, nbFile, flag] = process.argv.slice(2);
const raw = fs.readFileSync(nbFile, 'utf8');
const crlf = raw.includes('\r\n');
const ours = raw.replace(/\r\n/g, '\n').split('\n');
const theirs = rebrandText(fs.readFileSync(engxFile, 'utf8')).split('\n');
const out = []; let applied = 0, kept = 0;
for (const h of lcsOps(ours, theirs)) {
  if ('same' in h) { out.push(h.same); continue; }
  const branding = [...h.del, ...h.add].every((l) => BRANDING.test(l) || l.trim() === '') && h.del.length > 0;
  if (branding) { out.push(...h.del); kept++; } else { out.push(...h.add); applied++; }
}
const text = out.join('\n');
if (flag !== '--dry-run') fs.writeFileSync(nbFile, crlf ? text.replace(/\n/g, '\r\n') : text);
console.log(`${nbFile}: ${applied} hunks applied, ${kept} branding hunks kept as is`);
