import { test } from "node:test";
import assert from "node:assert/strict";
import {
  center,
  corridorDoors,
  corridorEnds,
  doorFits,
  fitsRoom,
  footprint,
  inPolygon,
  outline,
  overlaps,
} from "../src/lib/model/interiors.ts";
import { assets, parseLayout, pieceFrom, type Piece } from "../src/lib/model/layout.ts";
import { walls } from "../src/lib/wayfinding/navigation.ts";
import { buildGrid, places, planRoute } from "../src/lib/wayfinding/routing.ts";

// 8 × 6 L at the origin; the missing quarter is x 4–8, y 0–3.
const L: Piece = { id: 1, name: "L", kind: "flat", shape: "L", x: 0, y: 0, w: 8, h: 6, color: "#ffffff", rotation: 0 };
const path = (x: number, y: number, w: number, h: number): Piece => ({
  id: 2, name: "Path", kind: "path", x, y, w, h, color: "#cfc6b4", rotation: 0,
});

test("an L has six walls, facing outward, with the notch walls inside the bounding box", () => {
  assert.deepEqual(
    outline(L).map((e) => `${e.side}@${e.at} ${e.from}-${e.to}`),
    ["north@0 0-4", "east@4 0-3", "north@3 4-8", "east@8 3-6", "south@6 0-8", "west@0 0-6"],
  );
});

test("rooms and doors must stay on the L's floor", () => {
  const room = { id: 1, name: "Room", type: "exam" as const, x: 4, y: 0, w: 2, h: 2 };
  assert.equal(fitsRoom(L, room), false);
  assert.equal(fitsRoom(L, { ...room, y: 3 }), true);
  assert.equal(doorFits(L, { side: "north", offset: 6, width: 0.8 }), true); // inner north wall
  assert.equal(doorFits(L, { side: "east", offset: 4, width: 0.8 }), true); // outer east wall
  assert.equal(doorFits(L, { side: "east", offset: 2.9, width: 0.8 }), false); // straddles the inner corner
});

test("pieces may use the empty corner of an L, but not its floor", () => {
  assert.equal(overlaps(L, path(5, 1, 3, 1)), false);
  assert.equal(overlaps(L, path(3, 1, 3, 1)), true);
});

test("a path touching an inner wall of the L gets a door, and routes use it", () => {
  const p = path(4, 1, 3, 1);
  assert.deepEqual(corridorDoors(L, [p]), [{ side: "east", offset: 1.5, width: 0.8 }]);
  const segments = walls([L, p]);
  // The inner east wall (x = 4, y 0–3) is split around the door.
  assert.ok(segments.some(([a, b]) => a.x === 4 && b.x === 4 && Math.max(a.y, b.y) === 1.1));
});

test("the label point of an L lies on its floor", () => {
  for (const rotation of [0, 90, 180, 270]) {
    const turned = { ...L, rotation, w: rotation % 180 ? 6 : 8, h: rotation % 180 ? 8 : 6 };
    assert.ok(inPolygon(center(turned), footprint(turned)), `rotation ${rotation}`);
  }
});

test("straight corridors and paths leave their short ends open, however they are turned", () => {
  const long = { ...path(0, 0, 5, 1), kind: "straight" };
  for (const rotation of [0, 90]) {
    const p = rotation ? { ...long, w: 1, h: 5, rotation } : long;
    const poly = footprint(p);
    for (const i of corridorEnds(p)) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length];
      assert.equal(Math.hypot(b.x - a.x, b.y - a.y), 1, `rotation ${rotation} edge ${i}`);
    }
  }
});

