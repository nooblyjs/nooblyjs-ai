// config/seed-data.js: the mockup seed story hangs together before it is written to a workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, SETTINGS, SKILLS, TEAMMATES, SCHEDULES, AUTOMATION } from '../../src/config/seed-data.js';
import { slugify } from '../../src/utils/ids.js';

const slugs = TEAMMATES.map((t) => slugify(t.name));

test("the roster is the mockup's eight teammates and Rhea Voss, each with a unique name", () => {
  assert.equal(TEAMMATES.length, 9);
  assert.equal(new Set(slugs).size, 9);
  assert.ok(slugs.includes('ada-quill'));
  // The PRD-031 story's architect (NooblyJS Phase 6), billed to the NooblyJS team she works for.
  const rhea = TEAMMATES.find((t) => t.name === 'Rhea Voss');
  assert.deepEqual([rhea.role, rhea.rate, rhea.costCentre], ['Architect', 52, 'Delivery squad']);
  assert.ok(TEAMMATES.find((t) => t.name === 'Ada Quill').skills.some((s) => s.name === 'Spec drafting'));
});

test('every teammate uses a known model and skills from the library', () => {
  const library = new Set(SKILLS.map((s) => s.name));
  for (const t of TEAMMATES) {
    assert.ok(MODELS.models[t.model], `${t.name}: model ${t.model}`);
    assert.ok(t.rate > 0, `${t.name}: rate`);
    for (const s of t.skills) {
      assert.ok(library.has(s.name), `${t.name}: skill ${s.name}`);
      assert.ok([1, 2, 3].includes(s.level), `${t.name}: ${s.name} level`);
    }
  }
  assert.ok(MODELS.models[MODELS.reflection], 'the reflection model exists');
});

test('automation and schedules only name seeded teammates', () => {
  for (const [id, a] of Object.entries(AUTOMATION)) {
    assert.ok(slugs.includes(id), id);
    for (const to of a.delegatesTo ?? []) assert.ok(slugs.includes(to), to);
  }
  for (const s of SCHEDULES) assert.ok(slugs.includes(s.teammate), s.teammate);
});

test('every teammate is billed to a cost centre in the settings, which include the NooblyJS teams', () => {
  for (const t of TEAMMATES) assert.ok(SETTINGS.costCentres.includes(t.costCentre), `${t.name}: ${t.costCentre}`);
  for (const team of ['Delivery squad', 'Checkout squad', 'Platform team']) assert.ok(SETTINGS.costCentres.includes(team), team);
});
