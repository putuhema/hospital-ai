import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chasePose, keysInput, look, roamer, step, wayAlong, zoom, RUN, TURN, WALK } from '../src/lib/scene/roam.ts';
import { assistantContext } from '../src/lib/assistant/tools.ts';
import { parseLayout, starterPieces } from '../src/lib/model/layout.ts';
import { canStep, planRoute } from '../src/lib/wayfinding/routing.ts';
import { whereAt } from '../src/lib/model/interiors.ts';

type Clear = (a: { x: number; z: number }, b: { x: number; z: number }) => boolean;
const open: Clear = () => true;
const walk = (r: ReturnType<typeof roamer>, input: { x: number; y: number; run: boolean }, seconds: number, clear: Clear = open) => {
  for (let t = 0; t < seconds; t += 0.02) r = step(r, input, 0.02, clear);
  return r;
};

test('forward walks the way the figure faces, left and right turn it, and the camera swings round behind', () => {
  // The camera south of the walker (yaw 0); the figure faces north, away from it.
  const north = walk(roamer(0, 0, 0), { x: 0, y: 1, run: false }, 2);
  assert.ok(north.z < -4 && Math.abs(north.x) < 0.01, `walked north: ${north.x}, ${north.z}`);
  assert.ok(Math.abs(north.speed - WALK) < 0.1);
  // Holding right turns them clockwise: a quarter turn faces east.
  const turned = walk(roamer(0, 0, 0), { x: 1, y: 0, run: false }, (Math.PI / 2) / TURN);
  assert.ok(Math.abs(Math.sin(turned.facing) - 1) < 0.05, 'facing east');
  const east = walk(turned, { x: 0, y: 1, run: true }, 3);
  assert.ok(east.x > 12 && Math.abs(east.speed - RUN) < 0.2, `ran east: ${east.x}`);
  // The camera has come round behind them, to the west, looking east.
  assert.ok(Math.abs(Math.sin(east.yaw) + 1) < 0.05, `camera behind: ${east.yaw}`);
  const pose = chasePose(east);
  assert.ok(pose.position.x < east.x - 3);
  // Backwards is slower, and letting go stops them.
  const back = walk(roamer(0, 0, 0), { x: 0, y: -1, run: false }, 2);
  assert.ok(back.z > 2 && back.z < 4, `stepped back: ${back.z}`);
  assert.ok(Math.abs(walk(north, { x: 0, y: 0, run: false }, 1).speed) < 0.05);
});

test('a glance around by dragging settles back behind once they walk on', () => {
  const glancing = look(roamer(0, 0, 0), 300, 0);
  assert.ok(glancing.glance < -1);
  const settled = walk(glancing, { x: 0, y: 1, run: false }, 3);
  assert.ok(Math.abs(settled.glance) < 0.1 && Math.abs(Math.sin(settled.yaw)) < 0.1);
  // Standing still, the glance stays.
  assert.ok(walk(glancing, { x: 0, y: 0, run: false }, 2).glance < -1);
});

test('the arrow leads along the route, round the corner, not straight at the end', () => {
  // East 10 m, then north 10 m: from the start, it points east first.
  const route = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 10, z: 0 }, { x: 10, z: -5 }, { x: 10, z: -10 }];
  const first = wayAlong(route, 0, 0)!;
  assert.ok(Math.abs(Math.sin(first) - 1) < 0.01, 'east');
  // At the corner it turns north (-z).
  const corner = wayAlong(route, 10, 0)!;
  assert.ok(Math.abs(Math.cos(corner) + 1) < 0.01, 'north');
  assert.equal(wayAlong(route, 10, -10), null, 'there');
  assert.equal(wayAlong([], 0, 0), null);
});

test('a wall stops the walker, who slides along it rather than sticking', () => {
  // A wall along z = -2: nothing gets past it northwards.
  const clear = (a: { x: number; z: number }, b: { x: number; z: number }) => !(a.z >= -2 && b.z < -2);
  // Facing north-east, walking straight on into it.
  const r = walk({ ...roamer(0, 0, 0), facing: (3 * Math.PI) / 4 }, { x: 0, y: 1, run: false }, 3, clear);
  assert.ok(r.z >= -2 && r.z < -1.4, `stopped at the wall: ${r.z}`);
  assert.ok(r.x > 4, `slid along it: ${r.x}`);
});

test('the camera tilts and zooms within limits, and follows behind', () => {
  let r = roamer(10, 20, 0);
  const behind = chasePose(r);
  assert.ok(behind.position.z > 20 && behind.position.y > 2, 'behind and above');
  assert.deepEqual([behind.target.x, behind.target.z], [10, 20]);
  r = look(r, 0, 10_000);
  assert.equal(r.pitch, 1.2);
  r = zoom(zoom(r, 100), 100);
  assert.equal(r.distance, 20);
});

test('keys: WASD and the arrows, Shift to run', () => {
  assert.deepEqual(keysInput(new Set(['w', 'd'])), { x: 1, y: 1, run: false });
  assert.deepEqual(keysInput(new Set(['arrowdown', 'arrowleft', 'shift'])), { x: -1, y: -1, run: true });
  assert.deepEqual(keysInput(new Set()), { x: 0, y: 0, run: false });
});

test("the campus's walls stop a step through them; open ground and doors don't", () => {
  const layout = parseLayout(JSON.stringify({ pieces: starterPieces }));
  const g = assistantContext(layout, new Date()).grid;
  // The longest east–west wall, at its middle (no door there).
  const [a, b] = g.walls.filter(([p, q]) => p.y === q.y).sort(([p, q], [r, s]) => Math.abs(s.x - r.x) - Math.abs(q.x - p.x))[0];
  const mid = (a.x + b.x) / 2;
  assert.equal(canStep(g, { x: mid, y: a.y - 0.15 }, { x: mid, y: a.y + 0.15 }), false);
  assert.equal(canStep(g, { x: mid, y: a.y - 0.4 }, { x: mid, y: a.y - 0.2 }), true, 'along one side');
  assert.equal(canStep(g, { x: 1, y: 1 }, { x: -0.1, y: 1 }), false, 'never off the canvas');
  // A route from reception into the pharmacy goes through doors: walked in short steps, every one is clear.
  const ctx = assistantContext(layout, new Date());
  const from = ctx.places.find((p) => p.name === 'Main reception')!, to = ctx.places.find((p) => p.name === 'Pharmacy')!;
  const route = planRoute(g, from, to)!;
  let steps = 0;
  for (let i = 1; i < route.points.length; i++) {
    const p = route.points[i - 1], q = route.points[i], n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 0.1);
    for (let k = 0; k < n; k++, steps++) {
      const at = (t: number) => ({ x: p.x + ((q.x - p.x) * t) / n, y: p.y + ((q.y - p.y) * t) / n });
      assert.ok(canStep(g, at(k), at(k + 1)), `step ${steps} of the route is blocked`);
    }
  }
  assert.ok(steps > 20);
});

test('"you are in": the room and building, or nothing outdoors', () => {
  const pieces = starterPieces;
  const ward = pieces.find((p) => p.name === 'West patient ward')!;
  const room = ward.roomAssets![0];
  const inRoom = whereAt(pieces, { x: ward.x + room.x + room.w / 2, y: ward.y + room.y + room.h / 2 });
  assert.equal(inRoom?.piece.name, 'West patient ward');
  assert.equal(inRoom?.room?.id, room.id);
  assert.equal(whereAt(pieces, { x: -5, y: -5 }), null);
});
