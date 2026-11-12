import type { Piece } from "../model/layout.ts";
import { center as centerPoint, doorSegment, footprint, inPolygon, isArea, isBuilding, isCorridor, isGateway, isOpenAir, isPath, roomDoor, roomTypes } from "../model/interiors.ts";
import type { PlaceInfo } from "../model/place-info.ts";
import { category, type LandmarkCategory } from "../model/categories.ts";
import { search as searchText } from "./search.ts";
import type { Lang } from "../i18n/lang.ts";
import {
  buildingDoors,
  crosses,
  distance,
  walls,
  type Point,
  type WalkingNetwork,
} from "./navigation.ts";

// Routes are generated from the layout itself: buildings, corridors, doors and
// room partitions. Nobody has to draw walking paths by hand.

export type Place = {
  id: string;
  name: string;
  /** An area is an open-air destination drawn on the layout, e.g. a car park. */
  kind: "building" | "room" | "listed" | "landmark" | "area";
  /** Name of the building that contains this place. */
  building?: string;
  detail: string;
  pieceId?: number;
  roomId?: number;
  /** A landmark's or area's kind, e.g. parking; `detail` holds its name. */
  category?: LandmarkCategory;
  point: Point;
  info?: PlaceInfo;
};
export type Heading = "east" | "south-east" | "south" | "south-west" | "west" | "north-west" | "north" | "north-east";
export type Turn = "straight" | "bear-left" | "bear-right" | "left" | "right" | "around";
/** What a stretch passes through on the way. */
export type Via = "corridor" | "path" | "grounds";
/** Where a step leads: one of the walkways, or a named room, building or area. */
export type Area = { walkway: "corridor" | "path" | "outside" } | { name: string };
/** What a step means, so it can be put into words in either language (see `stepText`). */
/**
 * `by`: a place the visitor sees at the turn (e.g. "Turn right by the Pharmacy");
 * `past`: one they pass on a long stretch, so they know they are on the way.
 */
export type StepSay =
  | { kind: "start"; from: string | null; heading: Heading; through?: Via; into?: Area; past?: string }
  | { kind: "turn"; turn: Turn; through?: Via; into?: Area; by?: string; past?: string }
  | { kind: "arrive"; place: string; building?: string; listed?: boolean };
/** One instruction; `text` is the English wording, `at` the route point it starts from. */
export type Step = { text: string; meters: number; say: StepSay; at: number };
export type Route = { points: Point[]; meters: number; steps: Step[] };

/** Cells per tile. Fine enough that 0.4-tile room doors contain cell centres. */
const RES = 4;
const INDOOR = 1,
  /** Paved paths are outside, but still preferred over walking across the grass. */
  PATH = 1.5,
  OUTDOOR = 3;

const roomLabel = (type: string) =>
  roomTypes.find((t) => t.type === type)?.name ?? "Room";

/** Every searchable destination, generated from the layout. */
export function places(pieces: Piece[], network?: WalkingNetwork): Place[] {
  const out: Place[] = [];
  for (const p of pieces.filter(isBuilding)) {
    const center = centerPoint(p);
    out.push({
      id: `b:${p.id}`,
      name: p.name,
      kind: "building",
      detail: "Building",
      pieceId: p.id,
      point: center,
      info: p.info,
    });
    for (const r of p.roomAssets ?? [])
      out.push({
        id: `r:${p.id}:${r.id}`,
        name: r.name,
        kind: "room",
        building: p.name,
        detail: roomLabel(r.type),
        pieceId: p.id,
        roomId: r.id,
        point: { x: p.x + r.x + r.w / 2, y: p.y + r.y + r.h / 2 },
        info: r.info,
      });
    (p.rooms ?? []).forEach((name, i) =>
      out.push({
        id: `l:${p.id}:${i}`,
        name,
        kind: "listed",
        building: p.name,
        detail: "Listed room",
        pieceId: p.id,
        point: center,
      }),
    );
  }
  for (const p of pieces.filter(isArea))
    out.push({
      id: `a:${p.id}`,
      name: p.name,
      kind: "area",
      detail: category(isGateway(p) ? "entrance" : "parking").name,
      category: isGateway(p) ? "entrance" : "parking",
      pieceId: p.id,
      point: centerPoint(p),
      info: p.info,
    });
  for (const n of network?.nodes ?? [])
    if (n.name.trim())
      out.push({
        id: `n:${n.id}`,
        name: n.name,
        kind: "landmark",
        detail: category(n.category).name,
        ...(n.category && { category: n.category }),
        point: { x: n.x, y: n.y },
        info: n.info,
      });
  return out;
}

