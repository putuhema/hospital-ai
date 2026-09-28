import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starterPieces, type Piece } from '../src/lib/model/layout.ts';
import { emptyNetwork } from '../src/lib/wayfinding/navigation.ts';
import {
  checkCanvasSize,
  checkMove,
  checkPlacement,
  checkReshape,
  checkRotation,
  duplicated,
  newEntrance,
  rotated,
} from '../src/lib/editor/operations.ts';
import { layoutJson, layoutObj, layoutSnapshot, fileName } from '../src/lib/editor/export.ts';

const canvas = { width: 24, height: 20 };
const box = (extra: Partial<Piece> = {}): Piece => ({
  id: 100, kind: 'flat', name: 'Test', x: 2, y: 2, w: 4, h: 3, rotation: 0, color: '#ffffff', ...extra,
});

test('moves stay on the canvas and off other pieces', () => {
  const a = box(), b = box({ id: 101, x: 10 });
  assert.equal(checkMove([a, b], a, 0, 0, canvas), null);
  assert.equal(checkMove([a, b], a, 22, 0, canvas), 'Keep the building inside the canvas');
  assert.equal(checkMove([a, b], a, 8, 2, canvas), 'This space is occupied');
});

test('placement rejects occupied and off-grid spots', () => {
  const a = box();
  assert.equal(checkPlacement([a], box({ id: 2, x: 12 }), canvas), null);
  assert.equal(checkPlacement([a], box({ id: 2, x: -1 }), canvas), 'Keep the asset inside the grid');
  assert.match(checkPlacement([a], box({ id: 2, x: 3 }), canvas)!, /occupied/);
});

test('canvas size must be whole, in range and keep everything inside', () => {
  const network = emptyNetwork();
  assert.equal(checkCanvasSize(starterPieces, network, 30, 30), null);
  assert.match(checkCanvasSize([], network, 8.5, 20)!, /whole numbers/);
  assert.match(checkCanvasSize([], network, 101, 20)!, /whole numbers/);
  assert.match(checkCanvasSize([box({ x: 10 })], network, 12, 12)!, /Move buildings/);
});

test('rotating turns the piece about its centre and carries rooms and doors', () => {
  const p = box({
    x: 4, w: 6, h: 2,
    entrances: [{ side: 'east', offset: 0.5, width: 0.8 }],
    roomAssets: [{ id: 1, name: 'A', type: 'office', x: 0, y: 0, w: 2, h: 2, door: 'south' }],
  } as Partial<Piece>);
  const turned = rotated(p, canvas);
  assert.deepEqual([turned.x, turned.y, turned.w, turned.h, turned.rotation], [6, 0, 2, 6, 90]);
  assert.deepEqual(turned.entrances, [{ side: 'south', offset: 1.5, width: 0.8 }]);
  assert.equal(turned.roomAssets![0].door, 'west');
  assert.equal(checkRotation([p], turned, canvas), null);
  assert.equal(checkRotation([p], rotated(box({ w: 22, h: 2 }), canvas), canvas), 'Not enough space to rotate here');
});

test('reshaping keeps rooms inside the building', () => {
  const p = box({ roomAssets: [{ id: 1, name: 'A', type: 'office', x: 2, y: 0, w: 2, h: 2 }] } as Partial<Piece>);
  assert.equal(checkReshape([p], { ...p, w: 5 }), null);
  assert.match(checkReshape([p], { ...p, w: 3 })!, /Remove rooms/);
});

test('duplicates are offset, renamed and kept on the canvas', () => {
  const copy = duplicated(box({ x: 20 }), 7, canvas);
  assert.deepEqual([copy.id, copy.x, copy.y, copy.name], [7, 20, 3, 'Test copy']);
});

test('entrances must fit the wall and not clash with a door', () => {
  const p = box();
  const first = newEntrance(p, [p], 'north', 1);
  assert.ok('entry' in first);
  assert.deepEqual(newEntrance(p, [p], 'north', 9), { error: 'Entrance must fit on the wall' });
  const withDoor = { ...p, entrances: [{ side: 'north' as const, offset: 1, width: 0.8 }] };
  assert.deepEqual(newEntrance(withDoor, [withDoor], 'north', 1.5), { error: 'There is already a door here' });
});

test('exports describe the project', () => {
  const project = { title: 'Greenfield Hospital', pieces: [box()], network: emptyNetwork(), width: 24, height: 20 };
  const saved = JSON.parse(layoutSnapshot(project));
  assert.deepEqual(saved.grid, { width: 24, height: 20, tileMeters: 2 });
  assert.equal(JSON.parse(layoutJson(project)).version, 1);
  const obj = layoutObj(project.pieces);
  // A box: 8 vertices, floor + roof + 4 walls.
  assert.equal(obj.match(/^v /gm)!.length, 8);
  assert.equal(obj.match(/^f /gm)!.length, 6);
  assert.match(obj, /^v 4 4 0$/m);
  assert.equal(fileName('Greenfield Hospital', 'obj'), 'greenfield-hospital.obj');
});
