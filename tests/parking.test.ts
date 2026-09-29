import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assets, parseLayout, type Piece } from '../src/lib/model/layout.ts';
import { gatewayParts, isParking, parkingBays, pieceType, walkwayAt } from '../src/lib/model/interiors.ts';
import { areaAt, buildGrid, nearestOfType, places, planRoute } from '../src/lib/wayfinding/routing.ts';
import { search } from '../src/lib/wayfinding/search.ts';
import { shortcuts } from '../src/lib/wayfinding/shortcuts.ts';

const lot: Piece = { id: 7, name: 'Visitor car park', kind: 'parking', x: 1, y: 12, w: 6, h: 4, rotation: 0, color: '#7c8286', rooms: [] };
const clinic: Piece = { id: 1, name: 'Clinic', kind: 'flat', x: 10, y: 2, w: 5, h: 4, rotation: 0, color: '#d3ddd0', rooms: [] };

test('car parks are an outdoor asset and survive saving, with visitor info', () => {
  const asset = assets.find((a) => a.kind === 'parking')!;
  assert.equal(asset.group, 'Outdoor');
  const info = { description: 'First 2 hours free', hours: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '06:00', close: '22:00' }] };
  const [loaded] = parseLayout(JSON.stringify({ pieces: [{ ...lot, info }] })).pieces;
  assert.ok(isParking(loaded));
  assert.deepEqual(loaded.info, info);
});

test('bays: one row in a shallow car park, two facing an aisle in a deep one', () => {
  const shallow = parkingBays(lot);
  assert.equal(shallow.alongX, true);
  assert.equal(new Set(shallow.bays.map((b) => b.row)).size, 1);
  assert.equal(shallow.bays.length, 4, '12 m of 2.5 m bays');
  const big = { ...lot, w: 9, h: 7 },
    deep = parkingBays(big);
  assert.equal(new Set(deep.bays.map((b) => b.row)).size, 2);
  const upright = parkingBays({ ...lot, w: 3, h: 6 });
  assert.equal(upright.alongX, false, 'bays run along the long side');
  for (const [p, { bays }] of [[lot, shallow], [big, deep]] as const)
    for (const b of bays)
      assert.ok(b.x > p.x && b.x < p.x + p.w && b.y > p.y && b.y < p.y + p.h, 'bays sit inside the car park');
});

test('a car park is a destination you can search for and walk to', () => {
  const pieces = [clinic, lot],
    list = places(pieces),
    park = list.find((p) => p.id === 'a:7')!;
  assert.equal(park.kind, 'area');
  assert.equal(park.detail, 'Parking');
  assert.equal(search(list, 'parkir')[0].place.id, 'a:7');
  assert.equal(search(list, 'car park')[0].place.id, 'a:7');
  assert.deepEqual(shortcuts(list), [{ name: 'Parking', kind: 'landmark', category: 'parking' }]);
  const g = buildGrid(pieces, 24, 20);
  assert.equal(nearestOfType(g, list, 'Parking', list.find((p) => p.name === 'Clinic')!)?.id, 'a:7');
  const back = planRoute(g, list.find((p) => p.name === 'Clinic')!, park)!;
  assert.ok(back, 'walks from the clinic to the car park');
  assert.match(back.steps.at(-1)!.text, /Visitor car park/);
});

test('you can start from where you parked', () => {
  const pieces = [clinic, lot],
    spot = { x: 3, y: 14 };
  assert.equal(walkwayAt(pieces, spot)?.id, 7);
  assert.equal(areaAt(pieces, spot), 'Visitor car park');
  const g = buildGrid(pieces, 24, 20),
    route = planRoute(g, spot, places(pieces).find((p) => p.name === 'Clinic')!)!;
  assert.ok(route.meters > 10);
});

const bikes: Piece = { id: 8, name: 'Motorcycle parking', kind: 'motorcycle', x: 1, y: 8, w: 4, h: 3, rotation: 0, color: '#80868a', rooms: [] };
const gate: Piece = { id: 9, name: 'RSUD Sanglah', kind: 'gate', x: 8, y: 18, w: 5, h: 1, rotation: 0, color: '#b9b2a3', rooms: [] };
const barrier: Piece = { id: 10, name: 'Parking gate', kind: 'barrier', x: 1, y: 16, w: 3, h: 1, rotation: 0, color: '#6f7579', rooms: [] };

test('motorcycle parking has narrow bays and counts as parking', () => {
  assert.ok(isParking(bikes));
  assert.equal(pieceType(bikes), 'Motorcycle parking');
  const { bays } = parkingBays(bikes);
  assert.equal(new Set(bays.map((b) => b.row)).size, 2, 'two rows of 2 m bays fit in 6 m');
  assert.equal(bays.length, 14, '8 m of 1 m bays, twice');
  const list = places([clinic, bikes]);
  assert.equal(search(list, 'parkir motor')[0].place.id, 'a:8');
  assert.equal(list.find((p) => p.id === 'a:8')!.detail, 'Parking');
});

test('the campus entrance is an entrance you can search for and walk through', () => {
  const pieces = [clinic, gate],
    list = places(pieces),
    entrance = list.find((p) => p.id === 'a:9')!;
  assert.equal(entrance.category, 'entrance');
  assert.equal(search(list, 'gerbang')[0].place.id, 'a:9');
  const { blocks, span } = gatewayParts(gate);
  assert.equal(blocks.length, 2, 'a pillar each side of the drive');
  assert.ok(span[0].x < span[1].x && span[0].y === span[1].y, 'the beam crosses the drive');
  assert.equal(areaAt(pieces, { x: 10.5, y: 18.5 }), 'RSUD Sanglah');
  assert.ok(planRoute(buildGrid(pieces, 24, 20), entrance, list.find((p) => p.name === 'Clinic')!));
});

test('a parking gate is a walkable entrance and exit, and its booth can sit on either side', () => {
  assert.equal(walkwayAt([barrier], { x: 2.5, y: 16.5 })?.id, 10);
  const list = places([clinic, barrier]),
    gateway = list.find((p) => p.id === 'a:10')!;
  assert.equal(gateway.category, 'entrance');
  assert.equal(gateway.detail, 'Entrance & exit');
  assert.equal(search(list, 'exit')[0].place.id, 'a:10');
  assert.ok(planRoute(buildGrid([clinic, barrier], 24, 20), list.find((p) => p.name === 'Clinic')!, gateway), 'directions to the gate');
  const near = gatewayParts(barrier).blocks[0],
    far = gatewayParts({ ...barrier, rotation: 180 }).blocks[0];
  assert.ok(near.x < barrier.x + 1 && far.x > barrier.x + 2);
  const upright = gatewayParts({ ...barrier, w: 1, h: 3, rotation: 90 });
  assert.equal(upright.alongX, false);
  assert.equal(upright.span[0].x, upright.span[1].x, 'the arm runs down an upright gate');
});

test('entrance, parking gate and motorcycle parking survive saving', () => {
  const info = { description: 'Open all day' };
  const loaded = parseLayout(JSON.stringify({ pieces: [bikes, { ...gate, info }, { ...barrier, info }] })).pieces;
  assert.deepEqual(loaded.map((p) => p.kind), ['motorcycle', 'gate', 'barrier']);
  assert.deepEqual(loaded[1].info, info);
  assert.deepEqual(loaded[2].info, info, 'a parking gate has visitor info, e.g. its hours');
  for (const kind of ['motorcycle', 'gate', 'barrier']) assert.equal(assets.find((a) => a.kind === kind)?.group, 'Outdoor');
});
