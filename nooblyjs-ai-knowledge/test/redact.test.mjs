// NooblyJS Phase 8: personal data is redacted on the way in (src/wiki/knowledge/redact.js). Pure, so it is tested alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { redact, isTextFile } = require('../src/wiki/knowledge/redact.js');

test('emails, phone numbers and ID numbers are replaced, and counted', () => {
  const { text, counts, total } = redact([
    'Call Thandi on 082 555 0142 or +27 21 555 0199, or (021) 555-0100.',
    'Write to thandi.m@example.co.za, or ops+slots@acme.example.',
    'ID 8001015009087 was on the ticket. International: +442079460958.',
  ].join('\n'));
  assert.equal(text, [
    'Call Thandi on [REDACTED PHONE] or [REDACTED PHONE], or [REDACTED PHONE].',
    'Write to [REDACTED EMAIL], or [REDACTED EMAIL].',
    'ID [REDACTED ID] was on the ticket. International: [REDACTED PHONE].',
  ].join('\n'));
  assert.deepEqual(counts, { id: 1, email: 2, phone: 4 });
  assert.equal(total, 7);
});

test('what is not personal data is left alone: dates, versions, amounts, counts, codes', () => {
  const kept = [
    'Reviewed on 2026-10-10, next review 2027-01-15.',
    'Node 22.11.0 and API v2.3.1. Budget 400 000 rand, 412 tickets, 18 240 documents.',
    'Capacity is 120 picks per hour, 20% headroom, p95 300 ms. PRD-031, ADR-014, PR #455.',
    'Slots 14:00-15:00 and 15:00-16:00. Order 1234567 shipped. Ratio 0.355.',
    'See https://example.org/a/b?id=42 and store 4417.',
  ].join('\n');
  const { text, total } = redact(kept);
  assert.equal(text, kept);
  assert.equal(total, 0);
});

test('nothing breaks on empty or odd input; only text files are redacted', () => {
  assert.deepEqual(redact('').counts, { id: 0, email: 0, phone: 0 });
  assert.equal(redact(null).text, '');
  assert.equal(redact('```\ncontact: a@b.io\n```').text, '```\ncontact: [REDACTED EMAIL]\n```', 'inside a code block too');
  assert.deepEqual(['a.md', 'b.TXT', 'c.csv', 'd.pdf', 'e.png', ''].map(isTextFile), [true, true, true, false, false, false]);
});
