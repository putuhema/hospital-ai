import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid, places, planRoute, searchPlaces, unreachable } from '../src/lib/wayfinding/routing.ts';
import { starterPieces, type Piece } from '../src/lib/model/layout.ts';
const find = (list: ReturnType<typeof places>, name: string) => list.find((p) => p.name === name)!;
const ward: Piece = { id: 1, name: 'Ward', kind: 'flat', x: 2, y: 2, w: 5, h: 4, rotation: 0, color: '#ffffff' };

test('every building and room in the starter layout is reachable from every other', () => {
  const g = buildGrid(starterPieces, 24, 20), list = places(starterPieces);
  assert.deepEqual(unreachable(g, list), []);
  for (const a of list) for (const b of list) assert.ok(planRoute(g, a, b), `${a.name} → ${b.name}`);
});
test('routes enter through a door, never through a wall', () => {
  // Default door is on the north wall at x = 4.5.
  const pieces = [{ ...ward, roomAssets: [{ id: 2, name: 'Exam', type: 'exam' as const, x: 0, y: 0, w: 2, h: 2 }] }];
  const g = buildGrid(pieces, 12, 12), list = places(pieces);
  const route = planRoute(g, { x: 4.5, y: 10 }, find(list, 'Exam'))!;
  assert.ok(route.points.some((p) => p.y < 2), 'walks around to the north door');
  assert.ok(route.meters > 14);
  assert.match(route.steps.at(-1)!.text, /Arrive at Exam in Ward/);
});
test('a room whose door is blocked by a neighbouring room is reported unreachable', () => {
  const pieces = [{ ...ward, roomAssets: [
    { id: 2, name: 'Blocked', type: 'office' as const, x: 0, y: 0, w: 1, h: 2 },
    { id: 3, name: 'Wall', type: 'storage' as const, x: 0, y: 2, w: 2, h: 2, door: 'east' as const },
  ] }];
  const g = buildGrid(pieces, 12, 12);
  assert.deepEqual(unreachable(g, places(pieces)).map((p) => p.name), ['Blocked']);
  const turned = [{ ...pieces[0], roomAssets: [{ ...pieces[0].roomAssets[0], door: 'east' as const }, pieces[0].roomAssets[1]] }];
  assert.deepEqual(unreachable(buildGrid(turned, 12, 12), places(turned)), []);
});
test('corridors are preferred over walking outside', () => {
  const a = { ...ward, id: 1, name: 'A', x: 1, y: 1, w: 3, h: 3 }, b = { ...ward, id: 2, name: 'B', x: 9, y: 1, w: 3, h: 3 };
  const corridor: Piece = { id: 3, name: 'Link', kind: 'straight', x: 4, y: 2, w: 5, h: 1, rotation: 0, color: '#ffffff' };
  const pieces = [a, b, corridor], list = places(pieces);
  const route = planRoute(buildGrid(pieces, 14, 8), find(list, 'A'), find(list, 'B'))!;
  assert.ok(route.points.every((p) => p.y > 2 && p.y < 3 || p.x < 4 || p.x > 9), 'stays in the corridor');
  assert.ok(route.steps.some((s) => s.text.includes('corridor')));
});
test('landmarks and listed rooms are searchable destinations', () => {
  const pieces = [{ ...ward, rooms: ['MRI suite'] }];
  const list = places(pieces, { nodes: [{ id: 'x', name: 'Café', x: 10, y: 10 }, { id: 'y', name: '', x: 1, y: 1 }], edges: [] });
  assert.deepEqual(list.map((p) => p.kind), ['building', 'listed', 'landmark']);
  assert.equal(searchPlaces(list, 'mri')[0].name, 'MRI suite');
  assert.equal(searchPlaces(list, 'ward listed')[0].name, 'MRI suite');
  assert.equal(searchPlaces(list, 'caf').length, 1);
  assert.ok(planRoute(buildGrid(pieces, 12, 12), find(list, 'MRI suite'), find(list, 'Café')));
});