/** Places matching a search, best first; see search.ts. */
export const searchPlaces = (list: Place[], query: string): Place[] =>
  searchText(list, query).map((m) => m.place);

export type NavGrid = {
  cols: number;
  rows: number;
  cost: Float32Array;
  /** Wall between cell i and its east neighbour. */
  eastWall: Uint8Array;
  /** Wall between cell i and its south neighbour. */
  southWall: Uint8Array;
  walls: [Point, Point][];
  pieces: Piece[];
  /** Real metres per tile, for walking distances (the map itself is drawn at 2). */
  tileMeters: number;
  /** Named spots a visitor can see on the way, for directions by landmark. */
  marks: Mark[];
};

/**
 * Something with a name a visitor sees from the walkway: a room's door or a
 * named waypoint. `point` is where it is; a door is seen from just outside it.
 */
export type Mark = { name: string; point: Point; rank: number };

/** Room types people look out for; the rest still count, ranked lower. */
const NOTICED = ["reception", "pharmacy", "toilet", "waiting", "emergency", "stairs", "radiology", "lab", "nurse"];

/** Nudges a point on a wall to just outside it, on the side the wall faces. */
const outside = (p: Point, side: "north" | "south" | "east" | "west", by = 0.15) =>
  side === "north" ? { x: p.x, y: p.y - by } : side === "south" ? { x: p.x, y: p.y + by } : side === "west" ? { x: p.x - by, y: p.y } : { x: p.x + by, y: p.y };

/**
 * Named waypoints (best known: they were named to be found), buildings' doors
 * (they carry name boards) and the doors of the rooms inside.
 */
export function marksOf(pieces: Piece[], landmarks: { name: string; x: number; y: number }[] = []): Mark[] {
  const marks: Mark[] = landmarks.filter((n) => n.name.trim()).map((n) => ({ name: n.name, point: { x: n.x, y: n.y }, rank: 0 }));
  for (const b of pieces.filter(isBuilding)) {
    for (const d of buildingDoors(b, pieces)) {
      const [a, c] = doorSegment(b, d);
      marks.push({ name: b.name, point: outside({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }, d.side), rank: 1 });
    }
    for (const r of b.roomAssets ?? []) {
      const d = roomDoor(r),
        x = b.x + r.x,
        y = b.y + r.y;
      // Just outside the doorway, on the walkway side, so it is seen through the opening.
      const point = outside(
        d.side === "north"
          ? { x: x + d.offset, y }
          : d.side === "south"
            ? { x: x + d.offset, y: y + r.h }
            : d.side === "west"
              ? { x, y: y + d.offset }
              : { x: x + r.w, y: y + d.offset },
        d.side,
      );
      marks.push({ name: r.name, point, rank: NOTICED.includes(r.type) ? 1 : 2 });
    }
  }
  return marks;
}

/** Metres from a turn within which a place in sight counts as "at" it. */
const NEAR = 7;
/** Metres from the way within which a place in sight counts as passed. */
const ALONG = 4;

/** Distance (tiles) from `p` to the segment a–b, and how far along it (0–1) the nearest point is. */
function toSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return { gap: Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y), t };
}

/**
 * Name what a visitor sees on the way: the place at each turn, and on long
 * stretches one they pass halfway, best known first, and only what is in
 * sight (no wall between). Never the start or the destination, nor the place
 * a step leads into (it is named already), and no place twice.
 */
