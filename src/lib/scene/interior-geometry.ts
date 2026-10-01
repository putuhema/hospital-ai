import * as THREE from "three";
import type { Piece } from "../model/layout.ts";
import { footprint, outline, roomColor, type RoomAsset } from "../model/interiors.ts";
import { buildingDoors } from "../wayfinding/navigation.ts";

/** Height of one storey in metres. */
export const STOREY = 3.6;

const WOOD = "#a68e70",
  FABRIC = "#536c70",
  WHITE = "#f8faf3",
  STEEL = "#9aa7a8",
  TEAL = "#6e8e92",
  PARTITION = "#f2efe3",
  GLASS = "#6f9aab",
  FRAME = "#3f5153";

type Box = (
  name: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: string,
  opts?: { roughness?: number; metalness?: number; cast?: boolean },
) => THREE.Mesh;

function boxes(parent: THREE.Object3D): Box {
  return (name, x, y, z, w, h, d, color, opts = {}) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d)),
      new THREE.MeshStandardMaterial({
        color,
        roughness: opts.roughness ?? 0.7,
        metalness: opts.metalness ?? 0,
      }),
    );
    m.name = name;
    m.position.set(x, y, z);
    m.castShadow = opts.cast ?? true;
    m.receiveShadow = true;
    m.userData.generated = true;
    parent.add(m);
    return m;
  };
}

const shade = (hex: string, amount: number) =>
  "#" +
  new THREE.Color(hex)
    .lerp(new THREE.Color(amount < 0 ? "#1f2a24" : "#ffffff"), Math.abs(amount))
    .getHexString();

export function buildingInterior(p: Piece, pieces: Piece[], cutaway: boolean) {
  const group = new THREE.Group();
  group.name = p.name;
  group.userData.pieceId = p.id;
  const box = boxes(group);
  const floors = p.floors ?? 1,
    H = STOREY * floors,
    wallH = cutaway ? 0.65 : H;
  const floor = new THREE.Shape(footprint({ ...p, x: 0, y: 0 }).map((v) => new THREE.Vector2(v.x * 2, v.y * 2)));
  const floorGeometry = new THREE.ExtrudeGeometry(floor, { depth: 0.25, bevelEnabled: false });
  floorGeometry.rotateX(Math.PI / 2);
  floorGeometry.translate(0, 0.275, 0);
  const slab = new THREE.Mesh(floorGeometry, new THREE.MeshStandardMaterial({ color: "#e7e8dd", roughness: 0.7 }));
  slab.name = "Interior floor";
  slab.receiveShadow = true;
  slab.userData.generated = true;
  group.add(slab);
  const doors = buildingDoors(p, pieces);
  const band = shade(p.color, -0.18);
  for (const edge of outline(p)) {
    const side = edge.side,
      horizontal = side === "north" || side === "south",
      length = (edge.to - edge.from) * 2,
      line = edge.at * 2,
      // +1 when the building lies on the positive side of this wall.
      inward = side === "north" || side === "west" ? 1 : -1;
    const cuts = doors
      .filter((d) => d.side === side && d.offset >= edge.from && d.offset <= edge.to)
      .map((d) => ({
        start: (d.offset - edge.from) * 2 - d.width,
        end: (d.offset - edge.from) * 2 + d.width,
      }))
      .sort((a, b) => a.start - b.start);
    // Position along this wall, pushed `out` metres outside the wall face.
    const at = (v: number, out = 0.08) => ({
      x: horizontal ? edge.from * 2 + v : line + inward * (0.08 - out),
      z: horizontal ? line + inward * (0.08 - out) : edge.from * 2 + v,
    });
    const run = (name: string, a: number, b: number, y: number, h: number, color: string, depth = 0.16, out = 0) => {
      if (b - a < 0.01) return;
      const c = at((a + b) / 2, out);
      box(name, c.x, y, c.z, horizontal ? b - a : depth, h, horizontal ? depth : b - a, color);
    };
    const windows = (a: number, b: number) => {
      if (cutaway) return;
      const count = Math.floor((b - a - 0.6) / 2.4);
      for (let i = 0; i < count; i++) {
        const v = a + ((i + 0.5) * (b - a)) / count;
        for (let f = 0; f < floors; f++) {
          const y = f * STOREY + 1.95;
          run("Window frame", v - 0.67, v + 0.67, y, 1.45, FRAME, 0.04, 0.1);
          run("Window glazing", v - 0.58, v + 0.58, y, 1.3, GLASS, 0.04, 0.12);
        }
      }
    };
    let cursor = 0;
    for (const c of cuts) {
      run("Exterior wall", cursor, c.start, wallH / 2 + 0.25, wallH, p.color);
      windows(cursor, c.start);
      if (!cutaway) run("Exterior wall", c.start, c.end, (2.7 + H) / 2 + 0.25, H - 2.7, p.color);
      const door = at((c.start + c.end) / 2, 0);
      if (cutaway) {
        // With walls cut down, show the opening as a threshold on the floor.
        box(
          "Door threshold",
          door.x,
          0.3,
          door.z,
          horizontal ? c.end - c.start : 0.3,
          0.04,
          horizontal ? 0.3 : c.end - c.start,
          "#52747a",
          { cast: false },
        );
        cursor = Math.max(cursor, c.end);
        continue;
      }
      box(
        "Automatic corridor door",
        door.x,
        1.32,
        door.z,
        horizontal ? c.end - c.start : 0.1,
        2.15,
        horizontal ? 0.1 : c.end - c.start,
        "#52747a",
        { roughness: 0.25, metalness: 0.2 },
      );
      box(
        "Door lintel",
        door.x,
        2.46,
        door.z,
        horizontal ? c.end - c.start + 0.12 : 0.18,
        0.14,
        horizontal ? 0.18 : c.end - c.start + 0.12,
        "#364b4c",
      );
      cursor = Math.max(cursor, c.end);
    }
    run("Exterior wall", cursor, length, wallH / 2 + 0.25, wallH, p.color);
    windows(cursor, length);
    if (!cutaway) {
      for (let f = 1; f < floors; f++)
        run("Storey band", 0, length, f * STOREY + 0.25, 0.14, band, 0.04, 0.1);
      run("Parapet coping", 0, length, H + 0.3, 0.1, band, 0.22, 0.02);
    }
  }
  for (const r of p.roomAssets ?? []) group.add(room(r, cutaway));
  group.position.set(p.x * 2, 0, p.y * 2);
  return group;
}

