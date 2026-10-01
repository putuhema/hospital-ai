import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid, places, planRoute, searchPlaces, unreachable } from '../src/lib/wayfinding/routing.ts';
import { starterPieces, type Piece } from '../src/lib/model/layout.ts';
import { footprint, inPolygon } from '../src/lib/model/interiors.ts';
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

test('a route along a garden path follows it, even when the doors are a step off the path', () => {
  const block = (id: number, name: string, x: number, y: number, side: 'east' | 'north', offset: number): Piece =>
    ({ id, name, kind: 'flat', x, y, w: side === 'east' ? 4 : 5, h: 4, rotation: 0, color: '#ffffff', entrances: [{ side, offset, width: 0.8 }] });
  const path = (id: number, x: number, y: number, w: number, h: number): Piece =>
    ({ id, name: 'Path', kind: 'path', x, y, w, h, rotation: 0, color: '#cfc6b4' });
  // An L of path with a tile of grass between it and each door.
  const pieces = [block(1, 'A', 0, 0, 'east', 1.5), path(2, 5, 1, 5, 1), path(3, 9, 2, 1, 7), block(4, 'B', 7, 10, 'north', 2.5)],
    list = places(pieces),
    route = planRoute(buildGrid(pieces, 24, 20), find(list, 'A'), find(list, 'B'))!;
  let grass = 0;
  for (let i = 1; i < route.points.length; i++)
    for (let t = 0.05; t < 1; t += 0.1) {
      const a = route.points[i - 1], b = route.points[i],
        p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (!pieces.some((q) => inPolygon(p, footprint(q)))) grass += distance(a, b) * 0.1;
    }
  assert.ok(grass < 2.5, `crossed ${grass.toFixed(1)} tiles of grass instead of taking the path`);
});
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
test('steps are put into words in Indonesian, with arrows from what they mean', async () => {
  const { stepText, stepGlyph } = await import('../src/lib/wayfinding/routing.ts');
  const { typeName } = await import('../src/lib/i18n/places.ts');
  const g = buildGrid(starterPieces, 24, 20), list = places(starterPieces);
  const route = planRoute(g, find(list, 'Main reception'), find(list, 'Laboratory'))!;
  assert.equal(stepText(route.steps[0].say, 'id'), 'Dari Main reception, jalan ke arah utara masuk ke koridor');
  assert.equal(stepText(route.steps.at(-1)!.say, 'id'), 'Tiba di Laboratory di Pharmacy & lab');
  assert.deepEqual(route.steps.map(stepGlyph), ['●', '↗', '↗', '↱', '⚑']);
  const fromSpot = planRoute(g, { x: 12, y: 18 }, find(list, 'Room 1'))!;
  assert.match(stepText(fromSpot.steps[0].say, 'id'), /^Dari posisi Anda/);
  assert.match(fromSpot.steps[0].text, /^From your position/);
  assert.equal(typeName('Pharmacy', 'id'), 'Apotek');
  assert.equal(typeName('Parking', 'id'), 'Parkir');
  assert.equal(typeName('Pharmacy', 'en'), 'Pharmacy');
  assert.equal(typeName('Something new', 'id'), 'Something new');
});
test('every kind of room and landmark has an Indonesian name', async () => {
  const { typeName } = await import('../src/lib/i18n/places.ts');
  const { roomTypes } = await import('../src/lib/model/interiors.ts');
  const { categories } = await import('../src/lib/model/categories.ts');
  for (const name of [...roomTypes.map((t) => t.name), ...categories.map((c) => c.name), 'Building', 'Listed room'])
    assert.ok(name === 'Lift' || typeName(name, 'id') !== name, `${name} has no Indonesian name`);
});

test('rooms the editor named by default read in Indonesian; names the hospital wrote are kept', async () => {
  const { roomName, localizeRooms } = await import('../src/lib/i18n/places.ts');
  assert.equal(roomName('Examination room 2', 'id'), 'Ruang periksa 2');
  assert.equal(roomName('toilets', 'id'), 'Toilet');
  assert.equal(roomName('Exam room 1', 'id'), 'Ruang periksa 1');
  assert.equal(roomName('Room 3', 'id'), 'Kamar 3');
  assert.equal(roomName('Examination room 2', 'en'), 'Examination room 2');
  assert.equal(roomName('Poli Interna', 'id'), 'Poli Interna');
  assert.equal(roomName('Toilets near the lobby', 'id'), 'Toilets near the lobby');
  const pieces = [
    { id: 1, name: 'Poliklinik', roomAssets: [{ id: 1, name: 'Toilets 2' }], rooms: ['Waiting area'] },
    { id: 2, name: 'Corridor' },
  ];
  const [clinic, corridor] = localizeRooms(pieces, 'id');
  assert.equal(clinic.name, 'Poliklinik');
  assert.equal(clinic.roomAssets?.[0].name, 'Toilet 2');
  assert.deepEqual(clinic.rooms, ['Ruang tunggu']);
  assert.equal(corridor, pieces[1]);
  assert.equal(localizeRooms(pieces, 'en'), pieces);
});

test('ticking off steps moves along the route', async () => {
  const { progress } = await import('../src/lib/wayfinding/routing.ts');
  const g = buildGrid(starterPieces, 24, 20), list = places(starterPieces);
  const route = planRoute(g, find(list, 'Main reception'), find(list, 'Laboratory'))!;
  // Each step starts where the last one left off, from the first point to the last.
  assert.equal(route.steps[0].at, 0);
  assert.equal(route.steps.at(-1)!.at, route.points.length - 1);
  for (let i = 1; i < route.steps.length; i++) assert.ok(route.steps[i].at > route.steps[i - 1].at);
  assert.deepEqual(progress(route, 0), { at: 0, metersLeft: route.steps.reduce((m, s) => m + s.meters, 0) });
  assert.deepEqual(progress(route, 1), { at: route.steps[1].at, metersLeft: route.steps.slice(1).reduce((m, s) => m + s.meters, 0) });
  assert.deepEqual(progress(route, 99), { at: route.points.length - 1, metersLeft: 0 });
});
