import * as THREE from "three";
import type { Piece } from "../model/layout.ts";
import { footprint, outline, roomColor, type RoomAsset } from "../model/interiors.ts";
import { buildingDoors } from "../wayfinding/navigation.ts";

/** Height of one storey in metres. */
export const STOREY = 3.6;

const WOOD = "#a68a68",
  WOOD_DARK = "#7d6449",
  FABRIC = "#4b696e",
  WHITE = "#f8faf5",
  STEEL = "#9ba8a9",
  TEAL = "#5c868a",
  BLANKET = "#6b9987",
  PARTITION = "#f3f0e6",
  SKIRTING = "#d7dbd1",
  GLASS = "#6898ab",
  FRAME = "#36494b",
  SILL = "#dde2d8",
  SCREEN = "#2c3d42",
  SCREEN_GLOW = "#59b5a6";

type BoxOpts = {
  roughness?: number;
  metalness?: number;
  cast?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
};

type Box = (
  name: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: string,
  opts?: BoxOpts,
) => THREE.Mesh;

/**
 * Factory for low-poly box meshes that reuses a shared material cache per
 * building, cutting GC churn and letting `batchMeshes` merge identical looks.
 */
function boxes(parent: THREE.Object3D, materials: Map<string, THREE.MeshStandardMaterial>): Box {
  const materialFor = (color: string, opts: BoxOpts) => {
    const r = opts.roughness ?? 0.72,
      m = opts.metalness ?? 0,
      e = opts.emissive ?? "",
      ei = opts.emissiveIntensity ?? 0,
      tr = opts.transparent ?? false,
      op = opts.opacity ?? 1;
    const key = `${color}|${r}|${m}|${e}|${ei}|${tr}|${op}`;
    let mat = materials.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color,
        roughness: r,
        metalness: m,
        ...(e ? { emissive: e, emissiveIntensity: ei } : {}),
        ...(tr ? { transparent: true, opacity: op } : {}),
      });
      materials.set(key, mat);
    }
    return mat;
  };
  return (name, x, y, z, w, h, d, color, opts = {}) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d)),
      materialFor(color, opts),
    );
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = opts.cast ?? true;
    mesh.receiveShadow = true;
    mesh.userData.generated = true;
    parent.add(mesh);
    return mesh;
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
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const box = boxes(group, materials);
  const floors = p.floors ?? 1,
    H = STOREY * floors,
    wallH = cutaway ? 0.65 : H;

  const floor = new THREE.Shape(footprint({ ...p, x: 0, y: 0 }).map((v) => new THREE.Vector2(v.x * 2, v.y * 2)));
  const floorGeometry = new THREE.ExtrudeGeometry(floor, { depth: 0.25, bevelEnabled: false });
  floorGeometry.rotateX(Math.PI / 2);
  floorGeometry.translate(0, 0.275, 0);
  const slab = new THREE.Mesh(floorGeometry, new THREE.MeshStandardMaterial({ color: "#e8eae0", roughness: 0.72 }));
  slab.name = "Interior floor";
  slab.receiveShadow = true;
  slab.userData.generated = true;
  group.add(slab);

  const doors = buildingDoors(p, pieces);
  const band = shade(p.color, -0.18);
  const plinth = shade(p.color, -0.26);

  for (const edge of outline(p)) {
    const side = edge.side,
      horizontal = side === "north" || side === "south",
      length = (edge.to - edge.from) * 2,
      line = edge.at * 2,
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

    const run = (
      name: string,
      a: number,
      b: number,
      y: number,
      h: number,
      color: string,
      depth = 0.16,
      out = 0,
      opts?: BoxOpts,
    ) => {
      if (b - a < 0.01) return;
      const c = at((a + b) / 2, out);
      box(name, c.x, y, c.z, horizontal ? b - a : depth, h, horizontal ? depth : b - a, color, opts);
    };

    const windows = (a: number, b: number) => {
      if (cutaway) return;
      const count = Math.floor((b - a - 0.6) / 2.4);
      for (let i = 0; i < count; i++) {
        const v = a + ((i + 0.5) * (b - a)) / count;
        for (let f = 0; f < floors; f++) {
          const y = f * STOREY + 1.98;
          // Recessed frame + reflective glazing + center mullion + projecting sill.
          run("Window frame", v - 0.68, v + 0.68, y, 1.46, FRAME, 0.05, 0.1, { roughness: 0.45, metalness: 0.25 });
          run("Window glazing", v - 0.59, v + 0.59, y, 1.32, GLASS, 0.04, 0.12, { roughness: 0.16, metalness: 0.32 });
          run("Window mullion", v - 0.025, v + 0.025, y, 1.36, FRAME, 0.055, 0.13, { roughness: 0.45, metalness: 0.25 });
          run("Window sill", v - 0.74, v + 0.74, y - 0.76, 0.08, SILL, 0.12, 0.14, { roughness: 0.78 });
          // Ground-floor sun-shading eyebrow for architectural depth.
          if (f === 0) {
            run("Window hood", v - 0.74, v + 0.74, y + 0.78, 0.07, band, 0.18, 0.16, { roughness: 0.65 });
          }
        }
      }
    };

    let cursor = 0;
    for (const c of cuts) {
      run("Exterior wall", cursor, c.start, wallH / 2 + 0.25, wallH, p.color);
      if (!cutaway) run("Exterior plinth", cursor, c.start, 0.28, 0.28, plinth, 0.04, 0.1);
      windows(cursor, c.start);
      if (!cutaway) run("Exterior wall", c.start, c.end, (2.7 + H) / 2 + 0.25, H - 2.7, p.color);
      const door = at((c.start + c.end) / 2, 0);
      const doorW = c.end - c.start;

      if (cutaway) {
        box(
          "Door threshold",
          door.x,
          0.3,
          door.z,
          horizontal ? doorW : 0.3,
          0.04,
          horizontal ? 0.3 : doorW,
          "#52747a",
          { cast: false },
        );
        cursor = Math.max(cursor, c.end);
        continue;
      }

      // Double sliding glass entrance door with frame, center mullion, and canopy overhang.
      box(
        "Automatic corridor door",
        door.x,
        1.32,
        door.z,
        horizontal ? doorW - 0.12 : 0.08,
        2.12,
        horizontal ? 0.08 : doorW - 0.12,
        GLASS,
        { roughness: 0.16, metalness: 0.35 },
      );
      // Center seam between sliding glass leaves.
      box(
        "Door center seam",
        door.x,
        1.32,
        door.z,
        horizontal ? 0.04 : 0.12,
        2.12,
        horizontal ? 0.12 : 0.04,
        FRAME,
        { roughness: 0.4, metalness: 0.3 },
      );
      // Left and right door jambs.
      for (const sideSign of [-1, 1]) {
        const jamb = at((c.start + c.end) / 2 + sideSign * (doorW / 2 - 0.04), 0);
        box(
          "Door jamb",
          jamb.x,
          1.34,
          jamb.z,
          horizontal ? 0.08 : 0.18,
          2.22,
          horizontal ? 0.18 : 0.08,
          FRAME,
          { roughness: 0.4, metalness: 0.3 },
        );
      }
      box(
        "Door lintel",
        door.x,
        2.48,
        door.z,
        horizontal ? doorW + 0.16 : 0.2,
        0.16,
        horizontal ? 0.2 : doorW + 0.16,
        FRAME,
        { roughness: 0.45, metalness: 0.25 },
      );
      // Projecting entrance canopy eyebrow above the door.
      const canopy = at((c.start + c.end) / 2, 0.28);
      box(
        "Door canopy",
        canopy.x,
        2.62,
        canopy.z,
        horizontal ? doorW + 0.34 : 0.42,
        0.09,
        horizontal ? 0.42 : doorW + 0.34,
        band,
        { roughness: 0.6 },
      );

      cursor = Math.max(cursor, c.end);
    }

    run("Exterior wall", cursor, length, wallH / 2 + 0.25, wallH, p.color);
    if (!cutaway) run("Exterior plinth", cursor, length, 0.28, 0.28, plinth, 0.04, 0.1);
    windows(cursor, length);

    if (!cutaway) {
      for (let f = 1; f < floors; f++)
        run("Storey band", 0, length, f * STOREY + 0.25, 0.16, band, 0.06, 0.11, { roughness: 0.68 });
      run("Parapet coping", 0, length, H + 0.3, 0.11, band, 0.24, 0.03, { roughness: 0.65 });
    }
  }

  for (const r of p.roomAssets ?? []) group.add(room(r, cutaway, materials));
  group.position.set(p.x * 2, 0, p.y * 2);
  return group;
}

