import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assets, parseLayout, pieceFrom, type Piece } from '../src/lib/model/layout.ts';
import {
  fenceSegments,
  gatewayParts,
  isArea,
  isBuilding,
  isCorridor,
  isFence,
  isOpenAir,
  isParking,
  parkingBays,
  parkingFenceRuns,
  pieceType,
  walkwayAt,
  whereAt,
} from '../src/lib/model/interiors.ts';
import { walkable, walls } from '../src/lib/wayfinding/navigation.ts';
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

test('fence, fence corner, and fenced parking area assets exist, survive parseLayout, and have valid SVG thumbnails', () => {
  const fenceAsset = assets.find((a) => a.name === 'Fence')!;
  const cornerAsset = assets.find((a) => a.name === 'Fence corner')!;
  const areaAsset = assets.find((a) => a.name === 'Parking area')!;
  assert.ok(fenceAsset && cornerAsset && areaAsset);
  for (const a of [fenceAsset, cornerAsset, areaAsset]) {
    assert.equal(a.group, 'Outdoor');
    assert.ok(a.image && a.image.startsWith('/models/') && a.image.endsWith('.svg'));
    const file = path.resolve('static', a.image.slice(1));
    const svg = fs.readFileSync(file, 'utf8');
    assert.match(svg, /^<svg[^>]*viewBox="0 0 400 300"/);
    assert.match(svg, /<\/svg>\s*$/);
  }
  assert.equal(fenceAsset.kind, 'fence');
  assert.equal(cornerAsset.kind, 'fence');
  assert.equal(cornerAsset.w, 1);
  assert.equal(cornerAsset.h, 1);
  assert.equal(areaAsset.kind, 'parking');
  assert.equal(areaAsset.fenced, true);

  const pieces = [
    pieceFrom(fenceAsset, { id: 20, x: 2, y: 2 }),
    pieceFrom(cornerAsset, { id: 21, x: 6, y: 2 }),
    pieceFrom(areaAsset, { id: 22, x: 2, y: 8 }),
  ];
  assert.equal(pieces[2].fenced, true);
  const loaded = parseLayout(JSON.stringify({ pieces })).pieces;
  assert.equal(loaded.length, 3);
  assert.equal(loaded[0].kind, 'fence');
  assert.equal(loaded[1].kind, 'fence');
  assert.equal(loaded[2].fenced, true);

  assert.throws(
    () => parseLayout(JSON.stringify({ pieces: [{ ...pieces[2], fenced: 'yes' }] })),
    /Invalid layout/,
  );
});

test('fences are physical barriers, not walkable ground or searchable destinations', () => {
  const fence: Piece = {
    id: 30,
    name: 'North fence',
    kind: 'fence',
    x: 4,
    y: 6,
    w: 4,
    h: 1,
    rotation: 0,
    color: '#eef2ec',
    roofColor: '#2f5741',
    rooms: [],
  };
  assert.equal(isFence(fence), true);
  assert.equal(isOpenAir(fence), false);
  assert.equal(isArea(fence), false);
  assert.equal(isBuilding(fence), false);
  assert.equal(isCorridor(fence), false);
  assert.equal(pieceType(fence), 'Fence');
  assert.equal(walkwayAt([fence], { x: 6, y: 6.5 }), undefined);
  assert.equal(whereAt([fence], { x: 6, y: 6.5 }), null);
  assert.equal(places([fence]).length, 0);
});

test('fenceSegments spans rectangular fences and connects 1x1 corners to perpendicular neighbors', () => {
  const horiz: Piece = { id: 40, name: 'H', kind: 'fence', x: 2, y: 5, w: 4, h: 1, rotation: 0, color: '#eef2ec', rooms: [] };
  const corner: Piece = { id: 41, name: 'C', kind: 'fence', x: 6, y: 5, w: 1, h: 1, rotation: 0, color: '#eef2ec', rooms: [] };
  const vert: Piece = { id: 42, name: 'V', kind: 'fence', x: 6, y: 6, w: 1, h: 4, rotation: 90, color: '#eef2ec', rooms: [] };

  assert.deepEqual(fenceSegments(horiz, [horiz]), [[{ x: 2, y: 5.5 }, { x: 6, y: 5.5 }]]);
  assert.deepEqual(fenceSegments(vert, [vert]), [[{ x: 6.5, y: 6 }, { x: 6.5, y: 10 }]]);

  // Isolated 1x1 corner falls back to straight centerline by rotation.
  assert.deepEqual(fenceSegments(corner, [corner]), [[{ x: 6, y: 5.5 }, { x: 7, y: 5.5 }]]);
  assert.deepEqual(fenceSegments({ ...corner, rotation: 90 }, [{ ...corner, rotation: 90 }]), [[{ x: 6.5, y: 5 }, { x: 6.5, y: 6 }]]);

  // Connected to west (horiz) and south (vert) -> two L-corner segments from center to edge midpoints.
  const cornerSegs = fenceSegments(corner, [horiz, corner, vert]);
  assert.equal(cornerSegs.length, 2);
  assert.deepEqual(cornerSegs, [
    [{ x: 6.5, y: 5.5 }, { x: 6, y: 5.5 }],
    [{ x: 6.5, y: 5.5 }, { x: 6.5, y: 6 }],
  ]);
});

