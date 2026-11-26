import * as THREE from "three";
import type { Piece } from "../model/layout.ts";
import { footprint, inPolygon, isCorridor, outline, roomColor, type RoomAsset, type Side } from "../model/interiors.ts";
import { buildingDoors } from "../wayfinding/navigation.ts";

/** Height of one storey in metres. */
export const STOREY = 3.6;

const WOOD = "#ad8f6c",
  WOOD_DARK = "#7d6449",
  FABRIC = "#4b696e",
  WHITE = "#f8faf5",
  STEEL = "#9ba8a9",
  STEEL_BRIGHT = "#d2dcde",
  TEAL = "#5c868a",
  HOSPITAL_GREEN = "#548a5b",
  BLANKET = "#6b9987",
  PARTITION = "#f4f2ea",
  SKIRTING = "#ccd4c8",
  GLASS = "#4b7382",
  WIN_FRAME = "#f4f7f2",
  ALU_FRAME = "#3a4d4f",
  TRIM_WHITE = "#eef2ea",
  SILL = "#e6ebe2",
  RED_ACCENT = "#c42e33",
  PHTC_WALL = "#f0f2ee",
  PHTC_STONE = "#d8ccb2",
  PHTC_FLOOR = "#eff1ec",
  STAIR_STEP = "#d8d4c8",
  STAIR_NOSING = "#343e41",
  LIFT_SHAFT = "#b0bcc0",
  LIFT_DOOR = "#8b9ba0",
  LIFT_SEAM = "#232d30",
  LIFT_GLOW = "#4ade80",
  CALL_GLOW = "#fbbf24",
  PLANTER_LEAF = "#4e8c54",
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
  rotY?: number;
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
    if (opts.rotY) mesh.rotation.y = opts.rotY;
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

/** Detect warm-red roof/accent buildings (e.g. Emergency / Unit Pengelola Darah). */
function isRedAccent(p: Piece) {
  if (!p.roofColor || !/^#[0-9a-f]{6}$/i.test(p.roofColor)) return false;
  const r = parseInt(p.roofColor.slice(1, 3), 16);
  const g = parseInt(p.roofColor.slice(3, 5), 16);
  const b = parseInt(p.roofColor.slice(5, 7), 16);
  return r >= 150 && r > g * 1.35 && r > b * 1.35;
}

/** Inset an axis-aligned 2D polygon (metres) inward by `margin` metres. */
function insetPolygon(pts: { x: number; y: number }[], margin: number) {
  if (margin <= 0 || pts.length < 3) return pts;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  const cw = area > 0 ? 1 : -1;
  const inward = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (-(b.y - a.y) / l) * cw, y: ((b.x - a.x) / l) * cw };
  };
  return pts.map((v, i) => {
    const prev = pts[(i + pts.length - 1) % pts.length];
    const next = pts[(i + 1) % pts.length];
    const n1 = inward(prev, v);
    const n2 = inward(v, next);
    return { x: v.x + margin * (n1.x + n2.x), y: v.y + margin * (n1.y + n2.y) };
  });
}

