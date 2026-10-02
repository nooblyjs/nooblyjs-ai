// Shared test helpers.
import fs from 'node:fs';

export function readFixture(name) {
  return fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
}

/** Split bytes into random-sized chunks, the way a real network might deliver them. */
export async function* chunked(bytes, { seed = 1, maxChunk = 7 } = {}) {
  let state = seed;
  const random = () => ((state = (state * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < bytes.length; ) {
    const size = 1 + Math.floor(random() * maxChunk);
    yield bytes.subarray(i, i + size);
    i += size;
  }
}

export async function collect(asyncIterable) {
  const items = [];
  for await (const item of asyncIterable) items.push(item);
  return items;
}

/** A throwaway project folder with the given files: { 'src/a.js': 'text', ... }. Returns its real path. */
export async function makeProject(files = {}) {
  const { mkdtemp, mkdir, writeFile, realpath } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'noobly-test-')));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  return dir;
}

/** The context a tool receives, with a minimal fake session. */
export function toolContext(cwd) {
  return { cwd, session: { readFiles: new Map(), shellCwd: cwd } };
}