function addLandmarks(
  steps: { say: StepSay; meters: number; at: number }[],
  points: Point[],
  g: Pick<NavGrid, "marks" | "walls" | "tileMeters">,
  skip: string[],
) {
  const { marks, walls, tileMeters } = g;
  const used = new Set(skip),
    near = NEAR / tileMeters,
    along = ALONG / tileMeters,
    inSight = (from: Point, m: Mark) => !walls.some((w) => crosses(from, m.point, w));
  const best = (fits: (m: Mark) => number | null) => {
    let found: { mark: Mark; score: number } | null = null;
    for (const m of marks) {
      if (used.has(m.name)) continue;
      const gap = fits(m);
      if (gap === null) continue;
      const score = m.rank * 2 + gap;
      if (!found || score < found.score) found = { mark: m, score };
    }
    if (found) used.add(found.mark.name);
    return found?.mark.name;
  };
  steps.forEach((step, i) => {
    const say = step.say;
    if (say.kind === "arrive") return;
    const into = say.into && "name" in say.into ? say.into.name : null;
    if (into) used.add(into);
    if (say.kind === "turn") {
      const corner = points[step.at];
      const by = best((m) => {
        const gap = distance(m.point, corner);
        return gap <= near && inSight(corner, m) ? gap : null;
      });
      if (by) say.by = by;
    }
    if (step.meters < 10) return;
    // Passed around the middle of the stretch, not at either end (those are turns).
    const end = steps[i + 1]?.at ?? points.length - 1;
    const past = best((m) => {
      let nearest: number | null = null;
      for (let k = step.at + 1; k <= end; k++) {
        const a = points[k - 1],
          b = points[k],
          { gap, t } = toSegment(m.point, a, b);
        const ends = (k === step.at + 1 && t < 0.25) || (k === end && t > 0.75);
        if (gap > along || ends || (nearest !== null && gap >= nearest)) continue;
        if (inSight({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, m)) nearest = gap;
      }
      return nearest;
    });
    if (past) say.past = past;
  });
}

export function buildGrid(
  pieces: Piece[],
  width: number,
  height: number,
  tileMeters = 2,
  /** Named waypoints, for directions by landmark. */
  landmarks: { name: string; x: number; y: number }[] = [],
): NavGrid {
  const cols = width * RES,
    rows = height * RES,
    cost = new Float32Array(cols * rows).fill(OUTDOOR),
    eastWall = new Uint8Array(cols * rows),
    southWall = new Uint8Array(cols * rows),
    segments = walls(pieces);
  for (const p of pieces) {
    const poly = footprint(p);
    for (let j = p.y * RES; j < (p.y + p.h) * RES && j < rows; j++)
      for (let i = p.x * RES; i < (p.x + p.w) * RES && i < cols; i++)
        if (
          (isBuilding(p) && !p.shape) ||
          inPolygon({ x: (i + 0.5) / RES, y: (j + 0.5) / RES }, poly)
        )
          cost[j * cols + i] = isOpenAir(p) ? PATH : INDOOR;
  }
  // Walls are axis-aligned, so each one blocks a run of neighbouring cell pairs.
  for (const [a, b] of segments) {
    if (Math.abs(a.y - b.y) < 1e-9) {
      const j = Math.floor(a.y * RES - 0.5);
      if (j < 0 || j >= rows - 1) continue;
      const from = Math.max(0, Math.ceil(Math.min(a.x, b.x) * RES - 0.5)),
        to = Math.min(cols - 1, Math.floor(Math.max(a.x, b.x) * RES - 0.5));
      for (let i = from; i <= to; i++) southWall[j * cols + i] = 1;
    } else {
      const i = Math.floor(a.x * RES - 0.5);
      if (i < 0 || i >= cols - 1) continue;
      const from = Math.max(0, Math.ceil(Math.min(a.y, b.y) * RES - 0.5)),
        to = Math.min(rows - 1, Math.floor(Math.max(a.y, b.y) * RES - 0.5));
      for (let j = from; j <= to; j++) eastWall[j * cols + i] = 1;
    }
  }
  return { cols, rows, cost, eastWall, southWall, walls: segments, pieces, tileMeters, marks: marksOf(pieces, landmarks) };
}

const cellAt = (g: NavGrid, p: Point) =>
  Math.min(g.rows - 1, Math.max(0, Math.floor(p.y * RES))) * g.cols +
  Math.min(g.cols - 1, Math.max(0, Math.floor(p.x * RES)));
const centerOf = (g: NavGrid, c: number): Point => ({
  x: ((c % g.cols) + 0.5) / RES,
  y: (Math.floor(c / g.cols) + 0.5) / RES,
});

function open(g: NavGrid, c: number, di: number, dj: number) {
  const i = c % g.cols,
    j = Math.floor(c / g.cols);
  if (i + di < 0 || i + di >= g.cols || j + dj < 0 || j + dj >= g.rows)
    return false;
  if (di === 1) return !g.eastWall[c];
  if (di === -1) return !g.eastWall[c - 1];
  if (dj === 1) return !g.southWall[c];
  return !g.southWall[c - g.cols];
}
const moves = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
function* neighbours(g: NavGrid, c: number) {
  for (const [di, dj] of moves) {
    if (di && dj) {
      // Diagonals only when both L-shaped detours are open, so corners can't be cut.
      if (
        !open(g, c, di, 0) ||
        !open(g, c + di, 0, dj) ||
        !open(g, c, 0, dj) ||
        !open(g, c + dj * g.cols, di, 0)
      )
        continue;
    } else if (!open(g, c, di, dj)) continue;
    yield [c + dj * g.cols + di, di && dj ? Math.SQRT2 : 1] as const;
  }
}

/** Grid cells that count as "being at" a place. */
function cellsFor(g: NavGrid, target: Place | Point): number[] {
  const place = "id" in target ? target : null;
  const piece = g.pieces.find((p) => p.id === place?.pieceId);
  if (!place || place.kind === "landmark" || !piece)
    return [cellAt(g, place?.point ?? (target as Point))];
  const rooms = piece.roomAssets ?? [];
  const area =
    place.kind === "room" ? rooms.find((r) => r.id === place.roomId) : null;
  const cells: number[] = [];
  const outline = area ? null : footprint(piece);
  const x0 = piece.x + (area?.x ?? 0),
    y0 = piece.y + (area?.y ?? 0);
  for (let j = y0 * RES; j < (y0 + (area?.h ?? piece.h)) * RES; j++)
    for (let i = x0 * RES; i < (x0 + (area?.w ?? piece.w)) * RES; i++) {
      const tx = (i + 0.5) / RES - piece.x,
        ty = (j + 0.5) / RES - piece.y;
      // A building's own cells exclude the inside of its rooms (and an L's missing corner).
      if (
        outline &&
        piece.shape &&
        !inPolygon({ x: (i + 0.5) / RES, y: (j + 0.5) / RES }, outline)
      )
        continue;
      if (
        !area &&
        rooms.some(
          (r) => tx > r.x && tx < r.x + r.w && ty > r.y && ty < r.y + r.h,
        )
      )
        continue;
      if (i < g.cols && j < g.rows) cells.push(j * g.cols + i);
    }
  return cells;
}

/** Multi-source Dijkstra over the grid. Returns the cell path, or null. */
function search(g: NavGrid, sources: number[], targets: Set<number>) {
  const dist = new Float64Array(g.cols * g.rows).fill(Infinity),
    prev = new Int32Array(g.cols * g.rows).fill(-1),
    heap: [number, number][] = [];
  const push = (item: [number, number]) => {
    heap.push(item);
    for (let k = heap.length - 1; k > 0; ) {
      const parent = (k - 1) >> 1;
      if (heap[parent][0] <= heap[k][0]) break;
      [heap[parent], heap[k]] = [heap[k], heap[parent]];
      k = parent;
    }
  };
  const pop = () => {
    const top = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ; ) {
        const l = 2 * k + 1,
          r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  for (const s of sources) {
    dist[s] = 0;
    push([0, s]);
  }
  while (heap.length) {
    const [d, c] = pop();
    if (d > dist[c]) continue;
    if (targets.has(c)) {
      const path = [c];
      while (prev[path[0]] !== -1) path.unshift(prev[path[0]]);
      return path;
    }
    for (const [n, length] of neighbours(g, c)) {
      const next = d + (length * (g.cost[c] + g.cost[n])) / 2;
      if (next < dist[n]) {
        dist[n] = next;
        prev[n] = c;
        push([next, n]);
      }
    }
  }
  return null;
}

/** Walking cost of a straight line: its length weighted by the ground under it. */
function lineCost(g: NavGrid, a: Point, b: Point) {
  const length = distance(a, b),
    samples = Math.max(1, Math.ceil(length * RES * 8));
  let sum = 0;
  for (let k = 0; k < samples; k++) {
    const t = (k + 0.5) / samples;
    sum += g.cost[cellAt(g, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })];
  }
  return (sum * length) / samples;
}
/**
 * Straighten the grid path: skip ahead while the straight line crosses no wall
 * and costs no more than the stretch of path it replaces, so a shortcut never
 * trades a path or corridor for the grass beside it.
 */
function smooth(g: NavGrid, points: Point[]) {
  const walked = [0];
  for (let k = 1; k < points.length; k++) walked.push(walked[k - 1] + lineCost(g, points[k - 1], points[k]));
  const clear = (i: number, j: number) =>
    !g.walls.some((w) => crosses(points[i], points[j], w)) &&
    lineCost(g, points[i], points[j]) <= walked[j] - walked[i] + 1e-6;
  const out = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    while (next + 1 < points.length && clear(anchor, next + 1)) next++;
    out.push(points[next]);
    anchor = next;
  }
  return out;
}

