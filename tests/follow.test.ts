import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStepDetector, createTurnDetector, yawRate } from '../src/lib/wayfinding/motion.ts';
import { createFollower, legLengths, STRIDE } from '../src/lib/wayfinding/follow.ts';
import type { Route } from '../src/lib/wayfinding/routing.ts';

/** Feed `seconds` of 60 Hz samples, from `start` ms; returns the sample times a detector fired. */
function run(seconds: number, sample: (t: number) => number, detect: (v: number, t: number) => unknown, start = 0) {
  const hits: unknown[] = [];
  for (let i = 0; i < seconds * 60; i++) {
    const t = start + (i * 1000) / 60,
      out = detect(sample(t / 1000), t);
    if (out !== false && out !== null) hits.push(out === true ? t : out);
  }
  return hits;
}
const noise = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);

test('steps are counted from the bumps of walking, not from a phone held still', () => {
  const walking = run(10, (s) => 9.81 + 2.6 * Math.sin(2 * Math.PI * 1.8 * s), createStepDetector());
  assert.ok(walking.length >= 16 && walking.length <= 19, `${walking.length} steps in 10 s at 1.8 steps/s`);
  const jitter = noise(7);
  assert.equal(run(10, () => 9.81 + jitter() * 0.4, createStepDetector()).length, 0);
});

test('turning speed about the vertical, however the phone is held', () => {
  // Flat, screen up: turning about the screen's own axis.
  assert.equal(yawRate({ x: 0, y: 0, z: 9.81 }, { alpha: 30, beta: 0, gamma: 0 }), 30);
  // Upright: the turn shows about the phone's long axis.
  assert.equal(yawRate({ x: 0, y: 9.81, z: 0 }, { alpha: 0, beta: 0, gamma: -40 }), -40);
  // Tilting the phone forward is not a turn of the body.
  assert.equal(yawRate({ x: 0, y: 0, z: 9.81 }, { alpha: 0, beta: 50, gamma: 0 }), 0);
});

test('a turn is reported once it is over, with its angle; a wiggle is not', () => {
  // 1 s still, a right turn at 90°/s for 1 s, then still again.
  const right = run(3, (s) => (s >= 1 && s < 2 ? -90 : 0), createTurnDetector()) as number[];
  assert.equal(right.length, 1);
  assert.ok(Math.abs(right[0] + 90) < 5, `turned ${right[0]}°`);
  const wiggle = run(3, (s) => (s >= 1 && s < 1.25 ? 60 : 0), createTurnDetector());
  assert.deepEqual(wiggle, []);
});

// South 10 m, then a left turn (east) for 10 m, then there.
const route: Route = {
  points: [{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 5, y: 5 }],
  meters: 20,
  steps: [
    { text: '', meters: 10, at: 0, say: { kind: 'start', from: null, heading: 'south' } },
    { text: '', meters: 10, at: 1, say: { kind: 'turn', turn: 'left' } },
    { text: '', meters: 0, at: 2, say: { kind: 'arrive', place: 'Lab' } },
  ],
};
const walk = (f: ReturnType<typeof createFollower>, metres: number) => {
  for (let m = 0; m < metres - 1e-9; m += STRIDE) f.step();
};

test('stretches are measured along the route', () => {
  assert.deepEqual(legLengths(route), [10, 10, 0]);
});

test('the turn the route expects moves the visitor on, and they arrive by walking the last stretch', () => {
  const f = createFollower(route);
  walk(f, 9);
  assert.equal(f.done, 0);
  assert.ok(f.along > 8.5);
  assert.equal(f.turn(-80), false, 'a right turn is not the left turn the route makes');
  assert.equal(f.turn(85), true);
  assert.equal(f.done, 1);
  assert.equal(f.along, 0, 'at the corner, whatever the step count said');
  walk(f, 10);
  assert.equal(f.done, 3, 'arrived: every step, the arrival too, ticked');
});

test('a turn felt far too early is ignored; with no turn felt, it waits at the corner a long way before moving on', () => {
  const f = createFollower(route);
  walk(f, 2);
  assert.equal(f.turn(90), false, 'turning round at the start is not the corner');
  walk(f, 18);
  assert.equal(f.done, 0, 'still waiting for the turn, the dot at the corner');
  assert.equal(f.along, 10);
  walk(f, 5);
  assert.equal(f.done, 1);
});

test('a map drawn smaller than the hospital is learned at the first corner', () => {
  // The route is drawn 20 m long, but each stretch is twice that on foot.
  const f = createFollower(route);
  walk(f, 19.6);
  assert.equal(f.done, 0, 'reaching the drawn length early, it waits for the real corner');
  assert.equal(f.turn(90), true);
  assert.ok(Math.abs(f.scale - 0.7) < 0.05, `learned ${f.scale.toFixed(2)} so far, on the way to 0.5`);
  walk(f, 10);
  assert.ok(f.along < 8, `10 m walked of a 20 m stretch shows ${f.along.toFixed(1)} map metres, not the whole of it`);
  // What a route taught carries to the next.
  const next = createFollower(route, { scale: 0.5 });
  walk(next, 10);
  assert.ok(Math.abs(next.along - 5) < 0.5);
});

test('ticking a step by hand overrides the count', () => {
  const f = createFollower(route);
  walk(f, 4);
  f.sync(1);
  assert.equal(f.done, 1);
  assert.equal(f.along, 0);
});
