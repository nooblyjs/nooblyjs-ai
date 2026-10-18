// Builds the NooblyJS Teams app package (the zip Teams installs): appPackage/build/appPackage.<env>.zip.
//
//   node scripts/package.mjs [--env local|dev]      from apps/msteams/noobly-bot (npm run package -- --env dev)
//
// It does what the Agents Toolkit's teamsApp/zipAppPackage step does, without the CLI or a sign-in: fills the
// manifest's ${{NAME}} values from env/.env.<env> and env/.env.<env>.user (the process environment wins), checks
// what Teams checks on upload, and writes the manifest and both icons into a zip. Nothing is sent anywhere.
// With no TEAMS_APP_ID yet, a new one is made and saved to env/.env.<env>, so the app keeps its id.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'appPackage');
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const args = process.argv.slice(2);
const envName = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'local';
if (!/^[a-z0-9-]+$/.test(envName ?? '')) fail(`"${envName}" is not an environment name (local, dev, …).`);

function fail(message, details = []) {
  console.error(`Not packaged: ${message}`);
  for (const d of details) console.error(`  - ${d}`);
  process.exit(1);
}

// ---------- values ----------
const envFile = path.join(ROOT, 'env', `.env.${envName}`);
if (!fs.existsSync(envFile)) fail(`there is no env/.env.${envName}.`);
const read = (file) => (fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {});
const values = { ...read(envFile), ...read(`${envFile}.user`) };
for (const [k, v] of Object.entries(process.env)) if (k in values || /^(TEAMS_APP_ID|BOT_ID|NOOBLY_PUBLIC_URL|APP_NAME_SUFFIX)$/.test(k)) values[k] = v;

/** Sets NAME=value in the env file, keeping its comments and order. */
function save(name, value) {
  const text = fs.readFileSync(envFile, 'utf8');
  const line = new RegExp(`^${name}=.*$`, 'm');
  fs.writeFileSync(envFile, line.test(text) ? text.replace(line, `${name}=${value}`) : `${text.replace(/\s*$/, '\n')}${name}=${value}\n`);
}
if (!values.TEAMS_APP_ID) {
  values.TEAMS_APP_ID = crypto.randomUUID();
  save('TEAMS_APP_ID', values.TEAMS_APP_ID);
  console.log(`New Teams app id ${values.TEAMS_APP_ID}, saved to env/.env.${envName}.`);
}

// ---------- the manifest ----------
const template = fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8');
const missing = new Set();
const filled = template.replace(/\$\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (m, name) => {
  if (values[name] === undefined || (values[name] === '' && name !== 'APP_NAME_SUFFIX')) missing.add(name);
  return String(values[name] ?? '').replace(/["\\]/g, (c) => `\\${c}`);
});
if (missing.size) {
  const help = {
    BOT_ID: 'the bot\'s Microsoft Entra app (client) id. Make one with Provision in the Agents Toolkit, or in the Teams Developer Portal (Tools → Bot management → New bot), and put it in the env file.',
    NOOBLY_PUBLIC_URL: 'the https address people open NooblyJS at, e.g. https://noobly.example.com',
  };
  fail(`env/.env.${envName} has no value for ${[...missing].join(', ')}.`, [...missing].map((n) => `${n}: ${help[n] ?? 'set it in the env file'}`));
}
let manifest;
try {
  manifest = JSON.parse(filled);
} catch (err) {
  fail(`the filled manifest is not JSON (${err.message}).`);
}

// ---------- what Teams checks on upload ----------
function pngInfo(file) {
  const b = fs.readFileSync(file);
  if (b.length < 26 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}
const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };
check(GUID.test(manifest.id), `id must be a GUID, not "${manifest.id}"`);
check(/^\d+\.\d+\.\d+$/.test(manifest.version), 'version must be major.minor.patch');
check(manifest.name.short.length <= 30, `name.short is ${manifest.name.short.length} characters (30 at most)`);
check(manifest.name.full.length <= 100, `name.full is ${manifest.name.full.length} characters (100 at most)`);
check(manifest.description.short.length <= 80, `description.short is ${manifest.description.short.length} characters (80 at most)`);
check(manifest.description.full.length <= 4000, `description.full is ${manifest.description.full.length} characters (4000 at most)`);
check(/^#[0-9A-F]{6}$/i.test(manifest.accentColor), 'accentColor must be #RRGGBB');
for (const key of ['websiteUrl', 'privacyUrl', 'termsOfUseUrl']) check(/^https:\/\/[^\s]+$/.test(manifest.developer[key]), `developer.${key} must be an https address, not "${manifest.developer[key]}"`);
for (const bot of manifest.bots ?? []) {
  check(GUID.test(bot.botId), `bots[].botId must be a GUID, not "${bot.botId}"`);
  for (const list of bot.commandLists ?? []) {
    check(list.commands.length <= 10, 'a command list has at most 10 commands');
    for (const c of list.commands) {
      check(c.title.length <= 32, `command "${c.title}" is longer than 32 characters`);
      check(c.description.length <= 128, `the description of "${c.title}" is longer than 128 characters`);
    }
  }
}
const color = pngInfo(path.join(APP, manifest.icons.color));
const outline = pngInfo(path.join(APP, manifest.icons.outline));
check(color && color.width === 192 && color.height === 192, 'the colour icon must be a 192 x 192 PNG');
check(outline && outline.width === 32 && outline.height === 32, 'the outline icon must be a 32 x 32 PNG');
check(outline && (outline.colorType === 6 || outline.colorType === 4), 'the outline icon needs a transparent background (a PNG with alpha)');
if (problems.length) fail('the manifest breaks rules Teams checks on upload.', problems);

// ---------- the zip (no dependencies: stored with deflate, central directory at the end) ----------
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dos = (() => {
    const d = new Date();
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  })();
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dos.time, 10); local.writeUInt16LE(dos.date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dos.time, 12); central.writeUInt16LE(dos.date, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const build = path.join(APP, 'build');
fs.mkdirSync(build, { recursive: true });
const manifestText = `${JSON.stringify(manifest, null, 4)}\n`;
fs.writeFileSync(path.join(build, `manifest.${envName}.json`), manifestText);
const out = path.join(build, `appPackage.${envName}.zip`);
fs.writeFileSync(out, zip([
  { name: 'manifest.json', data: Buffer.from(manifestText, 'utf8') },
  { name: manifest.icons.color, data: fs.readFileSync(path.join(APP, manifest.icons.color)) },
  { name: manifest.icons.outline, data: fs.readFileSync(path.join(APP, manifest.icons.outline)) },
]));
console.log(`Packaged ${manifest.name.short} ${manifest.version} (app ${manifest.id}, bot ${manifest.bots[0].botId}): ${path.relative(ROOT, out)}`);
