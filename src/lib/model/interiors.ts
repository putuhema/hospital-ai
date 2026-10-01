import type { Piece } from "./layout.ts";
import type { PlaceInfo } from "./place-info.ts";
export type Side = "north" | "south" | "east" | "west";
export type RoomType =
  | "patient"
  | "exam"
  | "office"
  | "waiting"
  | "reception"
  | "nurse"
  | "toilet"
  | "pharmacy"
  | "lab"
  | "surgery"
  | "stairs"
  | "storage"
  | "radiology"
  | "emergency"
  | "perinatology";
export type RoomAsset = {
  id: number;
  name: string;
  type: RoomType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Wall with the doorway. Defaults to south. */
  door?: Side;
  /** Floor colour override. */
  color?: string;
  /** Description, phone and hours shown to visitors. */
  info?: PlaceInfo;
};
export type Door = {
  side: Side;
  offset: number;
  width: number;
};
export const roomTypes: {
  type: RoomType;
  name: string;
  w: number;
  h: number;
  color: string;
}[] = [
  { type: "patient", name: "Patient room", w: 2, h: 2, color: "#d3e5c5" },
  { type: "exam", name: "Examination room", w: 2, h: 2, color: "#bfd7df" },
  { type: "office", name: "Office", w: 1, h: 2, color: "#dfd2b7" },
  { type: "waiting", name: "Waiting area", w: 2, h: 2, color: "#e8dcc4" },
  { type: "reception", name: "Reception desk", w: 2, h: 1, color: "#e3d6c2" },
  { type: "nurse", name: "Nurse station", w: 2, h: 1, color: "#cfe0d8" },
  { type: "toilet", name: "Toilets", w: 1, h: 1, color: "#d6e3ea" },
  { type: "pharmacy", name: "Pharmacy", w: 2, h: 1, color: "#e5d3dc" },
  { type: "lab", name: "Laboratory", w: 2, h: 2, color: "#d9dcef" },
  { type: "surgery", name: "Operating theatre", w: 3, h: 2, color: "#c6e2e0" },
  { type: "stairs", name: "Stairs & lift", w: 1, h: 2, color: "#d8d6cf" },
  { type: "storage", name: "Storage", w: 1, h: 1, color: "#dcd8cc" },
  { type: "radiology", name: "Radiology", w: 2, h: 2, color: "#d4d9e6" },
  { type: "emergency", name: "Emergency", w: 3, h: 2, color: "#ebd0cb" },
  /** Newborn care (perinatologi): incubators for babies who need watching after birth. */
  { type: "perinatology", name: "Perinatology", w: 3, h: 2, color: "#f1dde2" },
];
export const roomType = (type: string) =>
  roomTypes.find((t) => t.type === type) ?? roomTypes[0];
export const roomColor = (r: RoomAsset) => r.color ?? roomType(r.type).color;
/** Door centre on the room's own outline, in tiles from the room's corner. */
export function roomDoor(r: RoomAsset): Door {
  const side = r.door ?? "south";
  return {
    side,
    offset: (side === "north" || side === "south" ? r.w : r.h) / 2,
    width: 0.4,
  };
}
export const rotateSide = (s: Side): Side =>
  (({ north: "east", east: "south", south: "west", west: "north" }) as const)[s];