/** Name of the area a point is in: a room, a building, a corridor or outside. */
export function areaAt(pieces: Piece[], p: Point) {
  for (const b of pieces.filter(isBuilding)) {
    if (p.x < b.x || p.x > b.x + b.w || p.y < b.y || p.y > b.y + b.h) continue;
    if (b.shape && !inPolygon(p, footprint(b))) continue;
    const r = b.roomAssets?.find(
      (r) =>
        p.x > b.x + r.x &&
        p.x < b.x + r.x + r.w &&
        p.y > b.y + r.y &&
        p.y < b.y + r.y + r.h,
    );
    return r ? r.name : b.name;
  }
  const c = pieces.find((c) => (isCorridor(c) || isOpenAir(c)) && inPolygon(p, footprint(c)));
  return c ? (isPath(c) ? PATH_AREA : isCorridor(c) ? CORRIDOR : c.name) : OUTSIDE;
}

// What `areaAt` calls the walkways; any other answer is a name from the layout.
const CORRIDOR = "the corridor",
  PATH_AREA = "the path",
  OUTSIDE = "outside";
const areaOf = (area: string): Area =>
  area === CORRIDOR
    ? { walkway: "corridor" }
    : area === PATH_AREA
      ? { walkway: "path" }
      : area === OUTSIDE
        ? { walkway: "outside" }
        : { name: area };