export function buildingInterior(p: Piece, pieces: Piece[], cutaway: boolean) {
  const group = new THREE.Group();
  group.name = p.name;
  group.userData.pieceId = p.id;
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const box = boxes(group, materials);
  const isPhtc = p.kind === "phtc";
  const floors = p.floors ?? 1,
    H = STOREY * floors,
    wallH = cutaway ? 0.68 : H;

  const rawPts = footprint({ ...p, x: 0, y: 0 }).map((v) => ({ x: v.x * 2, y: v.y * 2 }));
  // When PHTC is closed, inset the interior floor slab cleanly so it never Z-fights with `phtcModel`.
  const slabPts = isPhtc && !cutaway ? insetPolygon(rawPts, 0.18) : rawPts;
  const floor = new THREE.Shape(slabPts.map((v) => new THREE.Vector2(v.x, v.y)));
  const floorGeometry = new THREE.ExtrudeGeometry(floor, { depth: 0.25, bevelEnabled: false });
  floorGeometry.rotateX(Math.PI / 2);
  floorGeometry.translate(0, 0.275, 0);
  const slab = new THREE.Mesh(
    floorGeometry,
    new THREE.MeshStandardMaterial({ color: isPhtc ? PHTC_FLOOR : "#eaede5", roughness: 0.72 }),
  );
  slab.name = "Interior floor";
  slab.receiveShadow = true;
  slab.userData.generated = true;
  group.add(slab);

  // Critical PHTC contract: when `phtc` is closed (!cutaway), `phtcModel` in models.ts owns
  // the bespoke exterior shell. Only render the inset floor slab here so room partitions never
  // poke through PHTC's recessed ground-floor curtain wall; cutaway & roaming pass cutaway=true.
  if (!(isPhtc && !cutaway)) {
    const doors = buildingDoors(p, pieces);
    const redAccent = !isPhtc && isRedAccent(p);
    const wallColor = isPhtc ? PHTC_WALL : p.color;
    const band = shade(wallColor, -0.18);
    const plinth = isPhtc ? PHTC_STONE : shade(wallColor, -0.26);
    const pilasterColor = floors >= 2 || redAccent ? TRIM_WHITE : shade(wallColor, 0.24);
    const fasciaRed = redAccent ? RED_ACCENT : "";
    const porchPillarColor = redAccent ? RED_ACCENT : shade(wallColor, 0.28);

    const touchesCorridor = (side: Side, offsetTiles: number, lineTiles: number) => {
      const horiz = side === "north" || side === "south";
      const outSign = side === "north" || side === "west" ? -1 : 1;
      const probe = {
        x: p.x + (horiz ? offsetTiles : lineTiles + outSign * 0.25),
        y: p.y + (horiz ? lineTiles + outSign * 0.25 : offsetTiles),
      };
      return pieces.some((o) => o.id !== p.id && isCorridor(o) && inPolygon(probe, footprint(o)));
    };

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
          offsetTiles: d.offset,
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

      // Crisp RSUD Mamuju Tengah white-framed double hospital window at position `v` on floor `f`.
      // Note: only `"Window glazing"` carries `window|glazing` in its name so night-glow lights only the glass!
      const placeWindow = (v: number, f: number) => {
        const y = f * STOREY + 1.98;
        // White outer casement surround frame.
        run("Casement frame", v - 0.68, v + 0.68, y, 1.46, WIN_FRAME, 0.05, 0.095, {
          roughness: 0.42,
          metalness: 0.08,
        });
        // Reflective blue-grey tinted glass pane.
        run("Window glazing", v - 0.58, v + 0.58, y, 1.3, GLASS, 0.032, 0.112, {
          roughness: 0.15,
          metalness: 0.34,
        });
        // Crisp white vertical center mullion + upper transom bar.
        run("Casement mullion", v - 0.032, v + 0.032, y, 1.36, WIN_FRAME, 0.035, 0.122, {
          roughness: 0.42,
          metalness: 0.08,
        });
        run("Casement transom", v - 0.58, v + 0.58, y + 0.34, 0.045, WIN_FRAME, 0.035, 0.122, {
          roughness: 0.42,
          metalness: 0.08,
        });
        // Projecting light stone/white sill.
        run("Facade sill", v - 0.74, v + 0.74, y - 0.76, 0.08, SILL, 0.13, 0.14, { roughness: 0.76 });
        // Sun-shading louver/eyebrow hood on ground floor and multi-storey facades.
        if (f === 0 || floors >= 2) {
          run("Sun hood", v - 0.75, v + 0.75, y + 0.78, 0.07, floors >= 2 ? TRIM_WHITE : band, 0.2, 0.165, {
            roughness: 0.62,
          });
        }
      };

      // Subtle wall-mounted exterior AC condenser unit (Photo 2 hospital detail).
      const placeAcUnit = (v: number, y: number) => {
        run("AC housing", v - 0.32, v + 0.32, y, 0.44, "#eaeee8", 0.24, 0.2, { roughness: 0.52, metalness: 0.15 });
        run("AC grille", v - 0.19, v + 0.09, y, 0.3, "#2d383a", 0.03, 0.32, { roughness: 0.6, metalness: 0.3 });
      };

      const windows = (a: number, b: number) => {
        if (cutaway) return;
        const span = b - a;
        const count = Math.floor((span - 0.6) / 2.4);
        const showPiers = floors >= 3 || (p.kind === "flat" && (floors >= 2 || length >= 10));
        const midTile = edge.from + (a + b) / 4;
        const corridorSide = touchesCorridor(side, midTile, edge.at);

        for (let i = 0; i < count; i++) {
          const v = a + ((i + 0.5) * span) / count;
          for (let f = 0; f < floors; f++) placeWindow(v, f);

          // Sleek vertical architectural accent piers between window bays on tall/large facades.
          if (showPiers && i < count - 1) {
            const pierV = a + ((i + 1) * span) / count;
            const pierBottom = 0.45;
            const pierTop = H - (redAccent ? 0.32 : 0.08);
            run(
              "Facade pier",
              pierV - 0.09,
              pierV + 0.09,
              (pierBottom + pierTop) / 2,
              pierTop - pierBottom,
              TRIM_WHITE,
              0.08,
              0.105,
              { roughness: 0.65 },
            );
          }

          // Subtle AC outdoor unit below alternating windows on open side walls (no corridor right outside).
          if (!corridorSide && span >= 4.2 && cuts.length === 0 && i % 2 === 0 && i < 4) {
            placeAcUnit(v, 0.84);
          }
        }

        // Blank side wall (too narrow for two windows or windowless side): tuck one AC unit neatly.
        if (count === 0 && !corridorSide && span >= 1.8 && cuts.length === 0) {
          placeAcUnit((a + b) / 2, 2.15);
        }
      };

      let cursor = 0;
      for (const c of cuts) {
        run("Exterior wall", cursor, c.start, wallH / 2 + 0.25, wallH, wallColor);
        if (cutaway) {
          run("Cutaway wall cap", cursor, c.start, wallH + 0.265, 0.035, isPhtc ? PHTC_STONE : SKIRTING, 0.19, 0, {
            cast: false,
            roughness: 0.68,
          });
        } else {
          run("Exterior plinth", cursor, c.start, 0.29, 0.34, plinth, 0.05, 0.1);
        }
        windows(cursor, c.start);

        const doorMid = (c.start + c.end) / 2;
        const doorW = c.end - c.start;

        if (!cutaway) {
          // Continuous wall above door head (y = 2.55 up to H + 0.25) with zero gap.
          const upperH = H + 0.25 - 2.55;
          if (upperH > 0.05) {
            run("Exterior wall", c.start, c.end, 2.55 + upperH / 2, upperH, wallColor);
          }
          // Upper-floor windows aligned over ground-floor entrance on multi-storey buildings.
          if (floors >= 2 && doorW >= 1.35) {
            for (let f = 1; f < floors; f++) placeWindow(doorMid, f);
          }
        }

        const door = at(doorMid, 0);

        if (cutaway) {
          box(
            "Door threshold",
            door.x,
            0.3,
            door.z,
            horizontal ? doorW : 0.3,
            0.04,
            horizontal ? 0.3 : doorW,
            isPhtc ? "#8ea2a6" : "#52747a",
            { cast: false },
          );
          cursor = Math.max(cursor, c.end);
          continue;
        }

        // Double sliding glass entrance doors with crisp white/aluminum framing.
        box(
          "Entrance glass door",
          door.x,
          1.35,
          door.z,
          horizontal ? doorW - 0.12 : 0.08,
          2.16,
          horizontal ? 0.08 : doorW - 0.12,
          GLASS,
          { roughness: 0.15, metalness: 0.35 },
        );
        // Center seam + mid horizontal push-bar + upper transom bar.
        box(
          "Door center seam",
          door.x,
          1.35,
          door.z,
          horizontal ? 0.04 : 0.11,
          2.16,
          horizontal ? 0.11 : 0.04,
          ALU_FRAME,
          { roughness: 0.38, metalness: 0.35 },
        );
        box(
          "Door push bar",
          door.x,
          1.06,
          door.z,
          horizontal ? doorW - 0.14 : 0.11,
          0.04,
          horizontal ? 0.11 : doorW - 0.14,
          STEEL_BRIGHT,
          { roughness: 0.28, metalness: 0.65 },
        );
        box(
          "Door transom bar",
          door.x,
          2.18,
          door.z,
          horizontal ? doorW - 0.1 : 0.11,
          0.05,
          horizontal ? 0.11 : doorW - 0.1,
          WIN_FRAME,
          { roughness: 0.4, metalness: 0.15 },
        );
        // Left and right white/aluminum door jambs.
        for (const sideSign of [-1, 1]) {
          const jamb = at(doorMid + sideSign * (doorW / 2 - 0.04), 0.01);
          box(
            "Door jamb",
            jamb.x,
            1.36,
            jamb.z,
            horizontal ? 0.09 : 0.19,
            2.24,
            horizontal ? 0.19 : 0.09,
            WIN_FRAME,
            { roughness: 0.42, metalness: 0.12 },
          );
        }
        box(
          "Door lintel",
          door.x,
          2.5,
          door.z,
          horizontal ? doorW + 0.18 : 0.22,
          0.16,
          horizontal ? 0.22 : doorW + 0.18,
          WIN_FRAME,
          { roughness: 0.45, metalness: 0.12 },
        );

        const corridorDoor = touchesCorridor(side, c.offsetTiles, edge.at);
        if (corridorDoor) {
          // Corridor-connected doorway: sleek projecting transom eyebrow that doesn't obstruct the walkway.
          const canopy = at(doorMid, 0.24);
          box(
            "Door canopy",
            canopy.x,
            2.63,
            canopy.z,
            horizontal ? doorW + 0.34 : 0.34,
            0.09,
            horizontal ? 0.34 : doorW + 0.34,
            TRIM_WHITE,
            { roughness: 0.58 },
          );
        } else {
          // Open-air hospital entrance porch with cantilevered canopy, landing pad, and neat slim columns (Photos 1 & 2).
          const porchW = doorW + 0.68;
          const canopy = at(doorMid, 0.46);
          const canopyColor = p.kind === "flat" ? shade(wallColor, 0.25) : TRIM_WHITE;
          box(
            "Porch canopy",
            canopy.x,
            2.68,
            canopy.z,
            horizontal ? porchW : 0.84,
            0.14,
            horizontal ? 0.84 : porchW,
            canopyColor,
            { roughness: 0.58 },
          );
          // Crisp thin white drip edge along porch canopy front.
          const drip = at(doorMid, 0.87);
          box(
            "Porch fascia",
            drip.x,
            2.68,
            drip.z,
            horizontal ? porchW + 0.04 : 0.04,
            0.16,
            horizontal ? 0.04 : porchW + 0.04,
            TRIM_WHITE,
            { roughness: 0.55 },
          );
          // Grounded concrete entrance step pad.
          const step = at(doorMid, 0.45);
          box(
            "Porch landing",
            step.x,
            0.13,
            step.z,
            horizontal ? porchW + 0.1 : 0.84,
            0.24,
            horizontal ? 0.84 : porchW + 0.1,
            "#d5dbd2",
            { roughness: 0.78 },
          );
          // Two slim square porch columns (red on red-fascia buildings like Photo 2!).
          for (const sideSign of [-1, 1]) {
            const colPos = at(doorMid + sideSign * (porchW / 2 - 0.14), 0.74);
            box("Porch column", colPos.x, 1.44, colPos.z, 0.13, 2.38, 0.13, porchPillarColor, { roughness: 0.62 });
            box("Porch footing", colPos.x, 0.3, colPos.z, 0.18, 0.1, 0.18, "#cfd6cc", { roughness: 0.75 });
          }
        }

        cursor = Math.max(cursor, c.end);
      }

      run("Exterior wall", cursor, length, wallH / 2 + 0.25, wallH, wallColor);
      if (cutaway) {
        run("Cutaway wall cap", cursor, length, wallH + 0.265, 0.035, isPhtc ? PHTC_STONE : SKIRTING, 0.19, 0, {
          cast: false,
          roughness: 0.68,
        });
      } else {
        run("Exterior plinth", cursor, length, 0.29, 0.34, plinth, 0.05, 0.1);
      }
      windows(cursor, length);

      if (!cutaway) {
        // Crisp projecting horizontal concrete floor-slab bands between storeys (so 2-3 storey buildings read clearly).
        for (let f = 1; f < floors; f++) {
          run("Storey band", 0, length, f * STOREY + 0.25, 0.22, TRIM_WHITE, 0.1, 0.115, { roughness: 0.62 });
          run("Storey shadow lip", 0, length, f * STOREY + 0.13, 0.04, band, 0.06, 0.1, { roughness: 0.72 });
        }

        // Upper architectural fascia band: bold red accent for red-roofed blocks (Photo 2), crisp white otherwise.
        if (redAccent) {
          const fasciaH = p.kind === "flat" ? 0.56 : 0.34;
          run("Red accent fascia", 0, length, H + 0.25 - fasciaH / 2, fasciaH, fasciaRed, 0.07, 0.105, {
            roughness: 0.5,
          });
          run("Fascia stripe", 0, length, H + 0.25 - fasciaH - 0.03, 0.06, WIN_FRAME, 0.08, 0.11, { roughness: 0.5 });
        } else if (floors >= 3 || p.kind === "flat") {
          run("Upper fascia", 0, length, H + 0.11, 0.28, TRIM_WHITE, 0.07, 0.105, { roughness: 0.62 });
        } else {
          run("Eave trim", 0, length, H + 0.17, 0.16, WIN_FRAME, 0.06, 0.1, { roughness: 0.6 });
        }

        run("Parapet coping", 0, length, H + 0.3, 0.11, redAccent ? fasciaRed : band, 0.24, 0.03, { roughness: 0.62 });
      }
    }

    // Crisp vertical corner pilasters placed once per footprint vertex (zero corner Z-fighting!).
    if (!cutaway) {
      const cornerCenters = insetPolygon(rawPts, 0.08);
      for (const c of cornerCenters) {
        box("Corner pilaster", c.x, H / 2 + 0.25, c.y, 0.22, H, 0.22, pilasterColor, { roughness: 0.66 });
        box("Corner plinth", c.x, 0.29, c.y, 0.25, 0.34, 0.25, plinth, { roughness: 0.75 });
      }
    }
    for (const r of p.roomAssets ?? []) group.add(room(r, cutaway, materials));
  }

  group.position.set(p.x * 2, 0, p.y * 2);
  return group;
}