export function fitsRoom(b: Piece, r: RoomAsset, others: RoomAsset[] = []) {
  return (
    [r.x, r.y, r.w, r.h].every(Number.isInteger) &&
    r.w > 0 &&
    r.h > 0 &&
    r.x >= 0 &&
    r.y >= 0 &&
    r.x + r.w <= b.w &&
    r.y + r.h <= b.h &&
    // L-shaped buildings: the room must stay out of the cut-away corner.
    (!b.shape || covers(footprint({ ...b, x: 0, y: 0 }), r)) &&
    !others.some(
      (o) =>
        o.id !== r.id &&
        r.x < o.x + o.w &&
        r.x + r.w > o.x &&
        r.y < o.y + o.h &&
        r.y + r.h > o.y,
    )
  );
}
export const corridorKinds = ["straight", "corner", "junction", "cross"];
type Kind = Pick<Piece, "kind">;
export const isCorridor = (p: Kind) => corridorKinds.includes(p.kind);
/** Open-air paved footpath: walkable and gets building doors, but no canopy. */
export const isPath = (p: Kind) => p.kind === "path";
export const isBuilding = (p: Piece) => p.kind === "pitched" || p.kind === "flat";
/** Open-air car or motorcycle park: no building, walkable, and a destination in its own right. */
export const isParking = (p: Kind) => p.kind === "parking" || p.kind === "motorcycle";
export const isMotorcycleParking = (p: Kind) => p.kind === "motorcycle";
/** The campus entrance: a gateway over the drive with the hospital's name on it. */
export const isGate = (p: Kind) => p.kind === "gate";
/** A parking gate: a ticket booth and a barrier arm across the lane. */
export const isBarrier = (p: Kind) => p.kind === "barrier";
/** Open-air ground people walk across: paths, car parks and gateways. */
export const isOpenAir = (p: Kind) => isPath(p) || isParking(p) || isGate(p) || isBarrier(p);
/** Open-air places visitors can search for and be given directions to. */
export const isArea = (p: Kind) => isParking(p) || isGate(p) || isBarrier(p);
/** Gateways are ways in and out: visitors find them as entrances and exits. */
export const isGateway = (p: Kind) => isGate(p) || isBarrier(p);
/** What a piece is, in words, for the editor. */
export const pieceType = (p: Kind) =>
  isCorridor(p)
    ? "Corridor"
    : isPath(p)
      ? "Path"
      : isMotorcycleParking(p)
        ? "Motorcycle parking"
        : isParking(p)
          ? "Car park"
          : isGate(p)
            ? "Campus entrance"
            : isBarrier(p)
              ? "Parking gate"
              : "Building";

/**
 * Bays in tiles: a car's is 2.5 × 5 m (1.25 × 2.5 tiles), a motorcycle's
 * 1 × 2 m (0.5 × 1 tile).
 */
const bayOf = (p: Kind) => (isMotorcycleParking(p) ? { width: 0.5, depth: 1, aisle: 0.75 } : { width: 1.25, depth: 2.5, aisle: 1.5 });
/**
 * Painted bays of a car park, in tiles: one row along its length, or two
 * facing an aisle when it is deep enough. `lines` are the painted markings;
 * each bay has its centre and which row it is in (0 along the top or left).
 */
export function parkingBays(p: Piece) {
  const { width: BAY, depth: BAY_DEPTH, aisle: AISLE } = bayOf(p),
    alongX = p.w >= p.h,
    length = alongX ? p.w : p.h,
    depth = alongX ? p.h : p.w,
    count = Math.max(1, Math.floor((length - 0.2) / BAY)),
    start = (length - count * BAY) / 2,
    bayDepth = Math.min(BAY_DEPTH, depth * 0.62),
    rows = depth >= BAY_DEPTH * 2 + AISLE ? 2 : 1;
  // Local (u along the row, v across it) to tiles.
  const at = (u: number, v: number) => (alongX ? { x: p.x + u, y: p.y + v } : { x: p.x + v, y: p.y + u });
  const lines: [{ x: number; y: number }, { x: number; y: number }][] = [],
    bays: { x: number; y: number; row: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const v0 = row ? depth - bayDepth : 0,
      kerb = row ? depth - 0.08 : 0.08,
      aisle = row ? v0 : bayDepth;
    for (let i = 0; i <= count; i++) lines.push([at(start + i * BAY, kerb), at(start + i * BAY, aisle)]);
    lines.push([at(start, aisle), at(start + count * BAY, aisle)]);
    for (let i = 0; i < count; i++) bays.push({ ...at(start + (i + 0.5) * BAY, v0 + bayDepth / 2), row });
  }
  return { alongX, bayDepth, lines, bays };
}

