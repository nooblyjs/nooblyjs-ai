// npm run seed                    writes the seed files that are missing from DATA_DIR (system files and the sample story)
// npm run seed -- --reset         wipes DATA_DIR first, then writes the whole seed
// npm run seed:blank              a data folder with NO sample content: system files only (roles, work roles, budgets,
//                                 guardrails, model routes, approval rules). No people, teams, items or history.
//   -- --owner you@example.com    the first Owner, so someone can sign in and set the rest up (--name "Your Name")
//   -- --reset                    DATA_DIR already has something in it: move it aside (never deleted), then start blank
// npm run seed:clear              deletes everything in DATA_DIR (the sample story and anything made since), then
//                                 starts blank as seed:blank does (--blank --delete). Takes --owner and --name too.
// Stop NooblyJS first. Sign-in accounts are created the next time NooblyJS starts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadConfig, ConfigError } from '../src/config.js';
import { seedFiles, isEmptyDir } from '../src/seed/index.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');
const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null; };

/** The first Owner's person record, so a blank NooblyJS has someone who can sign in and invite the others. */
async function writeOwner(store, email, name) {
  const address = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new ConfigError(`"${email}" is not an email address.`);
  const id = address.split('@')[0].replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  if (!id) throw new ConfigError(`An id could not be made from "${email}".`);
  const display = String(name ?? '').replace(/[\r\n]+/g, ' ').trim() || address.split('@')[0];
  await store.writeDoc(['people', id, 'PERSON.md'], { id, name: display, email: address, accessRole: 'Owner', active: true }, '\nThe first Owner, made by npm run seed:blank.\n');
  return { id, name: display, email: address };
}

try {
  const config = loadConfig();
  const reset = args.includes('--reset');
  const blank = args.includes('--blank');
  const remove = args.includes('--delete');
  await fs.mkdir(config.dataDir, { recursive: true });

  if (!blank) {
    const written = await seedFiles(new FsStore(config.dataDir), { reset });
    console.log(`${reset ? 'Wiped and re-seeded' : 'Seeded'} ${config.dataDir}: ${written.length} file${written.length === 1 ? '' : 's'} written.`);
  } else {
    if (!remove && !(await isEmptyDir(config.dataDir))) {
      if (!reset) {
        throw new ConfigError(`${config.dataDir} is not empty. To start blank, stop NooblyJS and run: npm run seed:blank -- --reset\n(the folder is moved aside, not deleted), npm run seed:clear (it is deleted), or point DATA_DIR at a new folder.`);
      }
      // Without --delete, never deleted: the whole folder is moved next to itself, with the time in its name.
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const aside = `${config.dataDir}.before-blank-${stamp}`;
      try {
        await fs.rename(config.dataDir, aside);
      } catch (err) {
        throw new ConfigError(`${config.dataDir} could not be moved aside (${err.code ?? err.message}). Stop NooblyJS and anything else that has it open, then try again. Nothing was changed.`);
      }
      await fs.mkdir(config.dataDir, { recursive: true });
      console.log(`Moved what was there to ${aside}.`);
    }
    const store = new FsStore(config.dataDir);
    // --delete (npm run seed:clear): seedFiles' reset empties the folder first, keeping the folder itself.
    const written = await seedFiles(store, { content: false, reset: remove });
    if (remove) console.log(`Deleted everything that was in ${config.dataDir}.`);
    console.log(`Blank data folder ${config.dataDir}: ${written.length} system files, no sample content.`);
    for (const f of written) console.log(`  ${f}`);
    const owner = value('--owner');
    if (owner) {
      const person = await writeOwner(store, owner, value('--name'));
      console.log(`First Owner: ${person.name} <${person.email}> (people/${person.id}/PERSON.md).`);
    } else {
      console.log('No Owner yet. With Microsoft sign-in, put your email in NOOBLY_OWNERS so your first sign-in makes you one;\nor run again with: npm run seed:blank -- --reset --owner you@example.com --name "Your Name"');
    }
    console.log('Each app writes its own system files into its folder the first time NooblyJS starts. Start it with: npm start');
  }
} catch (err) {
  console.error(err instanceof ConfigError ? `Refused: ${err.message}` : err);
  process.exit(1);
}
