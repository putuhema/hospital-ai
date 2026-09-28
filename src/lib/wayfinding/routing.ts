import type { Piece } from "../model/layout.ts";
import { center as centerPoint, footprint, inPolygon, isBuilding, isCorridor, isPath, roomTypes } from "../model/interiors.ts";
import {
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
  kind: "building" | "room" | "listed" | "landmark";
  /** Name of the building that contains this place. */
  building?: string;
  detail: string;
  pieceId?: number;
  roomId?: number;
  point: Point;
};
export type Step = { text: string; meters: number };
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
  for (const n of network?.nodes ?? [])
    if (n.name.trim())
      out.push({
        id: `n:${n.id}`,
        name: n.name,
        kind: "landmark",
        detail: "Landmark",
        point: { x: n.x, y: n.y },
      });
  return out;
}

/** Text search over names, building names and room types. */
export function searchPlaces(list: Place[], query: string): Place[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = (p: Place) =>
    `${p.name} ${p.building ?? ""} ${p.detail}`.toLowerCase();
  return list
    .filter((p) => words.every((w) => haystack(p).includes(w)))
    .sort(
      (a, b) =>
        Number(!a.name.toLowerCase().startsWith(words[0] ?? "")) -
          Number(!b.name.toLowerCase().startsWith(words[0] ?? "")) ||
        a.name.localeCompare(b.name),
    );
}

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
};

export function buildGrid(
  pieces: Piece[],
  width: number,
  height: number,
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
          cost[j * cols + i] = isPath(p) ? PATH : INDOOR;
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
  return { cols, rows, cost, eastWall, southWall, walls: segments, pieces };
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

/** Straight-line shortcut that crosses no wall and doesn't detour outdoors. */
function clear(g: NavGrid, a: Point, b: Point) {
  if (g.walls.some((w) => crosses(a, b, w))) return false;
  const limit = Math.max(g.cost[cellAt(g, a)], g.cost[cellAt(g, b)]),
    samples = Math.ceil(distance(a, b) * RES * 8);
  for (let k = 1; k < samples; k++) {
    const t = k / samples;
    if (
      g.cost[
        cellAt(g, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      ] > limit
    )
      return false;
  }
  return true;
}
function smooth(g: NavGrid, points: Point[]) {
  const out = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    while (next + 1 < points.length && clear(g, points[anchor], points[next + 1]))
      next++;
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
  const c = pieces.find((c) => (isCorridor(c) || isPath(c)) && inPolygon(p, footprint(c)));
  return c ? (isPath(c) ? "the path" : "the corridor") : "outside";
}

const compass = (d: Point) =>
  ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"][
    (Math.round(Math.atan2(d.y, d.x) / (Math.PI / 4)) + 8) % 8
  ];

function describe(
  pieces: Piece[],
  points: Point[],
  fromName: string,
  to: Place,
): Step[] {
  const steps: Step[] = [];
  let heading: Point | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      meters = distance(a, b) * 2,
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
    const through = passes("the corridor")
      ? " through the corridor"
      : passes("the path")
        ? " along the path"
        : passes("outside")
          ? " across the grounds"
          : "";
    const into =
      through +
      (area === start
        ? ""
        : area === "outside"
          ? " and go outside"
          : area === "the corridor"
            ? " into the corridor"
            : area === "the path"
              ? " onto the path"
              : ` into ${area}`);
    let turn = "";
    if (heading) {
      const angle =
        (Math.atan2(heading.x * d.y - heading.y * d.x, heading.x * d.x + heading.y * d.y) *
          180) /
        Math.PI;
      const side = angle > 0 ? "right" : "left";
      turn =
        Math.abs(angle) < 25
          ? "Continue straight"
          : Math.abs(angle) < 65
            ? `Bear ${side}`
            : Math.abs(angle) < 150
              ? `Turn ${side}`
              : "Turn around";
    }
    const last = steps[steps.length - 1];
    // Fold tiny wiggles and straight continuations into the previous instruction.
    if (last && (turn === "Continue straight" || meters < 1) && !into) {
      last.meters += meters;
    } else {
      steps.push({
        text: heading
          ? `${turn}${into}`
          : `From ${fromName}, head ${compass(d)}${into}`,
        meters,
      });
    }
    heading = d;
  }
  steps.push({
    text: `Arrive at ${to.name}${to.building && to.kind !== "listed" ? ` in ${to.building}` : ""}`,
    meters: 0,
  });
  if (to.kind === "listed")
    steps[steps.length - 1].text += ` — it's inside ${to.building}`;
  return steps.map((s) => ({ ...s, meters: Math.round(s.meters) }));
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
    meters += distance(route[i - 1], route[i]) * 2;
  return {
    points: route,
    meters: Math.round(meters),
    steps: describe(g.pieces, route, fromPlace?.name ?? "your position", to),
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