const compass = (d: Point): Heading =>
  (["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"] as const)[
    (Math.round(Math.atan2(d.y, d.x) / (Math.PI / 4)) + 8) % 8
  ];

function describe(
  pieces: Piece[],
  points: Point[],
  fromName: string | null,
  to: Place,
  tileMeters = 2,
  g: Pick<NavGrid, "marks" | "walls" | "tileMeters"> = { marks: [], walls: [], tileMeters: 2 },
  fromBuilding?: string,
): Step[] {
  const says: { say: StepSay; meters: number; at: number }[] = [];
  let heading: Point | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      meters = distance(a, b) * tileMeters,
      d = { x: b.x - a.x, y: b.y - a.y };
    if (meters < 0.05) continue;
    const area = areaAt(pieces, b),
      start = areaAt(pieces, a);
    // Name what a long straight stretch passes through, e.g. a corridor or outside.
    const via = new Map<string, number>();
    for (let t = 0.05; t < 1; t += 0.05) {
      const v = areaAt(pieces, { x: a.x + d.x * t, y: a.y + d.y * t });
      if (v !== start && v !== area) via.set(v, (via.get(v) ?? 0) + 1);
    }
    // Ignore slivers, e.g. a line that grazes the corner where two corridors meet.
    const passes = (v: string) => (via.get(v) ?? 0) >= 3;
    const through: Via | undefined = passes(CORRIDOR)
      ? "corridor"
      : passes(PATH_AREA)
        ? "path"
        : passes(OUTSIDE)
          ? "grounds"
          : undefined;
    const into = area === start ? undefined : areaOf(area);
    let turn: Turn | null = null;
    if (heading) {
      const angle =
        (Math.atan2(heading.x * d.y - heading.y * d.x, heading.x * d.x + heading.y * d.y) *
          180) /
        Math.PI;
      const side = angle > 0 ? "right" : "left";
      turn =
        Math.abs(angle) < 25
          ? "straight"
          : Math.abs(angle) < 65
            ? `bear-${side}`
            : Math.abs(angle) < 150
              ? side
              : "around";
    }
    const last = says[says.length - 1];
    // Fold tiny wiggles and straight continuations into the previous instruction.
    if (last && (turn === "straight" || meters < 1) && !through && !into) {
      last.meters += meters;
    } else {
      const extra = { ...(through && { through }), ...(into && { into }) };
      says.push({
        say: turn
          ? { kind: "turn", turn, ...extra }
          : { kind: "start", from: fromName, heading: compass(d), ...extra },
        meters,
        at: i - 1,
      });
    }
    heading = d;
  }
  says.push({
    say: {
      kind: "arrive",
      place: to.name,
      ...(to.building && { building: to.building }),
      ...(to.kind === "listed" && { listed: true }),
    },
    meters: 0,
    at: points.length - 1,
  });
  // Not where they start or end, nor the buildings those are in.
  addLandmarks(says, points, g, [to.name, fromName ?? "", to.building ?? "", fromBuilding ?? ""].filter(Boolean));
  return says.map(({ say, meters, at }) => ({ text: stepText(say, "en"), meters: Math.round(meters), say, at }));
}