const facing = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 };
const OPEN_PLAN_ROOMS = new Set<RoomAsset["type"]>(["waiting", "reception", "nurse", "stairs"]);

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

  // Room floor + subtle interior floor tile trim + crisp partition walls.
  box(r.name + " floor", 0, 0.3, 0, W, 0.1, D, roomColor(r), { cast: false, roughness: 0.76 });
  box(r.name + " back wall", 0, h / 2 + 0.3, back, W, h, 0.1, PARTITION);
  box(r.name + " side wall", -W / 2, h / 2 + 0.3, 0, 0.1, h, D, PARTITION);
  box(r.name + " side wall", W / 2, h / 2 + 0.3, 0, 0.1, h, D, PARTITION);

  const wing = Math.max(0, (W - 0.86) / 2);
  box(r.name + " front wall", -W / 2 + wing / 2, h / 2 + 0.3, front, wing, h, 0.1, PARTITION);
  box(r.name + " front wall", W / 2 - wing / 2, h / 2 + 0.3, front, wing, h, 0.1, PARTITION);

  // Clean architectural maquette wall-top caps in cutaway mode.
  if (cutaway) {
    box(r.name + " back cap", 0, h + 0.315, back, W + 0.09, 0.03, 0.125, SKIRTING, { cast: false });
    box(r.name + " side cap", -W / 2, h + 0.315, 0, 0.125, 0.03, D, SKIRTING, { cast: false });
    box(r.name + " side cap", W / 2, h + 0.315, 0, 0.125, 0.03, D, SKIRTING, { cast: false });
    if (wing > 0.05) {
      box(r.name + " front cap", -W / 2 + wing / 2, h + 0.315, front, wing, 0.03, 0.125, SKIRTING, { cast: false });
      box(r.name + " front cap", W / 2 - wing / 2, h + 0.315, front, wing, 0.03, 0.125, SKIRTING, { cast: false });
    }
  }

  // Crisp wood/steel door jambs + subtle interior floor threshold strip.
  box(r.name + " door jamb", -0.43, h / 2 + 0.3, front, 0.05, h, 0.13, WOOD_DARK, { cast: false });
  box(r.name + " door jamb", 0.43, h / 2 + 0.3, front, 0.05, h, 0.13, WOOD_DARK, { cast: false });
  box(r.name + " door sill", 0, 0.352, front, 0.84, 0.015, 0.13, "#cfd6cc", { cast: false, roughness: 0.55 });
  if (!cutaway) box(r.name + " door head", 0, 2.55, front, 0.86, 0.3, 0.1, PARTITION);

  // Subtle inward-angled open door leaf swing hint for enclosed rooms in cutaway view.
  if (cutaway && !OPEN_PLAN_ROOMS.has(r.type) && W > 1.5 && D > 1.75) {
    box(r.name + " door leaf", -0.22, h / 2 + 0.3, front - 0.22, 0.56, h - 0.04, 0.035, WOOD, {
      cast: false,
      roughness: 0.62,
      rotY: -Math.PI / 4,
    });
  }

  furnish(box, r.type, W, D, r.name, cutaway);
  g.traverse((o) => (o.userData.roomId = r.id));
  return g;
}

