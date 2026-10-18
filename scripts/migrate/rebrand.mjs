#!/usr/bin/env node
// Rebrands a folder copied from the EngX workspace, in place (migration-plan.md §4, the rename map).
//
//   node scripts/migrate/rebrand.mjs <dir> [--dry-run]
//
// Rewrites text files (CRLF → LF on the way), then renames files and folders whose names match. The rules
// were learned from the files that already exist on both sides (engx-core ↔ nooblyjs-core, the harness,
// factory, teammate and common pairs), so a rebranded file lines up with its existing nooblyjs twin.
// Company names (ShopriteX, Checkers…) are NOT replaced: they need a person to decide what goes in their
// place, so the script lists every remaining hit at the end.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APPS = 'common|harness|factory|product|infrastructure|knowledge|desktop';

/** Ordered: the specific names first, the bare word last. */
export const RULES = [
  // Packages and repositories. The AI module left core for its own project; core sits outside the monorepo.
  [/file:\.\.\/(?:engx|EngX)-core\/src\/aiservice\/common\b/g, 'file:../nooblyjs-ai-common'],
  [/(?:engx|EngX)-core\/src\/aiservice\/common(?:\/([\w-]+)\.js)?/g, (m, mod) => (mod ? `nooblyjs-ai-common/${mod === 'index' ? '' : mod}`.replace(/\/$/, '') : 'nooblyjs-ai-common')],
  [/file:\.\.\/(?:engx|EngX)-core\b/g, 'file:../../nooblyjs-core'],
  [/(?<![A-Za-z0-9])(?:engx|EngX)-ai-teammates?\b/g, 'nooblyjs-ai-teammate'],
  [new RegExp(`(?<![A-Za-z0-9])(?:engx|EngX)-ai-(${APPS})\\b`, 'g'), 'nooblyjs-ai-$1'],
  [/(?<![A-Za-z0-9])(?:engx|EngX)-learn-(harness|factory)\b/g, 'nooblyjs-learn-$1'],
  [/(?<![A-Za-z0-9])(?:engx|EngX)-core\b/g, 'nooblyjs-core'],
  [/\bengx-workflows\b/g, 'nooblyjs-ai-workflows'],
  [/\.\.\/engx(?![\w.-])/g, '../nooblyjs-ai-host'],
  [/\.\.\\engx(?![\w.-])/g, '..\\nooblyjs-ai-host'],
  [/bitbucket\.org\/shopritelabs\//g, 'bitbucket.org/acme/'],
  [/\bEngX\/(?=[\w-])/g, 'nooblyjs/'],
  [/C:\\work-repositories\\/g, '<workspace>/'],
  [/C:\/work-repositories\//g, '<workspace>/'],
  [/\/c\/work-repositories\//g, '<workspace>/'],
  // Steering: Kiro's folders become Claude's; the shared-rules copy gets the suite's name.
  [/\.kiro\/steering\/engx\.md\b/g, '.claude/steering/nooblyjs-ai.md'],
  [/\bengx-shared-rules\b/g, 'nooblyjs-ai-shared-rules'],
  [/\.kiro\//g, '.claude/'],
  [/\.kiro\b/g, '.claude'],
  // The harness's project memory file (like CLAUDE.md).
  [/\bengx\.md\b/g, 'NOOBLY.md'],
  // Environment variables.
  [/\bEngX_API_KEYS\b/g, 'NOOBLYJS_API_KEYS'],
  [/\bENGX_/g, 'NOOBLY_'],
  [/\bengx_(?=[A-Z])/g, 'NOOBLY_'],
  // nooblyjs-core's browser globals: NooblyJSNavigation, but nooblyjsCaching, nooblyjslogging…
  [/\bEngXNavigation\b/g, 'NooblyJSNavigation'],
  [/\bEngX-(?=[a-z])/g, 'nooblyjs-'],
  [/\bEngX(?=[A-Za-z])/g, 'nooblyjs'],
  // The words ("an EngX app" needs its article changed too).
  [/\b([Aa])n EngX\b/g, '$1 NooblyJS'],
  [/\bEngX AI projects\b/g, 'nooblyjs AI projects'],
  [/\bengx(?=: '1')/g, 'NOOBLY'],
  [/EngX/g, 'NooblyJS'],
  [/ENGX/g, 'NOOBLY'],
  [/Engx/g, 'Noobly'],
  [/engx/g, 'noobly'],
  // The company becomes a fictional one: Acme Retail, its repositories acme/<repo>, its sites under acme.example.
  [/ShopriteX's engineering([- ])lifecycle/g, 'an engineering$1lifecycle'],
  [/@shoprite\.co\.za\b/g, '@acme.example'],
  [/\bshoprite(?:x)?\.(atlassian\.net|tpondemand\.com)/g, 'acme.$1'],
  [/\bshopritex\.example\b/g, 'acme.example'],
  [/\b(?:shopritex|shopritelabs|shoprite-x)(?=[\\/_.:;'"`\s$-]|$)/gm, 'acme'],
  [/\bShopriteX\b/g, 'Acme Retail'],
  [/\bShoprite Checkers\b/g, 'Acme Retail'],
  [/\bShoprite Group\b/g, 'Acme Retail Group'],
  [/\bShoprite(?='s\b)/g, 'Acme'],
  [/\bShoprite\b/g, 'Acme'],
  [/\bSHOPRITE\b/g, 'ACME'],
  [/\bSixty60\b/g, 'Acme Express'],
];

// Case-insensitive names, plus the Checkers brand with its capital ("checkers" is also an ordinary word).
const COMPANY = /shoprite|usave|sixty60|work-repositories|\bCheckers\b/g;
const COMPANY_CI = /shoprite|usave|sixty60|work-repositories/i;
const BINARY = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|mp4|mp3|wasm|node|sqlite|db|docx|xlsx|pptx)$/i;

export function rebrandText(text) {
  let out = text.replace(/\r\n/g, '\n');
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}

function walk(dir, files = [], dirs = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(p, files, dirs); dirs.push(p); } else if (ent.isFile()) files.push(p);
  }
  return { files, dirs };
}

function isText(file) {
  if (BINARY.test(file)) return false;
  const buf = fs.readFileSync(file);
  return !buf.subarray(0, 8000).includes(0);
}

function main() {
  const [dir, ...flags] = process.argv.slice(2);
  if (!dir) { console.error('Usage: node scripts/migrate/rebrand.mjs <dir> [--dry-run]'); process.exit(2); }
  const dry = flags.includes('--dry-run');
  const root = path.resolve(dir);
  const { files, dirs } = walk(root);
  let changed = 0;
  const company = [];
  for (const file of files) {
    if (!isText(file)) continue;
    const before = fs.readFileSync(file, 'utf8');
    const after = rebrandText(before);
    if (after !== before) { changed++; if (!dry) fs.writeFileSync(file, after); }
    after.split('\n').forEach((line, i) => {
      if (COMPANY.test(line) || COMPANY_CI.test(line)) company.push(`${path.relative(root, file)}:${i + 1}: ${line.trim().slice(0, 140)}`);
      COMPANY.lastIndex = 0;
    });
  }
  // Rename deepest first, so a parent's rename never invalidates a child path.
  const renames = [...files, ...dirs]
    .sort((a, b) => b.length - a.length)
    .map((p) => [p, path.join(path.dirname(p), rebrandText(path.basename(p)))])
    .filter(([from, to]) => from !== to);
  for (const [from, to] of renames) {
    if (!dry) {
      if (fs.existsSync(to)) throw new Error(`rename target exists: ${to}`);
      fs.renameSync(from, to);
    }
  }
  console.log(`${dry ? '[dry run] ' : ''}${changed} files rewritten, ${renames.length} paths renamed in ${root}`);
  for (const [from, to] of renames) console.log(`  rename ${path.relative(root, from)} -> ${path.basename(to)}`);
  console.log(`${company.length} company references left to resolve by hand${company.length ? ':' : ''}`);
  for (const line of company.slice(0, 200)) console.log(`  ${line}`);
  if (company.length > 200) console.log(`  … and ${company.length - 200} more`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