const HEADINGS: Record<Lang, Record<Heading, string>> = {
  en: {
    east: "east", "south-east": "south-east", south: "south", "south-west": "south-west",
    west: "west", "north-west": "north-west", north: "north", "north-east": "north-east",
  },
  id: {
    east: "timur", "south-east": "tenggara", south: "selatan", "south-west": "barat daya",
    west: "barat", "north-west": "barat laut", north: "utara", "north-east": "timur laut",
  },
};
const WORDS = {
  en: {
    // A slight bend is still "turn": visitors in a hurry look for left or right, not how sharply.
    turn: {
      straight: "Continue straight", "bear-left": "Turn left", "bear-right": "Turn right",
      left: "Turn left", right: "Turn right", around: "Turn around",
    },
    through: { corridor: " through the corridor", path: " along the path", grounds: " across the grounds" },
    into: { corridor: " into the corridor", path: " onto the path", outside: " and go outside" },
    intoName: (name: string) => ` into ${name}`,
    by: (name: string) => ` by ${name}`,
    past: (name: string) => `, past ${name}`,
    start: (from: string | null, heading: string) => `From ${from ?? "your position"}, head ${heading}`,
    arrive: (place: string, building?: string, listed?: boolean) =>
      listed
        ? `Arrive at ${place} — it's inside ${building}`
        : `Arrive at ${place}${building ? ` in ${building}` : ""}`,
    go: (m: number) => (m <= 2 ? "Go a few steps" : `Go straight ${m} m`),
    goOn: (m: number) => (m <= 2 ? "" : `, straight on ${m} m`),
    then: (turn: string) => `, then ${turn}`,
    carryOn: "Carry on",
    reach: (place: string) => ` to ${place}`,
  },
  id: {
    // Tikungan landai pun tetap "belok": pengunjung mencari kiri atau kanan, bukan seberapa tajam.
    turn: {
      straight: "Jalan terus", "bear-left": "Belok kiri", "bear-right": "Belok kanan",
      left: "Belok kiri", right: "Belok kanan", around: "Putar balik",
    },
    through: { corridor: " melalui koridor", path: " menyusuri jalan setapak", grounds: " melintasi halaman" },
    into: { corridor: " masuk ke koridor", path: " ke jalan setapak", outside: " dan keluar gedung" },
    intoName: (name: string) => ` masuk ke ${name}`,
    by: (name: string) => ` di dekat ${name}`,
    past: (name: string) => `, melewati ${name}`,
    start: (from: string | null, heading: string) => `Dari ${from ?? "posisi Anda"}, jalan ke arah ${heading}`,
    arrive: (place: string, building?: string, listed?: boolean) =>
      listed
        ? `Tiba di ${place} — letaknya di dalam ${building}`
        : `Tiba di ${place}${building ? ` di ${building}` : ""}`,
    go: (m: number) => (m <= 2 ? "Jalan beberapa langkah" : `Jalan lurus ${m} m`),
    goOn: (m: number) => (m <= 2 ? "" : `, lurus ${m} m`),
    then: (turn: string) => `, lalu ${turn}`,
    carryOn: "Terus",
    reach: (place: string) => ` sampai di ${place}`,
  },
};