/** Detect a hospital IT / Server / SIMRS room for the creator Easter egg. */
export const isServerRoom = (name: string) => /\b(server|ruang it|simrs|data ?center|pusdatin|jaringan|noc)\b/i.test(name);

/** Furniture in the room's local frame: back wall at -D/2, door at +D/2. */
function furnish(box: Box, type: RoomAsset["type"], W: number, D: number, name: string, cutaway: boolean) {
  const back = -D / 2,
    front = D / 2,
    floor = 0.35;

  // Easter egg: Putu Mahendra (creator of AIRMA) coding at dual monitors in the Server Room!
  if (isServerRoom(name)) {
    // Glowing server racks along the back wall.
    const racks = Math.max(1, Math.min(3, Math.floor((W - 0.3) / 0.72)));
    for (let i = 0; i < racks; i++) {
      const rx = -((racks - 1) * 0.68) / 2 + i * 0.68;
      box(name + " server rack", rx, floor + 0.95, back + 0.32, 0.56, 1.9, 0.52, "#1f292b", {
        roughness: 0.4,
        metalness: 0.45,
      });
      // Blinking green & cyan server LED status strips (zero runtime light cost).
      for (let row = 0; row < 4; row++) {
        const ly = floor + 0.45 + row * 0.36;
        box(name + " server led", rx - 0.12, ly, back + 0.59, 0.22, 0.04, 0.02, "#4ade80", {
          emissive: "#4ade80",
          emissiveIntensity: 0.85,
          cast: false,
        });
        box(name + " server led", rx + 0.14, ly, back + 0.59, 0.08, 0.04, 0.02, "#38bdf8", {
          emissive: "#38bdf8",
          emissiveIntensity: 0.8,
          cast: false,
        });
      }
    }

    // Developer desk + dual glowing AIRMA monitors + coffee mug.
    const deskZ = Math.min(0.15, D / 2 - 0.85);
    const deskW = Math.min(1.45, W - 0.35);
    box(name + " dev desk", 0, floor + 0.37, deskZ, deskW, 0.74, 0.62, WOOD_DARK, { roughness: 0.6 });
    for (const mx of [-0.26, 0.26]) {
      box(name + " monitor stand", mx, floor + 0.78, deskZ - 0.14, 0.08, 0.1, 0.08, SCREEN);
      box(name + " monitor screen", mx, floor + 0.98, deskZ - 0.14, 0.42, 0.28, 0.04, "#162420", {
        roughness: 0.2,
        emissive: "#5ee68a",
        emissiveIntensity: 0.45,
      });
    }
    // Keyboard + coffee mug.
    box(name + " keyboard", 0, floor + 0.76, deskZ + 0.08, 0.36, 0.03, 0.12, "#2d3739");
    box(name + " coffee mug", deskW / 2 - 0.16, floor + 0.8, deskZ + 0.1, 0.08, 0.11, 0.08, WHITE);

    // Putu Mahendra seated at the desk working on AIRMA!
    const devZ = deskZ + 0.48;
    // Office chair.
    box(name + " dev chair base", 0, floor + 0.2, devZ, 0.38, 0.4, 0.38, "#2b3336", { metalness: 0.4 });
    box(name + " dev chair back", 0, floor + 0.68, devZ + 0.2, 0.42, 0.56, 0.07, "#2b3336");
    // Seated creator figure (forest-pine hoodie, dark trousers, head, hair, arms reaching keyboard).
    box(name + " creator legs", 0, floor + 0.42, devZ - 0.1, 0.34, 0.18, 0.42, "#2f3942");
    box(name + " creator torso", 0, floor + 0.76, devZ + 0.02, 0.36, 0.48, 0.22, "#1e4031");
    box(name + " creator arms", -0.2, floor + 0.78, devZ - 0.16, 0.1, 0.11, 0.34, "#1e4031");
    box(name + " creator arms", 0.2, floor + 0.78, devZ - 0.16, 0.1, 0.11, 0.34, "#1e4031");
    box(name + " creator head", 0, floor + 1.14, devZ + 0.01, 0.22, 0.24, 0.22, "#a8714a");
    box(name + " creator hair", 0, floor + 1.24, devZ + 0.03, 0.23, 0.09, 0.23, "#1f1c1a");
    return;
  }

  const bed = (x: number, len = Math.min(1.92, D - 0.5), iv = false) => {
    const z = back + 0.12 + len / 2;
    // Frame, oak headboard with top rail, footboard, mattress, folded hospital blanket, pillows, and side rails.
    box(name + " bed base", x, floor + 0.18, z, 0.94, 0.32, len, TEAL, { roughness: 0.55, metalness: 0.15 });
    box(name + " headboard", x, floor + 0.52, back + 0.14, 0.96, 0.64, 0.07, WOOD, { roughness: 0.65 });
    box(name + " headboard cap", x, floor + 0.85, back + 0.14, 0.98, 0.04, 0.08, WOOD_DARK, { roughness: 0.55 });
    box(name + " footboard", x, floor + 0.38, z + len / 2 - 0.03, 0.94, 0.38, 0.05, WOOD, { roughness: 0.65 });
    box(name + " mattress", x, floor + 0.41, z, 0.88, 0.16, len - 0.1, WHITE, { roughness: 0.85 });
    box(name + " blanket", x, floor + 0.44, z + len * 0.16, 0.9, 0.14, len * 0.54, BLANKET, { roughness: 0.88 });
    box(name + " blanket fold", x, floor + 0.515, z - len * 0.08, 0.9, 0.04, 0.14, "#e6f0eb", { roughness: 0.86 });
    box(name + " pillow", x, floor + 0.54, back + 0.37, 0.66, 0.11, 0.32, "#dbe9ee", { roughness: 0.9 });
    // Slim brushed-steel safety side rails on both sides.
    for (const s of [-1, 1]) {
      box(name + " bed rail", x + s * 0.46, floor + 0.53, z - 0.1, 0.03, 0.16, len * 0.46, STEEL_BRIGHT, {
        metalness: 0.55,
        roughness: 0.32,
      });
    }
    if (iv) {
      const ivH = cutaway ? 1.25 : 1.65;
      box(name + " iv base", x - 0.58, floor + 0.03, back + 0.45, 0.24, 0.05, 0.24, STEEL, {
        metalness: 0.5,
        roughness: 0.35,
      });
      box(name + " iv pole", x - 0.58, floor + ivH / 2, back + 0.45, 0.03, ivH, 0.03, STEEL_BRIGHT, {
        metalness: 0.65,
        roughness: 0.28,
      });
      box(name + " iv bag", x - 0.58, floor + ivH - 0.12, back + 0.52, 0.08, 0.16, 0.05, "#d8f0f5", {
        roughness: 0.2,
        transparent: true,
        opacity: 0.82,
      });
    }
  };

  const chair = (x: number, z: number, color = FABRIC) => {
    box(name + " chair leg", x, floor + 0.16, z, 0.36, 0.32, 0.36, STEEL, { metalness: 0.45, roughness: 0.4 });
    box(name + " chair seat", x, floor + 0.35, z, 0.44, 0.09, 0.44, color, { roughness: 0.82 });
    box(name + " chair back", x, floor + 0.6, z + 0.19, 0.44, 0.42, 0.07, color, { roughness: 0.82 });
  };

  const planter = (x: number, z: number) => {
    box(name + " planter pot", x, floor + 0.18, z, 0.32, 0.36, 0.32, WHITE, { roughness: 0.45 });
    box(name + " planter soil", x, floor + 0.36, z, 0.26, 0.04, 0.26, "#4d3e31", { roughness: 0.9 });
    box(name + " planter foliage", x, floor + 0.58, z, 0.38, 0.42, 0.38, PLANTER_LEAF, { roughness: 0.82 });
    box(name + " planter crown", x, floor + 0.82, z, 0.26, 0.18, 0.26, "#66a868", { roughness: 0.82 });
  };

  const monitor = (x: number, y: number, z: number) => {
    box(name + " monitor stand", x, y + 0.06, z, 0.14, 0.12, 0.1, SCREEN, { roughness: 0.4, metalness: 0.3 });
    box(name + " monitor screen", x, y + 0.25, z, 0.38, 0.26, 0.04, SCREEN, {
      roughness: 0.25,
      emissive: SCREEN_GLOW,
      emissiveIntensity: 0.28,
    });
  };

  const counter = (x: number, z: number, w: number, d: number, h = 1.02, color = WOOD, accent?: string) => {
    box(name + " counter", x, floor + h / 2, z, w, h, d, color, { roughness: 0.68 });
    box(name + " counter lip", x, floor + h + 0.025, z, w + 0.04, 0.05, d + 0.05, WHITE, { roughness: 0.36 });
    if (accent) {
      // Hospital accent fascia strip on the visitor-facing front side (+z).
      box(name + " counter accent", x, floor + h * 0.54, z + d / 2 + 0.012, Math.max(0.1, w - 0.12), h * 0.62, 0.025, accent, {
        roughness: 0.55,
      });
    }
  };

  const shelves = (x: number, z: number, w: number, d: number, color = "#cfd6d1") => {
    const shelfH = cutaway ? 1.12 : 1.96;
    const levels = cutaway ? 2 : 4;
    box(name + " shelving", x, floor + shelfH / 2, z, w, shelfH, d, color, { roughness: 0.65 });
    const tints = ["#7fa4a8", "#9eb89d", "#c9a87c", "#7c94b3"];
    for (let i = 0; i < levels; i++) {
      const y = 0.3 + i * 0.44;
      box(name + " shelf items", x, floor + y + 0.11, z + d * 0.12, w * 0.86, 0.2, d * 0.68, tints[i % tints.length], {
        roughness: 0.55,
      });
    }
  };

  switch (type) {
    case "patient": {
      const twoBeds = W > 3.4;
      bed(twoBeds ? -W / 4 : -0.22, undefined, true);
      if (twoBeds) bed(W / 4, undefined, false);
      const cabX = twoBeds ? 0 : 0.62;
      box(name + " bedside cabinet", cabX, floor + 0.29, back + 0.36, 0.44, 0.58, 0.44, WOOD);
      box(name + " cabinet drawer", cabX, floor + 0.4, back + 0.59, 0.36, 0.16, 0.02, WOOD_DARK);
      box(name + " cabinet top", cabX, floor + 0.6, back + 0.36, 0.46, 0.04, 0.46, WHITE, { roughness: 0.35 });
      box(name + " bedside carafe", cabX + 0.08, floor + 0.68, back + 0.34, 0.08, 0.13, 0.08, "#cce6ec", {
        roughness: 0.2,
      });
      if (D > 3.1) {
        chair(twoBeds ? 0 : 0.6, front - 0.72, "#5b7d6a");
      }
      break;
    }
    case "exam": {
      const couchLen = Math.min(1.8, D - 0.6);
      const couchZ = back + 0.2 + couchLen / 2;
      box(name + " exam couch", -W / 2 + 0.5, floor + 0.34, couchZ, 0.72, 0.68, couchLen, TEAL, { roughness: 0.65 });
      box(name + " exam pad", -W / 2 + 0.5, floor + 0.71, couchZ, 0.68, 0.09, couchLen - 0.06, WHITE, {
        roughness: 0.85,
      });
      box(name + " exam pillow", -W / 2 + 0.5, floor + 0.79, back + 0.38, 0.5, 0.09, 0.24, "#dbe9ee", {
        roughness: 0.88,
      });
      box(name + " desk", W / 2 - 0.5, floor + 0.37, back + 0.48, 0.84, 0.74, 0.6, WOOD);
      box(name + " desk top", W / 2 - 0.5, floor + 0.75, back + 0.48, 0.86, 0.03, 0.62, WHITE, { roughness: 0.38 });
      monitor(W / 2 - 0.5, floor + 0.76, back + 0.36);
      box(name + " stool", 0.08, floor + 0.24, 0.05, 0.34, 0.48, 0.34, STEEL_BRIGHT, {
        metalness: 0.5,
        roughness: 0.32,
      });
      if (D > 2.6) chair(W / 2 - 0.5, back + 1.05, FABRIC);
      break;
    }
    case "office":
      box(name + " desk", 0, floor + 0.37, back + 0.5, Math.min(1.3, W - 0.24), 0.74, 0.66, WOOD);
      box(name + " desk top", 0, floor + 0.75, back + 0.5, Math.min(1.32, W - 0.22), 0.03, 0.68, WHITE, {
        roughness: 0.4,
      });
      monitor(0, floor + 0.76, back + 0.38);
      chair(0, back + 1.15);
      if (W > 1.9) shelves(W / 2 - 0.22, 0, 0.36, Math.min(1.2, D - 1), "#d6cbb5");
      break;
    case "waiting": {
      const cols = Math.max(1, Math.floor((W - 0.36) / 0.56)),
        rows = Math.max(1, Math.min(3, Math.floor((D - 1) / 0.92)));
      for (let j = 0; j < rows; j++) {
        const z = back + 0.45 + j * 0.92;
        const beamW = Math.max(0.4, cols * 0.54);
        // Continuous steel bench beam + end armrests.
        box(name + " bench beam", 0, floor + 0.2, z, beamW, 0.08, 0.14, STEEL, { metalness: 0.5, roughness: 0.35 });
        for (const sideSign of [-1, 1]) {
          box(name + " bench leg", sideSign * (beamW / 2 - 0.08), floor + 0.12, z, 0.06, 0.24, 0.36, STEEL, {
            metalness: 0.5,
            roughness: 0.35,
          });
          box(name + " bench armrest", sideSign * (beamW / 2 + 0.02), floor + 0.48, z, 0.05, 0.05, 0.38, STEEL_BRIGHT, {
            metalness: 0.6,
            roughness: 0.28,
          });
        }
        for (let i = 0; i < cols; i++) {
          const x = -((cols - 1) * 0.54) / 2 + i * 0.54;
          box(name + " bench seat", x, floor + 0.34, z, 0.46, 0.09, 0.42, "#5c856b", { roughness: 0.8 });
          box(name + " bench back", x, floor + 0.58, z + 0.18, 0.46, 0.4, 0.07, "#5c856b", { roughness: 0.8 });
        }
      }
      if (D > 2.4) {
        box(name + " table", 0, floor + 0.2, D / 2 - 0.72, 0.84, 0.38, 0.5, WOOD);
        box(name + " table top", 0, floor + 0.4, D / 2 - 0.72, 0.86, 0.04, 0.52, WHITE, { roughness: 0.4 });
        if (W > 2.2) planter(-W / 2 + 0.32, D / 2 - 0.45);
      }
      break;
    }
    case "reception":
      counter(0, 0, W - 0.34, 0.56, 1.0, WOOD, HOSPITAL_GREEN);
      monitor(-Math.min(0.35, W / 5), floor + 1.05, -0.04);
      chair(-W / 4, back + 0.42);
      if (W > 1.9) {
        monitor(Math.min(0.35, W / 5), floor + 1.05, -0.04);
        chair(W / 4, back + 0.42);
      }
      if (W > 2.8 && D > 2.2) planter(W / 2 - 0.32, front - 0.42);
      break;
    case "nurse":
      counter(0, 0.1, W - 0.4, 0.5, 0.98, "#6ea07c", WHITE);
      if (W > 2.0) {
        counter(-W / 2 + 0.45, back + D / 2 - 0.1, 0.48, Math.max(0.4, D / 2), 0.98, "#6ea07c");
        counter(W / 2 - 0.45, back + D / 2 - 0.1, 0.48, Math.max(0.4, D / 2), 0.98, "#6ea07c");
      }
      monitor(0, floor + 1.03, 0.06);
      box(name + " chart binder", Math.min(0.45, W / 4), floor + 1.05, 0.08, 0.22, 0.06, 0.28, "#3e6b52");
      chair(0, back + 0.38);
      break;
    case "toilet": {
      const stalls = Math.max(1, Math.floor(W / 0.95));
      const partH = cutaway ? 0.64 : 1.8;
      for (let i = 0; i < stalls; i++) {
        const x = -W / 2 + (i + 0.5) * (W / stalls);
        box(name + " WC", x, floor + 0.2, back + 0.35, 0.38, 0.4, 0.54, WHITE, { roughness: 0.2 });
        box(name + " cistern", x, floor + 0.55, back + 0.1, 0.4, 0.35, 0.15, WHITE, { roughness: 0.2 });
        if (i) {
          box(name + " partition", -W / 2 + i * (W / stalls), floor + partH / 2, back + 0.55, 0.05, partH, 1.05, "#9fb8c2");
        }
      }
      box(name + " basin", W / 2 - 0.28, floor + 0.82, D / 2 - 0.5, 0.34, 0.16, 0.46, WHITE, { roughness: 0.2 });
      box(name + " basin mirror", W / 2 - 0.07, floor + (cutaway ? 0.54 : 1.32), D / 2 - 0.5, 0.03, cutaway ? 0.22 : 0.58, 0.44, "#c8dce3", {
        roughness: 0.1,
        metalness: 0.6,
        cast: false,
      });
      break;
    }
    case "pharmacy":
      shelves(0, back + 0.25, W - 0.3, 0.4, "#e3d9df");
      counter(0, D / 2 - 0.55, W - 0.4, 0.5, 1.0, "#a87e92", WHITE);
      // Protective dispensing screen (cleanly proportioned in cutaway mode).
      box(
        name + " dispensing screen",
        0,
        floor + (cutaway ? 1.2 : 1.38),
        D / 2 - 0.42,
        W - 0.5,
        cutaway ? 0.32 : 0.56,
        0.04,
        GLASS,
        {
          roughness: 0.12,
          transparent: true,
          opacity: 0.38,
          cast: false,
        },
      );
      break;
    case "lab":
      counter(0, back + 0.35, W - 0.22, 0.6, 0.9, WHITE);
      if (D > 1.9) counter(-W / 2 + 0.35, 0.2, 0.6, D - 1.4, 0.9, WHITE);
      for (let x = -W / 2 + 0.5; x < W / 2 - 0.3; x += 0.7) {
        box(name + " equipment", x, floor + 1.08, back + 0.35, 0.36, 0.3, 0.36, x > 0 ? "#5a74a3" : STEEL, {
          metalness: 0.35,
          roughness: 0.4,
        });
      }
      box(name + " stool", 0.3, floor + 0.3, back + 1, 0.34, 0.6, 0.34, STEEL_BRIGHT, { metalness: 0.45 });
      break;
    case "surgery":
      box(name + " operating base", 0, floor + 0.22, -0.2, 0.36, 0.44, 0.5, STEEL, { metalness: 0.55, roughness: 0.3 });
      box(name + " operating table", 0, floor + 0.62, -0.2, 0.64, 0.18, Math.min(2, D - 0.8), "#46757a", {
        roughness: 0.45,
      });
      if (!cutaway) {
        box(name + " surgical lamp", 0, 2.38, -0.2, 0.86, 0.12, 0.86, WHITE, {
          roughness: 0.2,
          emissive: "#ffffff",
          emissiveIntensity: 0.3,
        });
        box(name + " lamp arm", 0, 2.58, -0.2, 0.06, 0.32, 0.06, STEEL, { metalness: 0.6 });
      }
      box(name + " instrument cart", W / 2 - 0.4, floor + 0.44, back + 0.4, 0.5, 0.88, 0.4, STEEL_BRIGHT, {
        metalness: 0.55,
        roughness: 0.3,
      });
      box(name + " monitor stand", -W / 2 + 0.35, floor + 0.6, back + 0.35, 0.38, 1.18, 0.38, SCREEN);
      monitor(-W / 2 + 0.35, floor + 1.18, back + 0.35);
      break;
    case "stairs": {
      // Polished hospital vertical circulation core: tiled stairs with dark anti-slip nosing,
      // intermediate landing, brushed-steel stringers/handrails/balusters, and a sleek hospital
      // elevator shaft with recessed stainless double sliding doors, glowing floor-indicator
      // transom bar, and wall-mounted call button panel. Works cleanly for 2x2, 2x1, 1x2, & 1x1!
      const liftH = cutaway ? 1.32 : 2.52;
      const stairTop = cutaway ? 0.98 : 2.28;
      const railH = cutaway ? 0.32 : 0.52;

      const buildLift = (cx: number, cz: number, liftW: number, liftD: number) => {
        const frontFace = cz + liftD / 2;
        // Main brushed-steel architectural shaft enclosure.
        box(name + " lift shaft", cx, floor + liftH / 2, cz, liftW, liftH, liftD, LIFT_SHAFT, {
          metalness: 0.38,
          roughness: 0.36,
        });
        // Crisp stainless top cornice trim (and recessed dark shaft interior cap in cutaway view).
        box(name + " lift cap", cx, floor + liftH + 0.025, cz, liftW + 0.06, 0.05, liftD + 0.06, STEEL_BRIGHT, {
          metalness: 0.5,
          roughness: 0.28,
        });
        if (cutaway) {
          box(
            name + " lift well",
            cx,
            floor + liftH + 0.052,
            cz,
            Math.max(0.2, liftW - 0.16),
            0.015,
            Math.max(0.2, liftD - 0.16),
            "#313c40",
            { roughness: 0.7, cast: false },
          );
        }

        const doorW = Math.min(liftW - 0.34, 0.96);
        const doorH = Math.min(liftH - 0.26, 2.08);
        const leafW = doorW / 2 - 0.02;

        // Stainless outer portal frame + sill track on the +z front face.
        box(name + " lift frame", cx, floor + doorH / 2 + 0.04, frontFace + 0.018, doorW + 0.12, doorH + 0.1, 0.04, STEEL_BRIGHT, {
          metalness: 0.72,
          roughness: 0.22,
        });
        box(name + " lift sill", cx, floor + 0.018, frontFace + 0.04, doorW + 0.16, 0.036, 0.08, STEEL, {
          metalness: 0.65,
          roughness: 0.28,
        });
        // Recessed metallic double sliding door leaves + crisp dark center seam.
        box(name + " lift door left", cx - leafW / 2 - 0.015, floor + doorH / 2 + 0.03, frontFace + 0.035, leafW, doorH, 0.025, LIFT_DOOR, {
          metalness: 0.78,
          roughness: 0.22,
        });
        box(name + " lift door right", cx + leafW / 2 + 0.015, floor + doorH / 2 + 0.03, frontFace + 0.035, leafW, doorH, 0.025, LIFT_DOOR, {
          metalness: 0.78,
          roughness: 0.22,
        });
        box(name + " lift seam", cx, floor + doorH / 2 + 0.03, frontFace + 0.044, 0.028, doorH, 0.02, LIFT_SEAM, {
          roughness: 0.5,
          cast: false,
        });

        // Glowing floor-indicator transom bar above the doors.
        const indY = floor + doorH + 0.16;
        box(name + " lift indicator bezel", cx, indY, frontFace + 0.035, Math.min(doorW * 0.68, 0.56), 0.11, 0.03, "#1f292c", {
          roughness: 0.35,
          metalness: 0.3,
        });
        box(name + " lift indicator glow", cx, indY, frontFace + 0.052, Math.min(doorW * 0.52, 0.42), 0.045, 0.016, LIFT_GLOW, {
          emissive: LIFT_GLOW,
          emissiveIntensity: 0.9,
          cast: false,
        });

        // Wall-mounted stainless call button panel beside the right door jamb.
        const panelX = cx + Math.min(liftW / 2 - 0.1, doorW / 2 + 0.11);
        const panelY = floor + Math.min(0.92, doorH * 0.72);
        box(name + " lift call panel", panelX, panelY, frontFace + 0.025, 0.09, 0.2, 0.024, STEEL_BRIGHT, {
          metalness: 0.75,
          roughness: 0.22,
          cast: false,
        });
        box(name + " lift call button", panelX, panelY + 0.03, frontFace + 0.04, 0.035, 0.035, 0.015, CALL_GLOW, {
          emissive: CALL_GLOW,
          emissiveIntensity: 0.85,
          cast: false,
        });
      };

      const buildFlight = (
        cx: number,
        zStart: number,
        zEnd: number,
        flightW: number,
        yStart: number,
        yEnd: number,
        steps: number,
        railSide: "left" | "right" | "both",
      ) => {
        const dz = (zEnd - zStart) / steps;
        const stepD = Math.abs(dz);
        const dy = (yEnd - yStart) / steps;
        const dir = Math.sign(dz) || -1;

        for (let i = 0; i < steps; i++) {
          const topY = yStart + (i + 1) * dy;
          const baseY = Math.max(0, yStart + i * dy - 0.18);
          const riserH = Math.max(0.08, topY - baseY);
          const sz = zStart + (i + 0.5) * dz;
          // Crisp tiled step body.
          box(name + " step", cx, floor + baseY + riserH / 2, sz, flightW, riserH, stepD, STAIR_STEP, {
            roughness: 0.72,
          });
          // Dark anti-slip nosing strip along the front top edge of each tread.
          box(
            name + " step nosing",
            cx,
            floor + topY + 0.008,
            sz - dir * (stepD / 2 - 0.03),
            flightW - 0.02,
            0.018,
            0.055,
            STAIR_NOSING,
            { roughness: 0.5, cast: false },
          );
        }

        // Brushed-steel side stringers, vertical balusters, and safety handrail.
        const sides = railSide === "both" ? [-1, 1] : railSide === "left" ? [-1] : [1];
        for (const s of sides) {
          const rx = cx + s * (flightW / 2 - 0.035);
          // Stepped stringer trim + vertical balusters every 2 steps.
          for (let i = 0; i < steps; i++) {
            const topY = yStart + (i + 1) * dy;
            const sz = zStart + (i + 0.5) * dz;
            if (i === 0 || i === steps - 1 || i % 2 === 1) {
              box(name + " stair baluster", rx, floor + topY + railH / 2, sz, 0.03, railH, 0.03, STEEL_BRIGHT, {
                metalness: 0.65,
                roughness: 0.28,
                cast: false,
              });
            }
            box(name + " stair handrail", rx, floor + topY + railH, sz, 0.045, 0.035, stepD + 0.04, STEEL_BRIGHT, {
              metalness: 0.72,
              roughness: 0.24,
              cast: false,
            });
          }
        }
      };

      const buildLanding = (cx: number, cz: number, lw: number, ld: number, topY: number, guardBack = true) => {
        const slabH = Math.min(0.22, topY);
        box(name + " stair landing", cx, floor + topY - slabH / 2, cz, lw, slabH, ld, "#cfcbc0", {
          roughness: 0.68,
        });
        // Solid concrete support pier underneath the landing.
        if (topY > 0.24) {
          box(name + " landing support", cx, floor + (topY - slabH) / 2, cz, lw - 0.08, topY - slabH, ld - 0.08, "#bbb7ac", {
            roughness: 0.78,
          });
        }
        if (guardBack) {
          const guardH = railH;
          box(name + " landing rail", cx, floor + topY + guardH, cz - ld / 2 + 0.04, lw - 0.06, 0.035, 0.04, STEEL_BRIGHT, {
            metalness: 0.72,
            roughness: 0.24,
            cast: false,
          });
          for (const px of [-lw / 2 + 0.06, 0, lw / 2 - 0.06]) {
            box(name + " landing post", cx + px, floor + topY + guardH / 2, cz - ld / 2 + 0.04, 0.03, guardH, 0.03, STEEL_BRIGHT, {
              metalness: 0.65,
              roughness: 0.28,
              cast: false,
            });
          }
        }
      };

      if (W > 2.2) {
        // Case A: Wide circulation core (2x2, 2x1, 3x2, etc.) — Left = Staircase, Right = Hospital Lift!
        const stairZoneX0 = -W / 2 + 0.12;
        const stairZoneX1 = -0.08;
        const stairZoneW = stairZoneX1 - stairZoneX0;
        const stairZoneCx = (stairZoneX0 + stairZoneX1) / 2;

        if (D > 2.6) {
          // Spacious 2x2+ core: true switchback double-flight staircase + intermediate back landing!
          const landingD = 0.72;
          const landingCz = back + 0.12 + landingD / 2;
          const midH = stairTop * 0.54;
          buildLanding(stairZoneCx, landingCz, stairZoneW, landingD, midH, true);

          const flightGap = 0.1;
          const flightW = (stairZoneW - flightGap) / 2;
          const zFront = front - 0.4;
          const zLandEdge = back + 0.12 + landingD;
          // Lower flight (outer left): ascends from front to intermediate landing.
          buildFlight(stairZoneX0 + flightW / 2, zFront, zLandEdge, flightW, 0, midH, 6, "right");
          // Upper flight (inner right): rises from intermediate landing back toward front.
          buildFlight(stairZoneX1 - flightW / 2, zLandEdge, zFront + 0.15, flightW, midH, stairTop, 5, "left");
        } else {
          // Compact wide core (e.g. 2x1): crisp single flight with neat back landing!
          const landingD = 0.36;
          const landingCz = back + 0.1 + landingD / 2;
          buildLanding(stairZoneCx, landingCz, stairZoneW, landingD, stairTop * 0.86, true);
          buildFlight(stairZoneCx, front - 0.24, back + 0.1 + landingD, stairZoneW - 0.04, 0, stairTop * 0.86, 6, "both");
        }

        // Right bay: sleek brushed-steel hospital lift facing the corridor lobby (+z).
        const liftW = Math.min(1.62, W / 2 - 0.24);
        const liftD = Math.min(1.5, Math.max(0.84, D - 0.74));
        const liftCx = W / 4 + 0.04;
        const liftCz = back + 0.12 + liftD / 2;
        buildLift(liftCx, liftCz, liftW, liftD);
      } else if (D > 2.6) {
        // Case B: Narrow & deep core (1x2, 1x3) — Back = Hospital Lift, Front-Left = Staircase flight!
        const liftW = Math.min(1.42, W - 0.24);
        const liftD = Math.min(1.16, D * 0.32);
        const liftCz = back + 0.12 + liftD / 2;
        buildLift(0, liftCz, liftW, liftD);

        // Neat side staircase rising along the left wall, leaving a clear lobby aisle on the right to the lift!
        const flightW = Math.min(0.86, W * 0.48);
        const flightCx = -W / 2 + 0.12 + flightW / 2;
        const zStart = front - 0.34;
        const zEnd = back + 0.12 + liftD + 0.56;
        if (zStart - zEnd > 0.75) {
          buildFlight(flightCx, zStart, zEnd, flightW, 0, stairTop * 0.88, 7, "right");
        }
      } else {
        // Case C: Compact 1x1 stairwell — crisp single-flight tiled staircase with handrails & landing!
        const runW = W - 0.24;
        const landingD = 0.34;
        buildLanding(0, back + 0.1 + landingD / 2, runW, landingD, stairTop * 0.82, true);
        buildFlight(0, front - 0.22, back + 0.1 + landingD, runW, 0, stairTop * 0.82, 6, "both");
      }
      break;
    }
    case "storage":
      shelves(0, back + 0.25, W - 0.3, 0.4);
      if (D > 1.9) shelves(-W / 2 + 0.25, 0.1, 0.4, D - 1.2);
      break;
    case "radiology": {
      const gantryH = cutaway ? 1.38 : 1.84;
      box(name + " scanner gantry", -0.2, floor + gantryH / 2, back + 0.55, 1.15, gantryH, 0.55, WHITE, {
        roughness: 0.28,
      });
      box(name + " scanner bore", -0.2, floor + gantryH * 0.52, back + 0.55, 0.58, 0.58, 0.58, SCREEN, {
        roughness: 0.4,
      });
      box(name + " scanner table", -0.2, floor + 0.42, 0.12, 0.56, 0.76, Math.min(1.6, D - 1.1), "#95abc4", {
        roughness: 0.4,
      });
      box(name + " control desk", W / 2 - 0.4, floor + 0.37, D / 2 - 0.6, 0.52, 0.74, 0.8, WOOD);
      monitor(W / 2 - 0.4, floor + 0.74, D / 2 - 0.6);
      break;
    }
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
      if (D > 2.4 && W > 2.6) counter(W / 2 - 0.55, D / 2 - 0.75, 0.8, 0.45, 0.9, WOOD, HOSPITAL_GREEN);
      break;
    }
    case "emergency":
      bed(-W / 3, undefined, true);
      bed(0, undefined, false);
      if (W > 2.6) bed(W / 3, undefined, true);
      box(name + " crash cart", W / 2 - 0.32, floor + 0.45, D / 2 - 0.5, 0.46, 0.9, 0.42, "#c44536", { roughness: 0.4 });
      box(name + " crash cart top", W / 2 - 0.32, floor + 0.92, D / 2 - 0.5, 0.48, 0.05, 0.44, WHITE, { roughness: 0.3 });
      box(name + " defib monitor", W / 2 - 0.32, floor + 1.05, D / 2 - 0.52, 0.24, 0.2, 0.18, SCREEN, {
        emissive: "#4ade80",
        emissiveIntensity: 0.35,
        cast: false,
      });
      break;
  }
}