type Point = { x: number; y: number };
type Rect = Point & { w: number; h: number };
/**
 * The fixed parts of a gateway, in tiles. Traffic crosses its short side.
 * A campus entrance has a pillar at each end of its long side (`blocks`) and
 * a beam between them (`span`); a parking gate has a ticket booth at one end,
 * the far end once turned past 180°, and a barrier arm across the rest.
 */
export function gatewayParts(p: Piece): { alongX: boolean; blocks: Rect[]; span: [Point, Point] } {
  const alongX = p.w >= p.h,
    length = alongX ? p.w : p.h,
    depth = alongX ? p.h : p.w,
    mid = depth / 2;
  const rect = (u: number, v: number, du: number, dv: number): Rect =>
    alongX ? { x: p.x + u, y: p.y + v, w: du, h: dv } : { x: p.x + v, y: p.y + u, w: dv, h: du };
  const at = (u: number, v: number) => (alongX ? { x: p.x + u, y: p.y + v } : { x: p.x + v, y: p.y + u });
  if (isGate(p)) {
    const s = Math.min(0.45, length / 6);
    return {
      alongX,
      blocks: [rect(0, mid - s / 2, s, s), rect(length - s, mid - s / 2, s, s)],
      span: [at(s, mid), at(length - s, mid)],
    };
  }
  // A 1.4 × 1.6 m booth on a kerbed island, where the lane allows.
  const island = Math.min(0.95, length / 3),
    far = p.rotation >= 180,
    from = far ? length - island : 0,
    half = Math.min(0.4, depth * 0.4);
  return {
    alongX,
    blocks: [rect(from + 0.125, mid - half, island - 0.25, half * 2)],
    span: far ? [at(length - island, mid), at(0.1, mid)] : [at(island, mid), at(length - 0.1, mid)],
  };
}
const shapes: Record<string, number[][]> = {
  corner: [[0, 0], [0.5, 0], [0.5, 0.5], [1, 0.5], [1, 1], [0, 1]],
  junction: [[0, 0], [1, 0], [1, 0.5], [2 / 3, 0.5], [2 / 3, 1], [1 / 3, 1], [1 / 3, 0.5], [0, 0.5]],
  cross: [[1 / 3, 0], [2 / 3, 0], [2 / 3, 1 / 3], [1, 1 / 3], [1, 2 / 3], [2 / 3, 2 / 3], [2 / 3, 1], [1 / 3, 1], [1 / 3, 2 / 3], [0, 2 / 3], [0, 1 / 3], [1 / 3, 1 / 3]],
};
/** Outline edges that are open corridor ends, by shape (straight is decided by its length). */
const openEnds: Record<string, number[]> = {
  corner: [0, 3],
  junction: [1, 4, 7],
  cross: [0, 3, 6, 9],
};
/** Buildings share the corner corridor's L outline when `shape` is "L". */
const shapeOf = (p: Piece) => (p.shape === "L" ? "corner" : p.kind);
/** Outline of a piece in tile coordinates, with rotation applied. */
export function footprint(p: Piece): { x: number; y: number }[] {
  return (shapes[shapeOf(p)] ?? [[0, 0], [1, 0], [1, 1], [0, 1]]).map(([x, y]) => {
    for (let i = 0; i < p.rotation / 90; i++) [x, y] = [1 - y, x];
    return { x: p.x + x * p.w, y: p.y + y * p.h };
  });
}
/** Indices of the footprint edges (from point i to i + 1) left open at corridor and path ends. */
export function corridorEnds(p: Piece): number[] {
  if (p.kind === "straight" || isPath(p)) {
    // It runs along its long side; a square piece runs the way it is turned.
    const alongX = p.w !== p.h ? p.w > p.h : p.rotation % 180 === 0;
    // Rectangle edges alternate horizontal / vertical; the ends cross the run.
    const firstHorizontal = Math.abs(footprint(p)[0].y - footprint(p)[1].y) < 1e-9;
    return alongX === firstHorizontal ? [1, 3] : [0, 2];
  }
  return openEnds[p.kind] ?? [];
}
export function inPolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
/**
 * The stretches of footprint edge `i` (from point i to i + 1) that face open
 * ground, as fractions along the edge. Where another corridor or path joins
 * this side, it is left out, so posts and kerbs don't block the junction.
 */
