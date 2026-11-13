import { test } from 'node:test';
import assert from 'node:assert/strict';
import { along } from '../src/lib/scene/crowd.ts';

test('a stroller is found along their path, heading the way it goes', () => {
  // East 10 m, then south 5 m.
  const points = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }], lengths = [0, 10, 15];
  const start = along(points, lengths, 0), mid = along(points, lengths, 4), turned = along(points, lengths, 12.5), past = along(points, lengths, 99);
  assert.deepEqual([start.x, start.z], [0, 0]);
  assert.deepEqual([mid.x, mid.z, mid.dx, mid.dz], [4, 0, 1, 0]);
  assert.deepEqual([turned.x, turned.z, turned.dx, turned.dz], [10, 2.5, 0, 1]);
  assert.deepEqual([past.x, past.z], [10, 5], 'never past the end');
});

test('the light follows the hour: day by day, warm at five, lit windows at night', async () => {
  const { daylightAt, sunFrom, busyHours } = await import('../src/lib/scene/daylight.ts');
  const noon = daylightAt(12), golden = daylightAt(17.2), night = daylightAt(22), dawn = daylightAt(6.3);
  assert.equal(noon.windows, 0);
  assert.equal(night.windows, 1);
  assert.ok(night.sunStrength < noon.sunStrength / 2 && night.hemi > 1.5, "night is dimmer, but still easy to read");
  assert.notEqual(golden.sun, noon.sun, 'warmer light late in the afternoon');
  assert.equal(daylightAt(24 + 12).sun, noon.sun, 'hours wrap round');
  assert.ok(dawn.windows > 0 && dawn.windows < 1);
  // The sun rises in the east (+x) and sets in the west.
  assert.ok(sunFrom(7).x > 0.3 && sunFrom(17.5).x < -0.3 && sunFrom(12.25).y > 0.9);
  assert.equal(busyHours(10), 1);
  assert.ok(busyHours(2) < 0.5);
});

test('everyone says something in both languages', async () => {
  const { CHATTER } = await import('../src/lib/i18n/chatter.ts');
  assert.equal(CHATTER.id.length, CHATTER.en.length);
  assert.ok(CHATTER.id.length >= 10 && CHATTER.id.every((s) => s.length > 5 && s.length < 80));
});