const facing = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 };

/**
 * A room built in its own frame, with the doorway on the local +z (front)
 * wall, then turned to face the wall its door is on.
 */
function room(r: RoomAsset, cutaway: boolean) {
  const g = new THREE.Group();
  g.name = r.name;
  const side = r.door ?? "south",
    across = (side === "north" || side === "south" ? r.w : r.h) * 2,
    deep = (side === "north" || side === "south" ? r.h : r.w) * 2;
  g.position.set((r.x + r.w / 2) * 2, 0, (r.y + r.h / 2) * 2);
  g.rotation.y = facing[side];
  const box = boxes(g);
  const W = across - 0.16,
    D = deep - 0.16,
    h = cutaway ? 0.65 : 2.7,
    back = -D / 2,
    front = D / 2;
  box(r.name + " floor", 0, 0.3, 0, W, 0.1, D, roomColor(r), { cast: false });
  box(r.name + " back wall", 0, h / 2 + 0.3, back, W, h, 0.1, PARTITION);
  box(r.name + " side wall", -W / 2, h / 2 + 0.3, 0, 0.1, h, D, PARTITION);
  box(r.name + " side wall", W / 2, h / 2 + 0.3, 0, 0.1, h, D, PARTITION);
  const wing = Math.max(0, (W - 0.8) / 2);
  box(r.name + " front wall", -W / 2 + wing / 2, h / 2 + 0.3, front, wing, h, 0.1, PARTITION);
  box(r.name + " front wall", W / 2 - wing / 2, h / 2 + 0.3, front, wing, h, 0.1, PARTITION);
  if (!cutaway) box(r.name + " door head", 0, 2.55, front, 0.8, 0.3, 0.1, PARTITION);
  furnish(box, r.type, W, D, r.name);
  g.traverse((o) => (o.userData.roomId = r.id));
  return g;
}

