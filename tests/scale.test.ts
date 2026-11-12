import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSnapshot } from '../src/lib/editor/export.ts';
import { mergeLayouts } from '../src/lib/editor/merge.ts';
import { parseLayout, parseTileMeters, starterPieces } from '../src/lib/model/layout.ts';
import { joinLayout, splitLayout } from '../src/lib/model/records.ts';
import { buildGrid, places, planRoute } from '../src/lib/wayfinding/routing.ts';
import { emptyNetwork } from '../src/lib/wayfinding/navigation.ts';

const project = (tileMeters?: number, width = 24) =>
  ({ title: 'RS Uji', greenery: 1, pieces: structuredClone(starterPieces), network: emptyNetwork(), width, height: 20, tileMeters });

test('the real size of a tile is kept, 2 m unless measured, within sense', () => {
  assert.equal(parseLayout(layoutSnapshot(project())).grid.tileMeters, 2);
  assert.equal(parseLayout(layoutSnapshot(project(3.5))).grid.tileMeters, 3.5);
  assert.equal(parseTileMeters(0.1), 2);
  assert.equal(parseTileMeters(40), 2);
  assert.equal(parseTileMeters('3'), 2);
  // Stored in the database's site row and read back.
  const layout = parseLayout(layoutSnapshot(project(3.5)));
  assert.equal(splitLayout(layout).site.tileMeters, 3.5);
  assert.equal(parseLayout(JSON.stringify(joinLayout(splitLayout(layout)))).grid.tileMeters, 3.5);
});

test('walking distances follow the measured size', () => {
  const list = places(starterPieces),
    [a, b] = [list[0], list[list.length - 1]];
  const drawn = planRoute(buildGrid(starterPieces, 24, 20), a, b)!,
    real = planRoute(buildGrid(starterPieces, 24, 20, 4), a, b)!;
  assert.ok(Math.abs(real.meters - drawn.meters * 2) <= 1, `${real.meters} m is twice ${drawn.meters} m`);
  const steps = (r: typeof real) => r.steps.reduce((m, s) => m + s.meters, 0);
  assert.ok(Math.abs(steps(real) - steps(drawn) * 2) <= real.steps.length, 'and so do the steps');
});

test('one editor resizing the canvas and another measuring the scale are both kept', () => {
  const base = layoutSnapshot(project()),
    { layout, conflicts } = mergeLayouts(base, layoutSnapshot(project(3)), layoutSnapshot(project(undefined, 30)));
  assert.deepEqual(parseLayout(layout).grid, { width: 30, height: 20, tileMeters: 3 });
  assert.deepEqual(conflicts, []);
});