test('walls and planRoute treat fences as solid barriers and route around them', () => {
  const fence: Piece = { id: 50, name: 'Barrier fence', kind: 'fence', x: 5, y: 8, w: 8, h: 1, rotation: 0, color: '#eef2ec', rooms: [] };
  const pieces = [fence];
  const segs = walls(pieces);
  assert.equal(segs.length, 1);
  assert.equal(walkable({ x: 9, y: 7 }, { x: 9, y: 10 }, pieces), false, 'straight path across fence is blocked');
  assert.equal(walkable({ x: 3, y: 7 }, { x: 3, y: 10 }, pieces), true, 'path clear of fence is walkable');

  const g = buildGrid(pieces, 20, 18);
  const target = { id: 'n:south', name: 'South point', kind: 'landmark' as const, detail: 'Landmark', point: { x: 9, y: 10 } };
  const route = planRoute(g, { x: 9, y: 7 }, target)!;
  assert.ok(route, 'finds a detour around the fence');
  // Detour must walk past either x <= 5 or x >= 13 and never cross the fence segment.
  assert.ok(
    route.points.some((pt) => pt.x < 5.1 || pt.x > 12.9),
    'route detours around the end of the fence',
  );
  for (let i = 1; i < route.points.length; i++)
    assert.equal(walkable(route.points[i - 1], route.points[i], pieces), true, 'route never crosses fence');
});

test('fenced parking encloses 3 sides, rotates open drive-in end, opens path/barrier gaps, and routes cleanly inside', () => {
  const fencedLot: Piece = {
    id: 60,
    name: 'Fenced parking',
    kind: 'parking',
    fenced: true,
    x: 4,
    y: 6,
    w: 8,
    h: 5,
    rotation: 0,
    color: '#6e757a',
    roofColor: '#2f5741',
    rooms: [],
  };
  const runsEastOpen = parkingFenceRuns(fencedLot, [fencedLot]);
  assert.equal(runsEastOpen.length, 3, '3 fenced sides when isolated');
  // East end (x = 12) is open when rotation = 0; west (x = 4), north (y = 6), south (y = 11) are blocked.
  assert.equal(walkable({ x: 11, y: 8.5 }, { x: 13, y: 8.5 }, [fencedLot]), true, 'east drive-in entry is open at rotation 0');
  assert.equal(walkable({ x: 3, y: 8.5 }, { x: 5, y: 8.5 }, [fencedLot]), false, 'west side is fenced at rotation 0');
  assert.equal(walkable({ x: 8, y: 5 }, { x: 8, y: 7 }, [fencedLot]), false, 'north side is fenced');
  assert.equal(walkable({ x: 8, y: 10 }, { x: 8, y: 12 }, [fencedLot]), false, 'south side is fenced');

  // Rotating 180° flips the open drive-in end to west (x = 4) and fences east (x = 12).
  const flipped = { ...fencedLot, rotation: 180 };
  assert.equal(walkable({ x: 3, y: 8.5 }, { x: 5, y: 8.5 }, [flipped]), true, 'west drive-in entry is open at rotation 180');
  assert.equal(walkable({ x: 11, y: 8.5 }, { x: 13, y: 8.5 }, [flipped]), false, 'east side is fenced at rotation 180');

  // Tall parking lot: open south at rotation 90, open north at rotation 270.
  const tall90 = { ...fencedLot, w: 5, h: 8, rotation: 90 };
  const tall270 = { ...fencedLot, w: 5, h: 8, rotation: 270 };
  assert.equal(walkable({ x: 6.5, y: 13 }, { x: 6.5, y: 15 }, [tall90]), true, 'south open at rotation 90');
  assert.equal(walkable({ x: 6.5, y: 5 }, { x: 6.5, y: 7 }, [tall90]), false, 'north fenced at rotation 90');
  assert.equal(walkable({ x: 6.5, y: 5 }, { x: 6.5, y: 7 }, [tall270]), true, 'north open at rotation 270');
  assert.equal(walkable({ x: 6.5, y: 13 }, { x: 6.5, y: 15 }, [tall270]), false, 'south fenced at rotation 270');

  // planRoute from outside west of the lot must walk around to the open east entry (never crossing the fence).
  const g1 = buildGrid([fencedLot], 20, 18);
  const lotPlace = places([fencedLot])[0]!;
  const toLot = planRoute(g1, { x: 2, y: 8.5 }, lotPlace)!;
  assert.ok(toLot, 'routes into fenced parking through the open east entry');
  assert.ok(toLot.points.some((pt) => pt.x > 12), 'enters from east side');
  for (let i = 1; i < toLot.points.length; i++)
    assert.equal(walkable(toLot.points[i - 1], toLot.points[i], [fencedLot]), true);

  // Connecting a path or barrier on the north side opens a walkable gap in that fence side.
  const northPath: Piece = { id: 61, name: 'Footpath', kind: 'path', x: 7, y: 4, w: 2, h: 2, rotation: 0, color: '#cfc6b4', rooms: [] };
  const southBarrier: Piece = { id: 62, name: 'Gate', kind: 'barrier', x: 6, y: 11, w: 3, h: 1, rotation: 0, color: '#6f7579', rooms: [] };
  const withGaps = [fencedLot, northPath, southBarrier];
  assert.equal(walkable({ x: 8, y: 5 }, { x: 8, y: 7 }, withGaps), true, 'path opens a gap on the north fence');
  assert.equal(walkable({ x: 5, y: 5 }, { x: 5, y: 7 }, withGaps), false, 'rest of north fence remains closed');
  assert.equal(walkable({ x: 7.5, y: 10 }, { x: 7.5, y: 12 }, withGaps), true, 'barrier opens a gap on the south fence');

  const g2 = buildGrid(withGaps, 20, 18);
  const throughPath = planRoute(g2, { x: 8, y: 4.5 }, lotPlace)!;
  assert.ok(throughPath, 'routes straight into fenced lot via the path gap');
  assert.ok(throughPath.points.every((pt) => pt.x > 6.5 && pt.x < 9.5), 'goes straight through north gap without detouring east');
});
