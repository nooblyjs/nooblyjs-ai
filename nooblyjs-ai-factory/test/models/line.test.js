// Phase F07: a line is data. Checking one, and loading the built-in lines.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadLine, parseLine } from '../../src/models/line.js';
import { KINDS } from '../../src/services/line/executor.js';
import { tmpDir } from '../helpers.js';

const kinds = ['triage', 'build', 'verify', 'deliver'];

test('parseLine: stations with defaults, and a `when` compiled to a function', () => {
  const line = parseLine({ name: 'mini', stations: [{ id: 'triage', kind: 'triage' }, { id: 'build', kind: 'build', retries: 2, when: 'triage.clear' }] }, kinds);
  assert.equal(line.name, 'mini');
  assert.deepEqual(line.stations.map((s) => [s.id, s.kind, s.retries, s.optional]), [['triage', 'triage', 0, false], ['build', 'build', 2, false]]);
  assert.equal(typeof line.stations[1].applies, 'function');
  assert.equal(line.stations[0].applies({}), true, 'no `when` → always');
});

test('parseLine: every problem is listed at once', () => {
  const raw = { stations: [{ id: 'a', kind: 'build' }, { id: 'a', kind: 'paint' }, { kind: 'verify' }] };
  assert.throws(() => parseLine(raw, kinds, 'my-line.json'), (e) => {
    for (const bit of ['my-line.json is not a valid line', '"name" is missing', 'the id "a" is used twice', 'unknown kind "paint"', 'station 3: "id" is missing']) assert.ok(e.message.includes(bit), `mentions: ${bit}`);
    return true;
  });
  assert.throws(() => parseLine({ name: 'empty', stations: [] }, kinds), /non-empty list/);
  assert.throws(() => parseLine({ name: 'bad-when', stations: [{ id: 'b', kind: 'build', when: '((' }] }, kinds), /station 1 \("b"\)/);
});

test('loadLine: the built-in lines load with the real station kinds', () => {
  for (const name of ['default', 'quick']) {
    const line = loadLine(name, KINDS());
    assert.equal(line.name, name);
    assert.ok(line.stations.length > 0);
  }
});

test('loadLine: a .json path, or an error that lists the built-in lines', () => {
  const file = path.join(tmpDir(), 'mine.json');
  fs.writeFileSync(file, JSON.stringify({ name: 'mine', stations: [{ id: 'build', kind: 'build' }] }));
  assert.equal(loadLine(file, KINDS()).name, 'mine');
  assert.throws(() => loadLine('nope', KINDS()), /No line "nope"\. Built in: .*default.*quick/);
});