const facing = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 };

/**
 * A room built in its own frame, with the doorway on the local +z (front)
 * wall, then turned to face the wall its door is on.
 */
function room(r: RoomAsset, cutaway: boolean, materials: Map<string, THREE.MeshStandardMaterial>) {
  const g = new THREE.Group();
  g.name = r.name;
  const side = r.door ?? "south",
    across = (side === "north" || side === "south" ? r.w : r.h) * 2,
    deep = (side === "north" || side === "south" ? r.h : r.w) * 2;
  g.position.set((r.x + r.w / 2) * 2, 0, (r.y + r.h / 2) * 2);
  g.rotation.y = facing[side];
  const box = boxes(g, materials);
  const W = across - 0.16,
    D = deep - 0.16,
    h = cutaway ? 0.68 : 2.7,
    back = -D / 2,
    front = D / 2;

  // Room floor + crisp partition walls + subtle baseboard trim & doorway jambs.
  box(r.name + " floor", 0, 0.3, 0, W, 0.1, D, roomColor(r), { cast: false, roughness: 0.78 });
  box(r.name + " back wall", 0, h / 2 + 0.3, back, W, h, 0.1, PARTITION);
  box(r.name + " side wall", -W / 2, h / 2 + 0.3, 0, 0.1, h, D, PARTITION);
  box(r.name + " side wall", W / 2, h / 2 + 0.3, 0, 0.1, h, D, PARTITION);

  // Clean wall-top cap in cutaway mode so room layouts read like an architectural model.
  if (cutaway) {
    box(r.name + " back cap", 0, h + 0.31, back, W + 0.08, 0.03, 0.12, SKIRTING, { cast: false });
    box(r.name + " side cap", -W / 2, h + 0.31, 0, 0.12, 0.03, D, SKIRTING, { cast: false });
    box(r.name + " side cap", W / 2, h + 0.31, 0, 0.12, 0.03, D, SKIRTING, { cast: false });
  }

  const wing = Math.max(0, (W - 0.86) / 2);
  box(r.name + " front wall", -W / 2 + wing / 2, h / 2 + 0.3, front, wing, h, 0.1, PARTITION);
  box(r.name + " front wall", W / 2 - wing / 2, h / 2 + 0.3, front, wing, h, 0.1, PARTITION);
  // Subtle wood/steel door jambs framing the entrance.
  box(r.name + " door jamb", -0.43, h / 2 + 0.3, front, 0.05, h, 0.13, WOOD_DARK, { cast: false });
  box(r.name + " door jamb", 0.43, h / 2 + 0.3, front, 0.05, h, 0.13, WOOD_DARK, { cast: false });
  if (!cutaway) box(r.name + " door head", 0, 2.55, front, 0.86, 0.3, 0.1, PARTITION);

  furnish(box, r.type, W, D, r.name);
  g.traverse((o) => (o.userData.roomId = r.id));
  return g;
}

