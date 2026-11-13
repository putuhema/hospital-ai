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
