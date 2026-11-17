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

test('the crowd moves about as often as they visibly move: rarely far out, 20 a second up close, calmer when left alone', async () => {
  const { stepEvery, sunny } = await import('../src/lib/scene/crowd.ts');
  assert.equal(stepEvery(40, 5000), 48, 'up close: 20 a second');
  assert.ok(stepEvery(6, 5000) > 150, 'far out: a handful a second');
  assert.equal(stepEvery(0, 5000), 160, 'never slower than about 6 a second');
  assert.equal(stepEvery(40, 120_000), 120, 'left alone a while: calmer');
  assert.ok(sunny(12) && !sunny(8) && !sunny(18));
});

test('cats, children and older people are about; a tapped one hops; nobody in view means no frame', async () => {
  const THREE = await import('three');
  const { createCrowd } = await import('../src/lib/scene/crowd.ts');
  const scene = new THREE.Scene();
  const crowd = createCrowd(scene, 40);
  crowd.setHour(12);
  // Two long strolls, 40 m east and 30 m north.
  crowd.setStrolls([
    [{ x: 0, z: 0 }, { x: 40, z: 0 }],
    [{ x: 0, z: 0 }, { x: 0, z: 30 }],
  ]);
  const kinds = Array.from({ length: 43 }, (_, i) => crowd.kindOf(i));
  assert.deepEqual(kinds.slice(0, 3), ['cat', 'cat', 'cat'], 'three cats, first, so they stay about');
  assert.ok(kinds.slice(3).every((k) => k !== 'cat'));

  // Looking down on the strolls: someone is in view, so a frame is worth drawing.
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1500);
  camera.position.set(20, 80, 15);
  camera.lookAt(20, 0, 15);
  camera.updateMatrixWorld();
  crowd.update(1000, camera);
  assert.equal(crowd.update(1100, camera), true);
  // Looking away, far off: nobody to draw.
  camera.position.set(5000, 80, 5000);
  camera.lookAt(5000, 0, 5000);
  camera.updateMatrixWorld();
  assert.equal(crowd.update(1200, camera), false);

  // Fewer people in quiet hours, but the cats stay.
  crowd.setActive(0);
  assert.equal(crowd.group.children.every((m) => (m as { count?: number }).count === 3), true);
  crowd.setActive(40);

  // Tapped: a hop for half a second, then still while they speak.
  assert.equal(crowd.lively(), false);
  crowd.hold(10, 4.5);
  assert.equal(crowd.lively(), true);
  crowd.update(1500);
  crowd.update(1800);
  crowd.update(2100);
  assert.equal(crowd.lively(), false);
  crowd.dispose();
  assert.equal(scene.children.length, 0);
});

test('children, older people and cats have their own lines in both languages', async () => {
  const { CHATTER_BY } = await import('../src/lib/i18n/chatter.ts');
  for (const lines of Object.values(CHATTER_BY)) {
    assert.equal(lines.id.length, lines.en.length);
    assert.ok(lines.id.length >= 4 && [...lines.id, ...lines.en].every((s) => s.length > 3 && s.length < 80));
  }
});