export function exposedRuns(p: Piece, i: number, pieces: Piece[]): [number, number][] {
  const poly = footprint(p),
    a = poly[i],
    b = poly[(i + 1) % poly.length],
    length = Math.hypot(b.x - a.x, b.y - a.y);
  let area = 0;
  for (let k = 0; k < poly.length; k++) {
    const c = poly[k],
      d = poly[(k + 1) % poly.length];
    area += c.x * d.y - d.x * c.y;
  }
  // Outward normal: left of travel on a clockwise (y-down) outline.
  const out = area > 0 ? 1 : -1,
    nx = ((b.y - a.y) / length) * out,
    ny = (-(b.x - a.x) / length) * out;
  const others = pieces.filter((o) => o.id !== p.id && (isCorridor(o) || isOpenAir(o))).map(footprint);
  const steps = Math.max(1, Math.round(length / 0.25)),
    runs: [number, number][] = [];
  for (let k = 0; k < steps; k++) {
    const t = (k + 0.5) / steps,
      probe = { x: a.x + (b.x - a.x) * t + nx * 0.1, y: a.y + (b.y - a.y) * t + ny * 0.1 };
    if (others.some((o) => inPolygon(probe, o))) continue;
    const last = runs[runs.length - 1];
    if (last && Math.abs(last[1] - k / steps) < 1e-9) last[1] = (k + 1) / steps;
    else runs.push([k / steps, (k + 1) / steps]);
  }
  return runs;
}
/** The corridor or open-air ground under a point (in tiles), if any: places people can stand outside rooms. */
export const walkwayAt = (pieces: Piece[], point: { x: number; y: number }) =>
  pieces.find((p) => (isCorridor(p) || isOpenAir(p)) && inPolygon(point, footprint(p)));
/** Sample points on a quarter-tile lattice, so half-tile notches are resolved. */
function* samples(x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0 + 0.125; y < y1; y += 0.25)
    for (let x = x0 + 0.125; x < x1; x += 0.25) yield { x, y };
}
/** True when the polygon covers the whole rectangle. */
function covers(poly: { x: number; y: number }[], r: { x: number; y: number; w: number; h: number }) {
  for (const s of samples(r.x, r.y, r.x + r.w, r.y + r.h)) if (!inPolygon(s, poly)) return false;
  return true;
}
/** True when two pieces' actual footprints share any floor area. */
export function overlaps(a: Piece, b: Piece) {
  const x0 = Math.max(a.x, b.x),
    y0 = Math.max(a.y, b.y),
    x1 = Math.min(a.x + a.w, b.x + b.w),
    y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x0 >= x1 || y0 >= y1) return false;
  const pa = footprint(a),
    pb = footprint(b);
  for (const s of samples(x0, y0, x1, y1)) if (inPolygon(s, pa) && inPolygon(s, pb)) return true;
  return false;
}
/** A point inside the piece, for labels and route targets (the centroid of an L lies in the L). */
export function center(p: Piece) {
  if (!p.shape) return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  const poly = footprint(p);
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const { x: x0, y: y0 } = poly[i],
      { x: x1, y: y1 } = poly[(i + 1) % poly.length],
      k = x0 * y1 - x1 * y0;
    a += k;
    cx += (x0 + x1) * k;
    cy += (y0 + y1) * k;
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}
/**
 * The building's walls as axis-aligned edges in its own tile coordinates.
 * `side` is the way the wall faces, `at` its line (y for north/south, x for
 * east/west) and `from`–`to` its extent along the other axis. Doors keep
 * using side + offset: edges facing the same way never overlap in extent.
 */
