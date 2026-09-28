import type { Piece } from "../model/layout.ts";
import { corridorDoors, outline, roomDoor, type Door } from "../model/interiors.ts";
import { parseInfo, type PlaceInfo } from "../model/place-info.ts";

export type Point = { x: number; y: number };
export type Waypoint = Point & { id: string; name: string; info?: PlaceInfo };
export type WalkingNetwork = {
  nodes: Waypoint[];
  edges: { from: string; to: string }[];
};
export const emptyNetwork = (): WalkingNetwork => ({ nodes: [], edges: [] });
const EPS = 1e-7;
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const sub = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
export function project(p: Point, a: Point, b: Point): Point {
  const d = sub(b, a),
    length = d.x * d.x + d.y * d.y;
  const t = length
    ? Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / length))
    : 0;
  return { x: a.x + t * d.x, y: a.y + t * d.y };
}
export function parseNetwork(
  value: unknown,
  width: number,
  height: number,
): WalkingNetwork {
  if (value === undefined) return emptyNetwork();
  const n = value as WalkingNetwork;
  if (
    !n ||
    !Array.isArray(n.nodes) ||
    !Array.isArray(n.edges) ||
    n.nodes.length > 2000 ||
    n.edges.length > 4000
  )
    throw Error("Invalid walking network");
  const ids = new Set<string>();
  for (const p of n.nodes) {
    if (
      !p ||
      typeof p.id !== "string" ||
      !p.id ||
      ids.has(p.id) ||
      typeof p.name !== "string" ||
      p.name.length > 100 ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      p.x < 0 ||
      p.y < 0 ||
      p.x > width ||
      p.y > height
    )
      throw Error("Invalid waypoint");
    ids.add(p.id);
  }
  const edges = new Set<string>();
  for (const e of n.edges) {
    if (!e || !ids.has(e.from) || !ids.has(e.to) || e.from === e.to)
      throw Error("Invalid walking path");
    const key = [e.from, e.to].sort().join("\0");
    if (edges.has(key)) throw Error("Duplicate walking path");
    edges.add(key);
  }
  return {
    nodes: n.nodes.map((p) => {
      const info = parseInfo(p.info);
      return { id: p.id, name: p.name, x: p.x, y: p.y, ...(info && { info }) };
    }),
    edges: n.edges.map((e) => ({ from: e.from, to: e.to })),
  };
}

export function buildingDoors(p: Piece, pieces: Piece[]): Door[] {
  const doors = corridorDoors(p, pieces);
  for (const e of p.entrances ?? [])
    if (
      !doors.some(
        (d) =>
          d.side === e.side &&
          Math.abs(d.offset - e.offset) < (d.width + e.width) / 2,
      )
    )
      doors.push(e);
  if (doors.length) return doors;
  // No corridor or entrance yet: a default door in the middle of the first wall.
  const wall = outline(p)[0];
  return [{ side: wall.side, offset: (wall.from + wall.to) / 2, width: 0.8 }];
}
type Segment = [Point, Point];
/** Every wall segment on the campus: building shells and room partitions, minus door openings. */
export function walls(pieces: Piece[]): Segment[] {
  const out: Segment[] = [];
  function rectangle(
    x: number,
    y: number,
    w: number,
    h: number,
    doors: Door[],
  ) {
    for (const side of ["north", "south", "west", "east"] as const) {
      const horizontal = side === "north" || side === "south",
        length = horizontal ? w : h;
      const point = (v: number) =>
        horizontal
          ? { x: x + v, y: y + (side === "south" ? h : 0) }
          : { x: x + (side === "east" ? w : 0), y: y + v };
      let cursor = 0;
      for (const d of doors
        .filter((d) => d.side === side)
        .sort((a, b) => a.offset - b.offset)) {
        const left = Math.max(0, d.offset - d.width / 2),
          right = Math.min(length, d.offset + d.width / 2);
        if (left > cursor) out.push([point(cursor), point(left)]);
        cursor = Math.max(cursor, right);
      }
      if (cursor < length) out.push([point(cursor), point(length)]);
    }
  }
  for (const p of pieces.filter((p) => ["pitched", "flat"].includes(p.kind))) {
    const doors = buildingDoors(p, pieces);
    for (const e of outline(p)) {
      const horizontal = e.side === "north" || e.side === "south";
      const point = (v: number) =>
        horizontal ? { x: p.x + v, y: p.y + e.at } : { x: p.x + e.at, y: p.y + v };
      let cursor = e.from;
      for (const d of doors
        .filter((d) => d.side === e.side && d.offset >= e.from && d.offset <= e.to)
        .sort((a, b) => a.offset - b.offset)) {
        const left = Math.max(e.from, d.offset - d.width / 2),
          right = Math.min(e.to, d.offset + d.width / 2);
        if (left > cursor) out.push([point(cursor), point(left)]);
        cursor = Math.max(cursor, right);
      }
      if (cursor < e.to) out.push([point(cursor), point(e.to)]);
    }
    for (const r of p.roomAssets ?? [])
      rectangle(p.x + r.x + 0.04, p.y + r.y + 0.04, r.w - 0.08, r.h - 0.08, [
        { ...roomDoor(r), offset: roomDoor(r).offset - 0.04 },
      ]);
  }
  return out;
}
export function crosses(a: Point, b: Point, [p, q]: Segment): boolean {
  const d = sub(b, a),
    v = sub(q, p),
    den = cross(d, v);
  if (Math.abs(den) < EPS) {
    if (Math.abs(cross(sub(p, a), d)) > EPS) return false;
    return (
      distance(project(p, a, b), p) < EPS ||
      distance(project(q, a, b), q) < EPS ||
      distance(project(a, p, q), a) < EPS
    );
  }
  const t = cross(sub(p, a), v) / den,
    u = cross(sub(p, a), d) / den;
  return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS;
}
/** True when a straight walk from a to b passes only through openings. */
export function walkable(
  a: Point,
  b: Point,
  pieces: Piece[],
  segments = walls(pieces),
): boolean {
  return !segments.some((w) => crosses(a, b, w));
}