/** A step in words, e.g. "Turn left into the corridor" or "Belok kiri masuk ke koridor". */
export function stepText(say: StepSay, lang: Lang): string {
  const w = WORDS[lang];
  if (say.kind === "arrive") return w.arrive(say.place, say.building, say.listed);
  const into = !say.into ? "" : "name" in say.into ? w.intoName(say.into.name) : w.into[say.into.walkway];
  const rest = (say.through ? w.through[say.through] : "") + into + (say.past ? w.past(say.past) : "");
  return say.kind === "start"
    ? w.start(say.from, HEADINGS[lang][say.heading]) + rest
    : w.turn[say.turn] + (say.by ? w.by(say.by) : "") + rest;
}

/** The turn a step starts with, as said after "then": "turn right by UTD into the corridor". */
function turnPhrase(say: Extract<StepSay, { kind: "turn" }>, lang: Lang) {
  const w = WORDS[lang],
    into = !say.into ? "" : "name" in say.into ? w.intoName(say.into.name) : w.into[say.into.walkway],
    // After "go straight", carrying straight on reads "then carry on", not "then continue straight".
    text = (say.turn === "straight" ? w.carryOn : w.turn[say.turn]) + (say.by ? w.by(say.by) : "") + into;
  return text[0].toLowerCase() + text.slice(1);
}

/**
 * One stretch of a route as a clear instruction: how far to go straight (and
 * through what, past what), then the turn at its end, e.g. "Jalan lurus 26 m
 * melalui koridor, lalu belok kanan di dekat UTD". The turn a stretch starts
 * with ends the instruction before it; the last says where it ends.
 */
export function legText(route: Route, i: number, lang: Lang): string {
  const w = WORDS[lang],
    step = route.steps[i],
    say = step.say;
  if (say.kind === "arrive") return w.arrive(say.place, say.building, say.listed);
  const along = (say.through ? w.through[say.through] : "") + (say.past ? w.past(say.past) : "");
  const head =
    say.kind === "start"
      ? w.start(say.from, HEADINGS[lang][say.heading]) +
        (!say.into ? "" : "name" in say.into ? w.intoName(say.into.name) : w.into[say.into.walkway]) +
        w.goOn(step.meters) +
        along
      : w.go(step.meters) + along;
  const next = route.steps[i + 1]?.say;
  if (!next || next.kind === "start") return head;
  return next.kind === "arrive" ? head + w.reach(next.place) : head + w.then(turnPhrase(next, lang));
}