/** Furniture in the room's local frame: back wall at -D/2, door at +D/2. */
function furnish(box: Box, type: RoomAsset["type"], W: number, D: number, name: string) {
  const back = -D / 2,
    floor = 0.35;
  const bed = (x: number, len = Math.min(1.9, D - 0.5)) => {
    const z = back + 0.1 + len / 2;
    box(name + " bed base", x, floor + 0.2, z, 0.95, 0.4, len, TEAL);
    box(name + " mattress", x, floor + 0.47, z, 0.9, 0.15, len - 0.05, WHITE);
    box(name + " pillow", x, floor + 0.6, back + 0.35, 0.65, 0.12, 0.35, "#c2d7df");
  };
  const chair = (x: number, z: number, color = FABRIC) => {
    box(name + " chair", x, floor + 0.22, z, 0.45, 0.44, 0.45, color);
    box(name + " chair back", x, floor + 0.62, z + 0.2, 0.45, 0.4, 0.06, color);
  };
  const counter = (x: number, z: number, w: number, d: number, h = 1.05, color = WOOD) =>
    box(name + " counter", x, floor + h / 2, z, w, h, d, color);
  const shelves = (x: number, z: number, w: number, d: number, color = "#cdd4cf") => {
    box(name + " shelving", x, floor + 1, z, w, 2, d, color);
    for (let y = 0.4; y < 2; y += 0.5)
      box(name + " shelf items", x, floor + y + 0.12, z + d * 0.1, w * 0.9, 0.22, d * 0.7, "#8aa0a8");
  };
  switch (type) {
    case "patient":
      bed(W > 3.4 ? -W / 4 : -0.25);
      if (W > 3.4) bed(W / 4);
      box(name + " bedside cabinet", W > 3.4 ? 0 : 0.6, floor + 0.3, back + 0.35, 0.45, 0.6, 0.45, WOOD);
      break;
    case "exam":
      box(name + " exam couch", -W / 2 + 0.5, floor + 0.38, back + 0.2 + Math.min(0.9, D / 2 - 0.3), 0.7, 0.75, Math.min(1.8, D - 0.6), "#7fa7b3");
      box(name + " desk", W / 2 - 0.5, floor + 0.37, back + 0.45, 0.8, 0.74, 0.6, WOOD);
      box(name + " stool", 0.1, floor + 0.25, 0, 0.35, 0.5, 0.35, STEEL, { metalness: 0.4 });
      break;
    case "office":
      box(name + " desk", 0, floor + 0.37, back + 0.5, Math.min(1.2, W - 0.2), 0.74, 0.65, WOOD);
      chair(0, back + 1.15);
      if (W > 1.9) shelves(W / 2 - 0.2, 0, 0.35, Math.min(1.2, D - 1), "#d6cbb5");
      break;
    case "waiting": {
      const cols = Math.max(1, Math.floor((W - 0.2) / 0.55)),
        rows = Math.max(1, Math.min(3, Math.floor((D - 1) / 0.9)));
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++)
          chair(-W / 2 + 0.35 + i * 0.55, back + 0.45 + j * 0.9, "#6f8f7a");
      if (D > 2.4) box(name + " table", 0, floor + 0.2, D / 2 - 0.7, 0.8, 0.4, 0.5, WOOD);
      break;
    }
    case "reception":
      counter(0, 0, W - 0.3, 0.55);
      box(name + " counter top", 0, floor + 1.1, 0.1, W - 0.2, 0.06, 0.4, WHITE);
      chair(-W / 4, back + 0.4);
      if (W > 1.9) chair(W / 4, back + 0.4);
      break;
    case "nurse":
      counter(0, 0.1, W - 0.4, 0.5, 1.0, "#8fb3a2");
      counter(-W / 2 + 0.45, back + D / 2 - 0.1, 0.5, D / 2, 1.0, "#8fb3a2");
      counter(W / 2 - 0.45, back + D / 2 - 0.1, 0.5, D / 2, 1.0, "#8fb3a2");
      chair(0, back + 0.35);
      break;
    case "toilet": {
      const stalls = Math.max(1, Math.floor(W / 0.95));
      for (let i = 0; i < stalls; i++) {
        const x = -W / 2 + (i + 0.5) * (W / stalls);
        box(name + " WC", x, floor + 0.2, back + 0.35, 0.38, 0.4, 0.55, WHITE, { roughness: 0.2 });
        box(name + " cistern", x, floor + 0.55, back + 0.1, 0.4, 0.35, 0.15, WHITE, { roughness: 0.2 });
        if (i) box(name + " partition", -W / 2 + i * (W / stalls), floor + 0.9, back + 0.55, 0.04, 1.8, 1.1, "#9fb8c2");
      }
      box(name + " basin", W / 2 - 0.3, floor + 0.85, D / 2 - 0.5, 0.35, 0.15, 0.45, WHITE, { roughness: 0.2 });
      break;
    }
    case "pharmacy":
      shelves(0, back + 0.25, W - 0.3, 0.4, "#e3d7de");
      counter(0, D / 2 - 0.55, W - 0.4, 0.5, 1.05, "#b98fa2");
      break;
    case "lab":
      counter(0, back + 0.35, W - 0.2, 0.6, 0.9, WHITE);
      counter(-W / 2 + 0.35, 0.2, 0.6, D - 1.4, 0.9, WHITE);
      for (let x = -W / 2 + 0.5; x < W / 2 - 0.3; x += 0.7)
        box(name + " equipment", x, floor + 1.05, back + 0.35, 0.35, 0.3, 0.35, x > 0 ? "#6d7fb0" : STEEL, { metalness: 0.3 });
      box(name + " stool", 0.3, floor + 0.3, back + 1, 0.35, 0.6, 0.35, STEEL, { metalness: 0.4 });
      break;
    case "surgery":
      box(name + " operating table", 0, floor + 0.45, -0.2, 0.6, 0.9, Math.min(2, D - 0.8), "#4f7d82", { metalness: 0.3 });
      box(name + " surgical lamp", 0, 2.4, -0.2, 0.9, 0.12, 0.9, WHITE, { roughness: 0.2 });
      box(name + " lamp arm", 0, 2.6, -0.2, 0.06, 0.3, 0.06, STEEL, { metalness: 0.6 });
      box(name + " instrument cart", W / 2 - 0.4, floor + 0.45, back + 0.4, 0.5, 0.9, 0.4, STEEL, { metalness: 0.5 });
      box(name + " monitor", -W / 2 + 0.35, floor + 0.8, back + 0.35, 0.4, 1.6, 0.4, "#3c4a4f");
      break;
    case "stairs": {
      const runW = W > 1.9 ? W / 2 - 0.1 : W - 0.2,
        steps = 8;
      for (let i = 0; i < steps; i++)
        box(name + " step", -W / 2 + 0.1 + runW / 2, floor + (i + 0.5) * 0.18, D / 2 - 0.3 - (i + 0.5) * ((D - 0.6) / steps), runW, (i + 1) * 0.18, (D - 0.6) / steps, "#c9c4b8");
      if (W > 1.9) {
        box(name + " lift car", W / 4, floor + 1.2, back + 0.8, W / 2 - 0.3, 2.4, 1.3, "#b8c3c6", { metalness: 0.5, roughness: 0.3 });
        box(name + " lift doors", W / 4, floor + 1.05, back + 1.46, W / 2 - 0.7, 2.1, 0.04, STEEL, { metalness: 0.7, roughness: 0.25 });
      }
      break;
    }
    case "storage":
      shelves(0, back + 0.25, W - 0.3, 0.4);
      if (D > 1.9) shelves(-W / 2 + 0.25, 0.1, 0.4, D - 1.2);
      break;
    case "radiology":
      box(name + " scanner table", -0.2, floor + 0.4, -0.1, 0.6, 0.8, Math.min(2, D - 0.8), "#9fb0c8");
      box(name + " x-ray arm", -0.2, 2.1, -0.1, 0.5, 0.35, 0.5, WHITE, { roughness: 0.3 });
      box(name + " arm column", -0.2 - 0.45, floor + 1, back + 0.3, 0.12, 2, 0.12, STEEL, { metalness: 0.5 });
      box(name + " control desk", W / 2 - 0.4, floor + 0.37, D / 2 - 0.6, 0.5, 0.74, 0.8, WOOD);
      break;
    case "perinatology": {
      // A row of incubators along the back wall, under clear hoods, and a nurse's counter by the door.
      const cots = Math.max(1, Math.floor((W - 0.3) / 0.9)),
        z = back + 0.45;
      for (let i = 0; i < cots; i++) {
        const x = -W / 2 + 0.15 + (i + 0.5) * ((W - 0.3) / cots);
        box(name + " incubator stand", x, floor + 0.35, z, 0.6, 0.7, 0.45, WHITE);
        box(name + " incubator mattress", x, floor + 0.74, z, 0.5, 0.08, 0.35, "#f4d6dc");
        const hood = box(name + " incubator hood", x, floor + 0.93, z, 0.62, 0.3, 0.47, "#d9eef2", { roughness: 0.1, cast: false });
        Object.assign(hood.material, { transparent: true, opacity: 0.45 });
      }
      if (D > 2.4 && W > 2.6) counter(W / 2 - 0.55, D / 2 - 0.75, 0.8, 0.45, 0.9);
      break;
    }
    case "emergency":
      bed(-W / 3);
      bed(0);
      if (W > 2.6) bed(W / 3);
      box(name + " crash cart", W / 2 - 0.3, floor + 0.45, D / 2 - 0.5, 0.45, 0.9, 0.4, "#c0463a");
      break;
  }
}