/** Furniture in the room's local frame: back wall at -D/2, door at +D/2. */
function furnish(box: Box, type: RoomAsset["type"], W: number, D: number, name: string) {
  const back = -D / 2,
    floor = 0.35;

  const bed = (x: number, len = Math.min(1.92, D - 0.5), iv = false) => {
    const z = back + 0.12 + len / 2;
    // Frame, headboard, footboard, mattress, folded hospital blanket, pillow, and side rails.
    box(name + " bed base", x, floor + 0.18, z, 0.94, 0.32, len, TEAL, { roughness: 0.55, metalness: 0.15 });
    box(name + " headboard", x, floor + 0.52, back + 0.14, 0.96, 0.64, 0.07, WOOD, { roughness: 0.65 });
    box(name + " footboard", x, floor + 0.38, z + len / 2 - 0.03, 0.94, 0.38, 0.05, WOOD, { roughness: 0.65 });
    box(name + " mattress", x, floor + 0.41, z, 0.88, 0.16, len - 0.1, WHITE, { roughness: 0.85 });
    box(name + " blanket", x, floor + 0.44, z + len * 0.16, 0.9, 0.14, len * 0.54, BLANKET, { roughness: 0.88 });
    box(name + " pillow", x, floor + 0.54, back + 0.38, 0.62, 0.11, 0.32, "#dbe9ee", { roughness: 0.9 });
    // Slim side safety rail.
    box(name + " bed rail", x + 0.46, floor + 0.52, z - 0.1, 0.03, 0.16, len * 0.48, STEEL, { metalness: 0.5, roughness: 0.35 });
    if (iv) {
      box(name + " iv base", x - 0.58, floor + 0.03, back + 0.45, 0.26, 0.05, 0.26, STEEL, { metalness: 0.5, roughness: 0.35 });
      box(name + " iv pole", x - 0.58, floor + 0.85, back + 0.45, 0.03, 1.65, 0.03, STEEL, { metalness: 0.6, roughness: 0.3 });
      box(name + " iv bag", x - 0.58, floor + 1.52, back + 0.52, 0.08, 0.16, 0.05, "#d8f0f5", { roughness: 0.2, transparent: true, opacity: 0.8 });
    }
  };

  const chair = (x: number, z: number, color = FABRIC) => {
    box(name + " chair leg", x, floor + 0.16, z, 0.38, 0.32, 0.38, STEEL, { metalness: 0.45, roughness: 0.4 });
    box(name + " chair seat", x, floor + 0.35, z, 0.44, 0.09, 0.44, color, { roughness: 0.82 });
    box(name + " chair back", x, floor + 0.6, z + 0.19, 0.44, 0.42, 0.07, color, { roughness: 0.82 });
  };

  const monitor = (x: number, y: number, z: number) => {
    box(name + " monitor stand", x, y + 0.06, z, 0.14, 0.12, 0.1, SCREEN, { roughness: 0.4, metalness: 0.3 });
    box(name + " monitor screen", x, y + 0.25, z, 0.38, 0.26, 0.04, SCREEN, {
      roughness: 0.25,
      emissive: SCREEN_GLOW,
      emissiveIntensity: 0.28,
    });
  };

  const counter = (x: number, z: number, w: number, d: number, h = 1.02, color = WOOD) => {
    box(name + " counter", x, floor + h / 2, z, w, h, d, color, { roughness: 0.68 });
    box(name + " counter lip", x, floor + h + 0.025, z, w + 0.04, 0.05, d + 0.05, WHITE, { roughness: 0.38 });
  };

  const shelves = (x: number, z: number, w: number, d: number, color = "#cfd6d1") => {
    box(name + " shelving", x, floor + 0.98, z, w, 1.96, d, color, { roughness: 0.65 });
    const tints = ["#7fa4a8", "#9eb89d", "#c9a87c", "#7c94b3"];
    for (let i = 0; i < 4; i++) {
      const y = 0.36 + i * 0.46;
      box(name + " shelf items", x, floor + y + 0.11, z + d * 0.12, w * 0.86, 0.2, d * 0.68, tints[i % tints.length], {
        roughness: 0.55,
      });
    }
  };

  switch (type) {
    case "patient":
      bed(W > 3.4 ? -W / 4 : -0.22, undefined, true);
      if (W > 3.4) bed(W / 4, undefined, false);
      box(name + " bedside cabinet", W > 3.4 ? 0 : 0.62, floor + 0.29, back + 0.36, 0.44, 0.58, 0.44, WOOD);
      box(name + " cabinet top", W > 3.4 ? 0 : 0.62, floor + 0.6, back + 0.36, 0.46, 0.04, 0.46, WHITE, { roughness: 0.35 });
      break;
    case "exam":
      box(name + " exam couch", -W / 2 + 0.5, floor + 0.34, back + 0.2 + Math.min(0.9, D / 2 - 0.3), 0.72, 0.68, Math.min(1.8, D - 0.6), TEAL, { roughness: 0.65 });
      box(name + " exam pad", -W / 2 + 0.5, floor + 0.71, back + 0.2 + Math.min(0.9, D / 2 - 0.3), 0.68, 0.09, Math.min(1.74, D - 0.66), WHITE, { roughness: 0.85 });
      box(name + " desk", W / 2 - 0.5, floor + 0.37, back + 0.48, 0.84, 0.74, 0.6, WOOD);
      monitor(W / 2 - 0.5, floor + 0.74, back + 0.36);
      box(name + " stool", 0.08, floor + 0.24, 0.05, 0.34, 0.48, 0.34, STEEL, { metalness: 0.45, roughness: 0.35 });
      break;
    case "office":
      box(name + " desk", 0, floor + 0.37, back + 0.5, Math.min(1.3, W - 0.24), 0.74, 0.66, WOOD);
      monitor(0, floor + 0.74, back + 0.38);
      chair(0, back + 1.15);
      if (W > 1.9) shelves(W / 2 - 0.22, 0, 0.36, Math.min(1.2, D - 1), "#d6cbb5");
      break;
    case "waiting": {
      const cols = Math.max(1, Math.floor((W - 0.24) / 0.56)),
        rows = Math.max(1, Math.min(3, Math.floor((D - 1) / 0.92)));
      for (let j = 0; j < rows; j++) {
        const z = back + 0.45 + j * 0.92;
        // Continuous bench beam underneath each row.
        box(name + " bench beam", 0, floor + 0.2, z, Math.max(0.4, cols * 0.54), 0.08, 0.14, STEEL, { metalness: 0.5, roughness: 0.35 });
        for (let i = 0; i < cols; i++) {
          const x = -((cols - 1) * 0.54) / 2 + i * 0.54;
          box(name + " bench seat", x, floor + 0.34, z, 0.46, 0.09, 0.42, "#628674", { roughness: 0.8 });
          box(name + " bench back", x, floor + 0.58, z + 0.18, 0.46, 0.4, 0.07, "#628674", { roughness: 0.8 });
        }
      }
      if (D > 2.4) {
        box(name + " table", 0, floor + 0.2, D / 2 - 0.7, 0.84, 0.38, 0.5, WOOD);
        box(name + " table top", 0, floor + 0.4, D / 2 - 0.7, 0.86, 0.04, 0.52, WHITE, { roughness: 0.4 });
      }
      break;
    }
    case "reception":
      counter(0, 0, W - 0.3, 0.56, 1.02, WOOD);
      monitor(-Math.min(0.35, W / 5), floor + 1.06, -0.04);
      chair(-W / 4, back + 0.42);
      if (W > 1.9) {
        monitor(Math.min(0.35, W / 5), floor + 1.06, -0.04);
        chair(W / 4, back + 0.42);
      }
      break;
    case "nurse":
      counter(0, 0.1, W - 0.4, 0.5, 1.0, "#7fa694");
      counter(-W / 2 + 0.45, back + D / 2 - 0.1, 0.5, D / 2, 1.0, "#7fa694");
      counter(W / 2 - 0.45, back + D / 2 - 0.1, 0.5, D / 2, 1.0, "#7fa694");
      monitor(0, floor + 1.04, 0.06);
      chair(0, back + 0.38);
      break;
    case "toilet": {
      const stalls = Math.max(1, Math.floor(W / 0.95));
      for (let i = 0; i < stalls; i++) {
        const x = -W / 2 + (i + 0.5) * (W / stalls);
        box(name + " WC", x, floor + 0.2, back + 0.35, 0.38, 0.4, 0.54, WHITE, { roughness: 0.2 });
        box(name + " cistern", x, floor + 0.55, back + 0.1, 0.4, 0.35, 0.15, WHITE, { roughness: 0.2 });
        if (i) box(name + " partition", -W / 2 + i * (W / stalls), floor + 0.9, back + 0.55, 0.05, 1.8, 1.1, "#9fb8c2");
      }
      box(name + " basin", W / 2 - 0.3, floor + 0.85, D / 2 - 0.5, 0.35, 0.16, 0.46, WHITE, { roughness: 0.2 });
      break;
    }
    case "pharmacy":
      shelves(0, back + 0.25, W - 0.3, 0.4, "#e3d9df");
      counter(0, D / 2 - 0.55, W - 0.4, 0.5, 1.02, "#b58b9e");
      // Protective dispensing glass screen.
      box(name + " glass screen", 0, floor + 1.38, D / 2 - 0.42, W - 0.5, 0.58, 0.04, GLASS, {
        roughness: 0.12,
        transparent: true,
        opacity: 0.42,
        cast: false,
      });
      break;
    case "lab":
      counter(0, back + 0.35, W - 0.2, 0.6, 0.9, WHITE);
      counter(-W / 2 + 0.35, 0.2, 0.6, D - 1.4, 0.9, WHITE);
      for (let x = -W / 2 + 0.5; x < W / 2 - 0.3; x += 0.7)
        box(name + " equipment", x, floor + 1.08, back + 0.35, 0.36, 0.3, 0.36, x > 0 ? "#667aa8" : STEEL, {
          metalness: 0.35,
          roughness: 0.4,
        });
      box(name + " stool", 0.3, floor + 0.3, back + 1, 0.34, 0.6, 0.34, STEEL, { metalness: 0.45 });
      break;
    case "surgery":
      box(name + " operating base", 0, floor + 0.22, -0.2, 0.36, 0.44, 0.5, STEEL, { metalness: 0.55, roughness: 0.3 });
      box(name + " operating table", 0, floor + 0.62, -0.2, 0.64, 0.18, Math.min(2, D - 0.8), "#46757a", { roughness: 0.45 });
      box(name + " surgical lamp", 0, 2.38, -0.2, 0.86, 0.12, 0.86, WHITE, {
        roughness: 0.2,
        emissive: "#ffffff",
        emissiveIntensity: 0.3,
      });
      box(name + " lamp arm", 0, 2.58, -0.2, 0.06, 0.32, 0.06, STEEL, { metalness: 0.6 });
      box(name + " instrument cart", W / 2 - 0.4, floor + 0.44, back + 0.4, 0.5, 0.88, 0.4, STEEL, { metalness: 0.55, roughness: 0.3 });
      box(name + " monitor stand", -W / 2 + 0.35, floor + 0.65, back + 0.35, 0.38, 1.3, 0.38, SCREEN);
      monitor(-W / 2 + 0.35, floor + 1.3, back + 0.35);
      break;
    case "stairs": {
      const runW = W > 1.9 ? W / 2 - 0.1 : W - 0.2,
        steps = 8;
      for (let i = 0; i < steps; i++)
        box(
          name + " step",
          -W / 2 + 0.1 + runW / 2,
          floor + (i + 0.5) * 0.18,
          D / 2 - 0.3 - (i + 0.5) * ((D - 0.6) / steps),
          runW,
          (i + 1) * 0.18,
          (D - 0.6) / steps,
          "#cac5b9",
        );
      if (W > 1.9) {
        box(name + " lift car", W / 4, floor + 1.2, back + 0.8, W / 2 - 0.3, 2.4, 1.3, "#b8c3c6", {
          metalness: 0.45,
          roughness: 0.32,
        });
        box(name + " lift doors", W / 4, floor + 1.05, back + 1.46, W / 2 - 0.7, 2.1, 0.04, STEEL, {
          metalness: 0.68,
          roughness: 0.24,
        });
      }
      break;
    }
    case "storage":
      shelves(0, back + 0.25, W - 0.3, 0.4);
      if (D > 1.9) shelves(-W / 2 + 0.25, 0.1, 0.4, D - 1.2);
      break;
    case "radiology":
      box(name + " scanner gantry", -0.2, floor + 0.92, back + 0.55, 1.15, 1.84, 0.55, WHITE, { roughness: 0.28 });
      box(name + " scanner bore", -0.2, floor + 0.92, back + 0.55, 0.62, 0.62, 0.58, SCREEN, { roughness: 0.4 });
      box(name + " scanner table", -0.2, floor + 0.42, 0.12, 0.56, 0.76, Math.min(1.6, D - 1.1), "#95abc4", { roughness: 0.4 });
      box(name + " control desk", W / 2 - 0.4, floor + 0.37, D / 2 - 0.6, 0.52, 0.74, 0.8, WOOD);
      monitor(W / 2 - 0.4, floor + 0.74, D / 2 - 0.6);
      break;
    case "perinatology": {
      const cots = Math.max(1, Math.floor((W - 0.3) / 0.9)),
        z = back + 0.45;
      for (let i = 0; i < cots; i++) {
        const x = -W / 2 + 0.15 + (i + 0.5) * ((W - 0.3) / cots);
        box(name + " incubator stand", x, floor + 0.35, z, 0.6, 0.7, 0.45, WHITE, { roughness: 0.35 });
        box(name + " incubator mattress", x, floor + 0.74, z, 0.5, 0.08, 0.35, "#f4d6dc", { roughness: 0.85 });
        box(name + " incubator hood", x, floor + 0.93, z, 0.62, 0.3, 0.47, "#d9eef2", {
          roughness: 0.12,
          cast: false,
          transparent: true,
          opacity: 0.45,
        });
      }
      if (D > 2.4 && W > 2.6) counter(W / 2 - 0.55, D / 2 - 0.75, 0.8, 0.45, 0.9);
      break;
    }
    case "emergency":
      bed(-W / 3, undefined, true);
      bed(0, undefined, false);
      if (W > 2.6) bed(W / 3, undefined, true);
      box(name + " crash cart", W / 2 - 0.32, floor + 0.45, D / 2 - 0.5, 0.46, 0.9, 0.42, "#c44536", { roughness: 0.4 });
      box(name + " crash cart top", W / 2 - 0.32, floor + 0.92, D / 2 - 0.5, 0.48, 0.05, 0.44, WHITE, { roughness: 0.3 });
      break;
  }
}