/** Shortest walking route between two places (or a map point and a place). */
export function planRoute(
  g: NavGrid,
  from: Place | Point,
  to: Place,
): Route | null {
  const sources = cellsFor(g, from),
    targets = new Set(cellsFor(g, to));
  if (!sources.length || !targets.size) return null;
  const cells = search(g, sources, targets);
  if (!cells) return null;
  const fromPlace = "id" in from ? from : null;
  const points = cells.map((c) => centerOf(g, c));
  // Rooms and exact points start/end at their marker; buildings at their door.
  if (!fromPlace || fromPlace.kind === "room" || fromPlace.kind === "landmark")
    points.unshift(fromPlace?.point ?? (from as Point));
  if (to.kind === "room" || to.kind === "landmark") points.push(to.point);
  const route = smooth(g, points);
  let meters = 0;
  for (let i = 1; i < route.length; i++)
    meters += distance(route[i - 1], route[i]) * g.tileMeters;
  return {
    points: route,
    meters: Math.round(meters),
    steps: describe(g.pieces, route, fromPlace?.name ?? null, to, g.tileMeters, g, fromPlace?.building),
  };
}

/**
 * The room or landmark of a type (its `detail`, e.g. "Toilets" or "Parking")
 * with the shortest walk from `from`; without a start, the first one.
 */
export function nearestOfType(
  g: NavGrid,
  list: Place[],
  detail: string,
  from: Place | Point | null,
): Place | null {
  const options = list.filter((p) => ["room", "landmark", "area"].includes(p.kind) && p.detail === detail);
  if (!from) return options[0] ?? null;
  let best: Place | null = null,
    bestMeters = Infinity;
  for (const p of options) {
    const r = planRoute(g, from, p);
    if (r && r.meters < bestMeters) {
      best = p;
      bestMeters = r.meters;
    }
  }
  return best ?? options[0] ?? null;
}

/** Walking time at about 72 m a minute, never under a minute. */
export const walkMinutes = (meters: number) => Math.max(1, Math.round(meters / 72));

/** An arrow for a direction step. */
export function stepGlyph(step: Step): string {
  const say = step.say;
  if (say.kind === "start") return "●";
  if (say.kind === "arrive") return "⚑";
  // A slight turn shows as a turn, as it is said ("belok kanan").
  return { left: "↰", right: "↱", "bear-left": "↰", "bear-right": "↱", around: "↩", straight: "↑" }[say.turn];
}

/**
 * How far along a route the visitor is, once its first `done` steps are
 * ticked off: the route point they have walked to, and the metres left.
 */
export function progress(route: Route, done: number) {
  const n = Math.max(0, Math.min(done, route.steps.length));
  return {
    at: n >= route.steps.length ? route.points.length - 1 : route.steps[n].at,
    metersLeft: route.steps.slice(n).reduce((m, s) => m + s.meters, 0),
  };
}

/** Places that can't be reached from outside, e.g. a room whose door faces a wall. */
export function unreachable(g: NavGrid, list: Place[]): Place[] {
  const seen = new Uint8Array(g.cols * g.rows),
    queue: number[] = [];
  for (let c = 0; c < g.cost.length; c++)
    if (g.cost[c] === OUTDOOR) {
      seen[c] = 1;
      queue.push(c);
    }
  for (let k = 0; k < queue.length; k++)
    for (const [n] of neighbours(g, queue[k]))
      if (!seen[n]) {
        seen[n] = 1;
        queue.push(n);
      }
  return list.filter((p) => !cellsFor(g, p).some((c) => seen[c]));
}
