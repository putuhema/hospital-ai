import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format, messages, type Key } from '../src/lib/i18n/messages.ts';

test('every message says the same thing in both languages, with the same values', () => {
  const values = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(messages.en) as Key[]) {
    assert.ok(messages.id[key]?.trim(), `${key} has no Indonesian`);
    assert.deepEqual(values(messages.id[key]), values(messages.en[key]), `${key} fills in different values`);
  }
});

test('values are filled in; Indonesian reads naturally', () => {
  assert.equal(format('id', 'nearest', { type: 'toilet' }), 'toilet terdekat');
  assert.equal(format('en', 'nearest', { type: 'toilets' }), 'Nearest toilets');
  assert.equal(format('id', 'fromWalk', { name: 'IGD', n: 3 }), 'Dari IGD · 3 menit jalan kaki');
  assert.equal(format('id', 'searchTitle', {}), 'Cari di {title}', 'a missing value stays visible');
});
