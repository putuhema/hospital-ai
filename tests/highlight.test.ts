import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightShape } from '../src/lib/scene/highlight.ts';
import { assets, pieceFrom, starterPieces } from '../src/lib/model/layout.ts';
import { places } from '../src/lib/wayfinding/routing.ts';

const list = places(starterPieces);
const place = (name: string) => list.find((p) => p.name === name)!;

test('a building is outlined by its footprint', () => {
  const shape = highlightShape(starterPieces, place('Main reception'))!;
  assert.deepEqual(shape.polygon, [{ x: 10, y: 14 }, { x: 14, y: 14 }, { x: 14, y: 16 }, { x: 10, y: 16 }]);
  assert.deepEqual(shape.centre, { x: 12, y: 15 });
  assert.equal(shape.room, false);
  // An L-shaped building keeps its six corners.
  const l = pieceFrom(assets.find((a) => a.shape === 'L')!, { id: 50, x: 2, y: 2 });
  assert.equal(highlightShape([l], { pieceId: 50, point: { x: 0, y: 0 } })!.polygon.length, 6);
});

test('a room is outlined by its own rectangle, inside its building', () => {
  const shape = highlightShape(starterPieces, place('Laboratory'))!;
  assert.deepEqual(shape.polygon, [{ x: 16, y: 12 }, { x: 18, y: 12 }, { x: 18, y: 13 }, { x: 16, y: 13 }]);
  assert.deepEqual(shape.centre, { x: 17, y: 12.5 });
  assert.equal(shape.room, true);
});

test('a landmark gets a small square around its spot; a removed place gets none', () => {
  const shape = highlightShape([], { point: { x: 5, y: 5 } })!;
  assert.equal(shape.polygon.length, 4);
  assert.deepEqual(shape.centre, { x: 5, y: 5 });
  assert.equal(highlightShape([], { pieceId: 404, point: { x: 0, y: 0 } }), null);
});