export type Edge = { side: Side; at: number; from: number; to: number };
export function outline(b: Piece): Edge[] {
  const poly = footprint({ ...b, x: 0, y: 0 });
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      c = poly[(i + 1) % poly.length];
    area += a.x * c.y - c.x * a.y;
  }
  // Positive area: clockwise on screen (y down), so outward is to the left of travel.
  const cw = area > 0;
  return poly.map((a, i): Edge => {
    const c = poly[(i + 1) % poly.length];
    if (Math.abs(a.y - c.y) < 1e-9) {
      const east = c.x > a.x;
      return { side: east === cw ? "north" : "south", at: a.y, from: Math.min(a.x, c.x), to: Math.max(a.x, c.x) };
    }
    const south = c.y > a.y;
    return { side: south === cw ? "east" : "west", at: a.x, from: Math.min(a.y, c.y), to: Math.max(a.y, c.y) };
  });
}
/** The wall a door sits on. */
export const doorEdge = (b: Piece, d: Door) =>
  outline(b).find((e) => e.side === d.side && d.offset >= e.from - 1e-6 && d.offset <= e.to + 1e-6);
/** True when a door of this width fits on one of the building's walls. */
export const doorFits = (b: Piece, d: Door) => {
  const e = doorEdge(b, d);
  return !!e && d.offset - d.width / 2 >= e.from - 1e-6 && d.offset + d.width / 2 <= e.to + 1e-6;
};
/** A door's opening as a segment in campus tile coordinates. */
export function doorSegment(b: Piece, d: Door) {
  const at = doorEdge(b, d)?.at ?? 0,
    horizontal = d.side === "north" || d.side === "south";
  const point = (v: number) =>
    horizontal ? { x: b.x + v, y: b.y + at } : { x: b.x + at, y: b.y + v };
  return [point(d.offset - d.width / 2), point(d.offset + d.width / 2)] as const;
}
export function corridorDoors(b: Piece, pieces: Piece[]): Door[] {
  const doors: Door[] = [];
  const walls = outline(b);
  for (const p of pieces) {
    if (!isCorridor(p) && !isPath(p)) continue;
    const poly = footprint(p);
    for (let i = 0; i < poly.length; i++) {
      const { x, y } = poly[i],
        { x: xx, y: yy } = poly[(i + 1) % poly.length];
      const horizontal = Math.abs(y - yy) < 1e-6;
      if (!horizontal && Math.abs(x - xx) > 1e-6) continue;
      for (const w of walls) {
        if (horizontal !== (w.side === "north" || w.side === "south")) continue;
        const line = (horizontal ? b.y : b.x) + w.at;
        if (Math.abs((horizontal ? y : x) - line) > 1e-6) continue;
        // The corridor has to lie on the outside of this wall.
        const outside =
          w.side === "north"
            ? p.y + p.h <= line + 1e-6
            : w.side === "south"
              ? p.y >= line - 1e-6
              : w.side === "west"
                ? p.x + p.w <= line + 1e-6
                : p.x >= line - 1e-6;
        if (!outside) continue;
        const base = horizontal ? b.x : b.y,
          start = Math.max(base + w.from, Math.min(horizontal ? x : y, horizontal ? xx : yy)),
          end = Math.min(base + w.to, Math.max(horizontal ? x : y, horizontal ? xx : yy));
        if (end - start < 0.5) continue;
        const offset = (start + end) / 2 - base;
        if (!doors.some((d) => d.side === w.side && Math.abs(d.offset - offset) < 0.5))
          doors.push({ side: w.side, offset, width: Math.min(0.8, end - start - 0.1) });
      }
    }
  }
  return doors;
}