test("routes prefer a paved path over walking across the grass", () => {
  const a: Piece = { id: 1, name: "A", kind: "flat", x: 0, y: 4, w: 3, h: 3, color: "#ffffff", rotation: 0 };
  const b: Piece = { ...a, id: 2, name: "B", x: 12, y: 4 };
  // A detour path from A's north wall, over and down to B's north wall.
  const pieces = [a, b, { ...path(1, 1, 1, 3), id: 3 }, { ...path(1, 0, 12, 1), id: 4 }, { ...path(13, 1, 1, 3), id: 5 }];
  const list = places(pieces);
  const route = planRoute(buildGrid(pieces, 16, 8), list.find((p) => p.id === "b:1")!, list.find((p) => p.id === "b:2")!);
  assert.ok(route);
  assert.ok(route!.points.some((p) => p.y < 1), "walks along the path");
  assert.ok(route!.steps.some((s) => s.text.includes("path")));
  assert.equal(buildGrid(pieces, 16, 8).cost[2 * 16 * 4 + 5 * 4], 1.5);
});

test("L-shaped assets place with every room on the floor and survive a save round trip", () => {
  for (const a of assets.filter((a) => a.shape)) {
    const p = pieceFrom(a, { id: 10, x: 1, y: 1 });
    for (const r of p.roomAssets ?? []) assert.ok(fitsRoom(p, r, p.roomAssets), r.name);
    const json = JSON.stringify({ grid: { width: 24, height: 20 }, pieces: [p, pieceFrom(assets.find((a) => a.kind === "path")!, { id: 30, x: 12, y: 12 })] });
    assert.equal(parseLayout(json).pieces[0].shape, "L");
  }
  const bad = JSON.stringify({ grid: { width: 24, height: 20 }, pieces: [{ ...path(1, 1, 2, 1), shape: "L" }] });
  assert.throws(() => parseLayout(bad));
});

test("a piece set up before placing keeps its turn and size, with fresh room ids", async () => {
  const { placedFrom, rotated } = await import("../src/lib/editor/operations.ts");
  const draft = rotated(pieceFrom(assets.find((a) => a.name === "L-shaped day clinic")!, { id: 0, x: 0, y: 0 }), { width: 24, height: 20 });
  const a = placedFrom(draft, 100, { x: 3, y: 4 }),
    b = placedFrom(draft, 200, { x: 12, y: 4 });
  assert.deepEqual([a.x, a.y, a.w, a.h, a.rotation], [3, 4, 6, 8, 90]);
  assert.deepEqual(a.roomAssets!.map((r) => r.id), [101, 102, 103, 104, 105, 106]);
  assert.notDeepEqual(a.roomAssets!.map((r) => r.id), b.roomAssets!.map((r) => r.id));
  for (const r of a.roomAssets!) assert.ok(fitsRoom(a, r, a.roomAssets), r.name);
});

test("a square straight corridor keeps its posts on the sides it is turned to", () => {
  for (const [rotation, openSides] of [[0, "x"], [90, "y"], [180, "x"], [270, "y"]] as const) {
    const p: Piece = { id: 1, name: "C", kind: "straight", x: 0, y: 0, w: 1, h: 1, color: "#ffffff", rotation };
    const poly = footprint(p);
    for (const i of corridorEnds(p)) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length];
      // Open ends are vertical edges (walk along x) at 0°/180°, horizontal ones at 90°/270°.
      assert.equal(openSides === "x" ? a.x === b.x : a.y === b.y, true, `rotation ${rotation}`);
    }
  }
});

test("kerbs and posts leave junctions open where another walkway joins a side", async () => {
  const { exposedRuns } = await import("../src/lib/model/interiors.ts");
  // A 6-tile path along x, with a second path joining its south side at x 2–3.
  const main = { ...path(0, 0, 6, 1), id: 1 },
    branch = { ...path(2, 1, 1, 3), id: 2 };
  const poly = footprint(main);
  const south = poly.findIndex((a, i) => a.y === 1 && poly[(i + 1) % poly.length].y === 1);
  // The south edge runs east to west, so the gap at x 2–3 is 3–4 tiles from its start.
  assert.deepEqual(exposedRuns(main, south, [main, branch]), [[0, 3 / 6], [4 / 6, 1]]);
  const north = poly.findIndex((a, i) => a.y === 0 && poly[(i + 1) % poly.length].y === 0);
  assert.deepEqual(exposedRuns(main, north, [main, branch]), [[0, 1]]);
});
