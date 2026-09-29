import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Piece } from "../model/layout.ts";
import { corridorEnds, exposedRuns, footprint, gatewayParts, isBarrier, isBuilding, isCorridor, isGate, isMotorcycleParking, isOpenAir, isParking, isPath, parkingBays } from "../model/interiors.ts";
import { buildingInterior, STOREY } from "./interior-geometry.ts";

export const MODEL_KINDS = ["pitched", "flat", "straight", "corner", "junction", "cross"];
const VERSION = "continuous-corridor-4";

/** Load the Blender-authored GLB for every piece kind. */
export async function loadTemplates() {
  const loader = new GLTFLoader(),
    templates = new Map<string, THREE.Group>(),
    materials = new Set<THREE.Material>();
  await Promise.all(
    MODEL_KINDS.map(async (kind) => {
      const gltf = await loader.loadAsync(`/models/${kind}.glb?v=${VERSION}`);
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.Mesh)
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m));
      });
      templates.set(kind, gltf.scene);
    }),
  );
  return { templates, materials };
}

/** The colour a model part should take from the piece, if any. */
function tint(p: Piece, mesh: string) {
  if (/roof|ridge|tile course/i.test(mesh)) return p.roofColor;
  if (isBuilding(p) && /gable.walls/i.test(mesh)) return p.color;
  if (isCorridor(p) && /floor/i.test(mesh)) return p.color;
}

function removeMeshes(model: THREE.Object3D, match: (o: THREE.Mesh) => boolean) {
  const doomed: THREE.Object3D[] = [];
  model.traverse((o) => {
    if (o instanceof THREE.Mesh && match(o)) doomed.push(o);
  });
  for (const o of doomed) o.parent?.remove(o);
}

/** The template's material for the first mesh whose name matches. */
function materialOf(template: THREE.Object3D, name: RegExp) {
  let found: THREE.Material | undefined;
  template.traverse((o) => {
    if (!found && o instanceof THREE.Mesh && name.test(o.name))
      found = Array.isArray(o.material) ? o.material[0] : o.material;
  });
  return found ?? new THREE.MeshStandardMaterial({ color: "#a9b5b2" });
}

type Vec = { x: number; z: number };

/** A flat slab with the outline `poly` (metres, x/z), from `bottom` to `top`. */
function slab(name: string, poly: Vec[], bottom: number, top: number, material: THREE.Material) {
  const shape = new THREE.Shape(poly.map((v) => new THREE.Vector2(v.x, v.z)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: top - bottom, bevelEnabled: false });
  // Shape y becomes world z; the extrusion then runs downward from `top`.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, top, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

/** Signed area in x/z: positive when the outline runs clockwise seen from above. */
const turning = (poly: Vec[]) =>
  poly.reduce((s, a, i) => {
    const b = poly[(i + 1) % poly.length];
    return s + a.x * b.z - b.x * a.z;
  }, 0);

const FLOOR_TOP = 0.24,
  ROOF_BOTTOM = 2.76,
  ROOF_TOP = 2.94,
  POST = 0.1,
  /** Target distance between support posts along a side, in metres. */
  POST_SPACING = 3;

/**
 * A covered walkway built straight from the corridor's footprint, so it turns
 * with the piece and keeps real-size posts however long it is stretched.
 * Materials come from the Blender template.
 */
function corridorModel(p: Piece, template: THREE.Object3D, pieces: Piece[]) {
  const group = new THREE.Group();
  const poly = footprint(p).map((v) => ({ x: v.x * 2, z: v.y * 2 }));
  group.add(slab("Continuous corridor floor", poly, 0, FLOOR_TOP, materialOf(template, /floor/i)));
  group.add(slab("Continuous corridor roof", poly, ROOF_BOTTOM, ROOF_TOP, materialOf(template, /roof/i)));
  const postMaterial = materialOf(template, /post/i),
    postGeometry = new THREE.BoxGeometry(POST, ROOF_BOTTOM - FLOOR_TOP, POST),
    inward = turning(poly) > 0 ? 1 : -1,
    ends = corridorEnds(p);
  poly.forEach((a, i) => {
    if (ends.includes(i)) return;
    const b = poly[(i + 1) % poly.length],
      open = exposedRuns(p, i, pieces),
      length = Math.hypot(b.x - a.x, b.z - a.z),
      dx = (b.x - a.x) / length,
      dz = (b.z - a.z) / length,
      count = Math.max(1, Math.round(length / POST_SPACING));
    // Evenly spaced along the side, set just inside the canopy edge.
    for (let k = 0; k < count; k++) {
      const f = (k + 0.5) / count;
      // No post where another walkway joins this side.
      if (!open.some(([from, to]) => f >= from && f <= to)) continue;
      const t = f * length,
        post = new THREE.Mesh(postGeometry, postMaterial);
      post.name = "Side support post";
      post.position.set(
        a.x + dx * t - dz * inward * 0.08,
        (FLOOR_TOP + ROOF_BOTTOM) / 2,
        a.z + dz * t + dx * inward * 0.08,
      );
      group.add(post);
    }
  });
  return group;
}

/** An open-air footpath: paving flush with the lawn, kerbs where its sides meet grass. */
function pathModel(p: Piece, pieces: Piece[]) {
  const group = new THREE.Group();
  const poly = footprint(p).map((v) => ({ x: v.x * 2, z: v.y * 2 }));
  group.add(slab("Path paving", poly, 0, 0.06, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.95 })));
  const kerb = new THREE.MeshStandardMaterial({ color: "#9c9a90", roughness: 0.85 }),
    inward = turning(poly) > 0 ? 1 : -1,
    ends = corridorEnds(p);
  poly.forEach((a, i) => {
    if (ends.includes(i)) return;
    const b = poly[(i + 1) % poly.length],
      length = Math.hypot(b.x - a.x, b.z - a.z),
      along = Math.abs(b.x - a.x) > Math.abs(b.z - a.z),
      // Unit step into the path, perpendicular to this side.
      nx = (-(b.z - a.z) / length) * inward,
      nz = ((b.x - a.x) / length) * inward;
    // One kerb per stretch that meets grass; junctions with other paths stay open.
    for (const [from, to] of exposedRuns(p, i, pieces)) {
      const run = (to - from) * length,
        mid = (from + to) / 2,
        mesh = new THREE.Mesh(new THREE.BoxGeometry(along ? run : 0.12, 0.1, along ? 0.12 : run), kerb);
      mesh.name = "Path kerb";
      mesh.position.set(a.x + (b.x - a.x) * mid + nx * 0.06, 0.05, a.z + (b.z - a.z) * mid + nz * 0.06);
      group.add(mesh);
    }
  });
  return group;
}

const CAR_COLOURS = ["#e8e8e4", "#2f3437", "#a8b0b5", "#7d2a2a", "#2c4a6e", "#c9c2b0", "#556b4f"],
  MOTORCYCLE_COLOURS = ["#c23b32", "#1f2427", "#e8e8e4", "#2d5fa0", "#9aa3a8", "#d9a32c"];

/** Sign faces, drawn once per text and colour: white letters on a framed board. */
const signs = new Map<string, THREE.Texture>();
function signTexture(text = "P", background = "#2f5aa8", width = 128) {
  const key = `${background}:${width}:${text}`;
  if (signs.has(key) || typeof document === "undefined") return signs.get(key) ?? null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = 128;
  const g = canvas.getContext("2d")!;
  g.fillStyle = background;
  g.fillRect(0, 0, width, 128);
  g.strokeStyle = "white";
  g.lineWidth = 6;
  g.strokeRect(8, 8, width - 16, 112);
  g.fillStyle = "white";
  // Short text such as "P" fills the board; names shrink to fit.
  let size = text.length > 2 ? 64 : 92;
  g.font = `bold ${size}px sans-serif`;
  while (size > 20 && g.measureText(text).width > width - 48) g.font = `bold ${(size -= 4)}px sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, width / 2, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  signs.set(key, texture);
  return texture;
}

/**
 * An open-air car park: asphalt with painted bays in one row (or two facing
 * an aisle when it is deep enough), some parked cars, kerbs along the sides
 * and a "P" sign. The short ends stay open for cars to drive in.
 */
function parkingModel(p: Piece, pieces: Piece[]) {
  const group = new THREE.Group();
  const poly = footprint(p).map((v) => ({ x: v.x * 2, z: v.y * 2 }));
  group.add(slab("Parking surface", poly, 0, 0.05, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.9 })));
  const { alongX, bayDepth, lines, bays } = parkingBays(p);
  // Sizes along the row (u) and across it (v), in metres, placed in the world.
  const box = (name: string, x: number, y: number, z: number, du: number, h: number, dv: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(alongX ? du : dv, h, alongX ? dv : du), material);
    mesh.position.set(x, y, z);
    mesh.name = name;
    group.add(mesh);
    return mesh;
  };
  const paint = new THREE.MeshStandardMaterial({ color: "#f2f2ee", roughness: 0.6 }),
    glass = new THREE.MeshStandardMaterial({ color: "#39444c", roughness: 0.25, metalness: 0.3 });
  for (const [a, b] of lines) {
    const length = Math.hypot(b.x - a.x, b.y - a.y) * 2,
      horizontal = Math.abs(b.x - a.x) > Math.abs(b.y - a.y),
      mesh = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? length : 0.1, 0.012, horizontal ? 0.1 : length), paint);
    mesh.name = "Parking bay line";
    mesh.position.set(a.x + b.x, 0.056, a.y + b.y);
    group.add(mesh);
  }
  const rubber = new THREE.MeshStandardMaterial({ color: "#1d1f21", roughness: 0.9 });
  // A motorcycle nose-in to the kerb: wheels, body, seat and handlebars.
  const motorcycle = (bay: { x: number; y: number; row: number }, colour: string) => {
    const x = bay.x * 2,
      z = bay.y * 2,
      // Along the bay, toward the aisle.
      out = bay.row ? -1 : 1,
      along = (d: number) => (alongX ? { x, z: z + d * out } : { x: x + d * out, z });
    const body = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.4, metalness: 0.2 });
    for (const d of [-0.62, 0.62]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 16), rubber),
        at = along(d);
      // The axle runs along the row.
      wheel.rotation[alongX ? "z" : "x"] = Math.PI / 2;
      wheel.position.set(at.x, 0.35, at.z);
      wheel.name = "Parking motorcycle wheel";
      group.add(wheel);
    }
    const mid = along(0.05),
      seat = along(0.25),
      bars = along(-0.55);
    box("Parking motorcycle body", mid.x, 0.62, mid.z, 0.32, 0.36, 1.1, body);
    box("Parking motorcycle seat", seat.x, 0.86, seat.z, 0.28, 0.1, 0.62, rubber);
    box("Parking motorcycle handlebars", bars.x, 1.02, bars.z, 0.7, 0.05, 0.05, rubber);
  };
  // Some bays are taken, the same ones every time for a given car park.
  let seed = p.id * 9301 + 49297;
  const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const depth = bayDepth * 2;
  const motorcycles = isMotorcycleParking(p);
  for (const bay of bays) {
    if (random() > (motorcycles ? 0.7 : 0.6)) continue;
    if (motorcycles) {
      motorcycle(bay, MOTORCYCLE_COLOURS[Math.floor(random() * MOTORCYCLE_COLOURS.length)]);
      continue;
    }
    const colour = CAR_COLOURS[Math.floor(random() * CAR_COLOURS.length)],
      body = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.35, metalness: 0.25 }),
      // The cabin sits toward the back of the car, which faces the kerb.
      back = bay.row ? 0.25 : -0.25,
      x = bay.x * 2,
      z = bay.y * 2;
    box("Parking car body", x, 0.5, z, 1.8, 0.6, Math.min(4.2, depth - 0.6), body);
    box("Parking car cabin", alongX ? x : x + back, 1.05, alongX ? z + back : z, 1.6, 0.5, Math.min(2.2, depth - 1.6), glass);
  }
  // Kerbs along the long sides where they meet grass; the ends stay open.
  const kerb = new THREE.MeshStandardMaterial({ color: "#a3a197", roughness: 0.85 }),
    inward = turning(poly) > 0 ? 1 : -1;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length],
      side = Math.hypot(b.x - a.x, b.z - a.z),
      horizontal = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
    if (horizontal !== alongX) return;
    const nx = (-(b.z - a.z) / side) * inward,
      nz = ((b.x - a.x) / side) * inward;
    for (const [from, to] of exposedRuns(p, i, pieces)) {
      const run = (to - from) * side,
        t = (from + to) / 2,
        mesh = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? run : 0.18, 0.14, horizontal ? 0.18 : run), kerb);
      mesh.name = "Parking kerb";
      mesh.position.set(a.x + (b.x - a.x) * t + nx * 0.09, 0.07, a.z + (b.z - a.z) * t + nz * 0.09);
      group.add(mesh);
    }
  });
  // The sign stands at a corner of the open end, facing out of it.
  const steel = new THREE.MeshStandardMaterial({ color: "#8d9599", metalness: 0.6, roughness: 0.4 }),
    corner = { x: p.x * 2 + 0.35, z: (p.y + p.h) * 2 - 0.35 };
  box("Parking sign post", corner.x, 1.1, corner.z, 0.08, 2.2, 0.08, steel);
  // Thin along the row, so it faces out of the open end.
  const face = signTexture();
  box(
    "Parking sign",
    corner.x,
    2.35,
    corner.z,
    0.06,
    0.8,
    0.8,
    new THREE.MeshStandardMaterial({ color: face ? "white" : "#2f5aa8", map: face, roughness: 0.5 }),
  );
  return group;
}

/**
 * Boxes laid out along a gateway's long side (u) and across it (v), in metres
 * from its corner, so one description serves both ways it can face.
 */
function placer(group: THREE.Group, p: Piece, alongX: boolean) {
  return (name: string, u: number, y: number, v: number, du: number, h: number, dv: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(alongX ? du : dv, h, alongX ? dv : du), material);
    mesh.position.set(p.x * 2 + (alongX ? u : v), y, p.y * 2 + (alongX ? v : u));
    mesh.name = name;
    group.add(mesh);
    return mesh;
  };
}

/** Metres along (u) and across (v) a gateway for a point in tiles. */
const local = (p: Piece, alongX: boolean, t: { x: number; y: number }) =>
  alongX ? { u: (t.x - p.x) * 2, v: (t.y - p.y) * 2 } : { u: (t.y - p.y) * 2, v: (t.x - p.x) * 2 };

/**
 * The campus entrance: a paved drive between two stone pillars, with a beam
 * across the top carrying the hospital's name on both faces.
 */
function gateModel(p: Piece) {
  const group = new THREE.Group(),
    poly = footprint(p).map((v) => ({ x: v.x * 2, z: v.y * 2 }));
  group.add(slab("Gate drive", poly, 0, 0.06, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.9 })));
  const { alongX, blocks, span } = gatewayParts(p),
    box = placer(group, p, alongX),
    stone = new THREE.MeshStandardMaterial({ color: "#d8d2c4", roughness: 0.8 }),
    trim = new THREE.MeshStandardMaterial({ color: "#8a8272", roughness: 0.7 });
  const HEIGHT = 4.6;
  for (const b of blocks) {
    const c = local(p, alongX, { x: b.x + b.w / 2, y: b.y + b.h / 2 }),
      size = Math.min(b.w, b.h) * 2;
    box("Gate pillar", c.u, HEIGHT / 2, c.v, size, HEIGHT, size, stone);
    box("Gate pillar cap", c.u, HEIGHT + 0.1, c.v, size + 0.2, 0.2, size + 0.2, trim);
    box("Gate pillar plinth", c.u, 0.2, c.v, size + 0.12, 0.4, size + 0.12, trim);
  }
  const a = local(p, alongX, span[0]),
    b = local(p, alongX, span[1]),
    length = b.u - a.u,
    mid = (a.u + b.u) / 2;
  box("Gate beam", mid, HEIGHT - 0.55, a.v, length, 0.9, 0.4, trim);
  // The name faces both ways along the drive.
  const face = signTexture(p.name, "#2f7d44", 512),
    board = new THREE.MeshStandardMaterial({ color: face ? "white" : "#2f7d44", map: face, roughness: 0.5 }),
    signLength = Math.max(0.5, length - 0.3);
  for (const side of [-1, 1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(signLength, 0.75), board),
      v = a.v + side * 0.21;
    sign.position.set(p.x * 2 + (alongX ? mid : v), HEIGHT - 0.55, p.y * 2 + (alongX ? v : mid));
    // Planes face +z; turn each to face out of its side of the beam.
    sign.rotation.y = alongX ? (side > 0 ? 0 : Math.PI) : side > 0 ? Math.PI / 2 : -Math.PI / 2;
    sign.name = "Gate name sign";
    group.add(sign);
  }
  return group;
}

/**
 * A parking gate: an asphalt lane with a ticket booth on a kerbed island at
 * one end and a red-and-white barrier arm across the rest, lowered.
 */
function barrierModel(p: Piece) {
  const group = new THREE.Group(),
    poly = footprint(p).map((v) => ({ x: v.x * 2, z: v.y * 2 }));
  group.add(slab("Parking gate lane", poly, 0, 0.05, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.9 })));
  const { alongX, blocks, span } = gatewayParts(p),
    box = placer(group, p, alongX),
    [booth] = blocks,
    c = local(p, alongX, { x: booth.x + booth.w / 2, y: booth.y + booth.h / 2 }),
    du = (alongX ? booth.w : booth.h) * 2,
    dv = (alongX ? booth.h : booth.w) * 2;
  const kerb = new THREE.MeshStandardMaterial({ color: "#d9d6cc", roughness: 0.85 }),
    wall = new THREE.MeshStandardMaterial({ color: "#f1efe8", roughness: 0.7 }),
    glass = new THREE.MeshStandardMaterial({ color: "#5b7584", roughness: 0.2, metalness: 0.3 }),
    roof = new THREE.MeshStandardMaterial({ color: "#2f5aa8", roughness: 0.6 }),
    steel = new THREE.MeshStandardMaterial({ color: "#8d9599", metalness: 0.6, roughness: 0.4 });
  box("Parking gate island", c.u, 0.08, c.v, du + 0.3, 0.16, dv + 0.4, kerb);
  box("Parking gate booth", c.u, 1.26, c.v, du, 2.2, dv, wall);
  box("Parking gate booth window", c.u, 1.55, c.v, du + 0.02, 0.8, dv - 0.3, glass);
  box("Parking gate booth roof", c.u, 2.44, c.v, du + 0.5, 0.16, dv + 0.5, roof);
  // The arm pivots on a post at the island's edge and rests on a fork at the far side.
  const a = local(p, alongX, span[0]),
    b = local(p, alongX, span[1]),
    dir = Math.sign(b.u - a.u),
    post = a.u - dir * 0.12,
    red = new THREE.MeshStandardMaterial({ color: "#d24b3b", roughness: 0.5 }),
    white = new THREE.MeshStandardMaterial({ color: "#f4f4f0", roughness: 0.5 });
  box("Parking gate post", post, 0.55, a.v, 0.3, 1.1, 0.3, new THREE.MeshStandardMaterial({ color: "#e2b93b", roughness: 0.5 }));
  box("Parking gate ticket machine", post, 0.6, a.v - 0.45, 0.3, 1.2, 0.3, steel);
  const length = Math.abs(b.u - post) - 0.15,
    stripes = Math.max(2, Math.round(length / 0.5));
  for (let i = 0; i < stripes; i++)
    box("Parking gate arm", post + dir * (0.15 + ((i + 0.5) * length) / stripes), 1.0, a.v, length / stripes, 0.08, 0.08, i % 2 ? white : red);
  box("Parking gate arm rest", b.u - dir * 0.1, 0.48, a.v, 0.06, 0.96, 0.06, steel);
  return group;
}

const EAVE = 3.92,
  OVERHANG = 0.28,
  PITCH = 0.5;

/** A gabled roof over a rectangle (metres), ridge along x or z. */
function gable(
  group: THREE.Group,
  r: { x0: number; z0: number; x1: number; z1: number },
  alongX: boolean,
  gables: [boolean, boolean],
  roof: THREE.Material,
  wall: THREE.Material,
) {
  const span = alongX ? r.z1 - r.z0 : r.x1 - r.x0,
    half = span / 2 + OVERHANG,
    rise = half * PITCH,
    slope = Math.atan2(rise, half),
    // Ends with a gable wall overhang it; ends running into another roof stop short.
    lo = (alongX ? r.x0 : r.z0) - (gables[0] ? 0.3 : 0),
    hi = (alongX ? r.x1 : r.z1) + (gables[1] ? 0.3 : 0),
    mid = (lo + hi) / 2,
    cx = (r.x0 + r.x1) / 2,
    cz = (r.z0 + r.z1) / 2;
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(alongX ? hi - lo : Math.hypot(half, rise), 0.15, alongX ? Math.hypot(half, rise) : hi - lo),
      roof,
    );
    panel.name = "Pitched roof plane";
    if (alongX) {
      panel.position.set(mid, EAVE + rise / 2, cz + (side * half) / 2);
      panel.rotation.x = side * slope;
    } else {
      panel.position.set(cx + (side * half) / 2, EAVE + rise / 2, mid);
      panel.rotation.z = -side * slope;
    }
    group.add(panel);
  }
  const cap = new THREE.Mesh(new THREE.BoxGeometry(alongX ? hi - lo + 0.1 : 0.19, 0.17, alongX ? 0.19 : hi - lo + 0.1), roof);
  cap.name = "Roof ridge cap";
  cap.position.set(alongX ? mid : cx, EAVE + rise + 0.1, alongX ? cz : mid);
  group.add(cap);
  gables.forEach((show, i) => {
    if (!show) return;
    const at = alongX ? (i ? r.x1 : r.x0) : i ? r.z1 : r.z0,
      a = alongX ? r.z0 : r.x0,
      b = alongX ? r.z1 : r.x1;
    const point = (v: number, y: number) => (alongX ? [at, y, v] : [v, y, at]);
    const geometry = new THREE.BufferGeometry();
    // Both windings, so the wall reads from inside and out.
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [...point(a, EAVE), ...point(b, EAVE), ...point((a + b) / 2, EAVE + rise),
         ...point(b, EAVE), ...point(a, EAVE), ...point((a + b) / 2, EAVE + rise)].flat(),
        3,
      ),
    );
    geometry.computeVertexNormals();
    const triangle = new THREE.Mesh(geometry, wall);
    triangle.name = "Triangular gable walls";
    group.add(triangle);
  });
}

/**
 * Roof for an L-shaped building. Pitched: a main gable along the full arm and
 * a crossing gable over the wing that runs into it. Flat: one slab.
 */
function lShapedRoof(p: Piece, template: THREE.Object3D) {
  const group = new THREE.Group();
  if (p.kind === "flat") {
    const poly = footprint(p).map((v) => ({ x: v.x * 2, z: v.y * 2 })),
      out = turning(poly) > 0 ? 1 : -1;
    // Push every corner out along both neighbouring walls for the overhang.
    const eaves = poly.map((v, i) => {
      const prev = poly[(i + poly.length - 1) % poly.length],
        next = poly[(i + 1) % poly.length];
      const normal = (a: Vec, b: Vec) => {
        const l = Math.hypot(b.x - a.x, b.z - a.z);
        return { x: ((b.z - a.z) / l) * out, z: (-(b.x - a.x) / l) * out };
      };
      const n1 = normal(prev, v),
        n2 = normal(v, next);
      return { x: v.x + 0.15 * (n1.x + n2.x), z: v.z + 0.15 * (n1.z + n2.z) };
    });
    group.add(slab("Flat roof slab", eaves, 3.84, 4.12, materialOf(template, /flat.roof/i)));
    return group;
  }
  // In the unrotated L the missing quarter is top-right: arm A is the full
  // bottom half, wing B the top-left quarter reaching A's ridge.
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    const turn = (x: number, y: number) => {
      for (let i = 0; i < p.rotation / 90; i++) [x, y] = [1 - y, x];
      return { x: (p.x + x * p.w) * 2, z: (p.y + y * p.h) * 2 };
    };
    const a = turn(x0, y0),
      b = turn(x1, y1);
    return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) };
  };
  const quarter = p.rotation % 180 !== 0,
    roof = materialOf(template, /roof.plane/i),
    wall = materialOf(template, /gable.walls/i);
  gable(group, rect(0, 0.5, 1, 1), !quarter, [true, true], roof, wall);
  // The wing's outer end is its low x/z end at 0° and 270°, the high end otherwise.
  const outerLow = p.rotation === 0 || p.rotation === 270;
  gable(group, rect(0, 0, 0.5, 0.75), quarter, outerLow ? [true, false] : [false, true], roof, wall);
  return group;
}

/** The Blender template scaled to a rectangular footprint and turned with the piece. */
function fittedTemplate(p: Piece, template: THREE.Group) {
  const model = template.clone(true);
  const dims = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  const rotated = p.rotation % 180 !== 0;
  model.scale.set(((rotated ? p.h : p.w) * 2) / dims.x, 1, (-(rotated ? p.w : p.h) * 2) / dims.z);
  model.rotation.y = (-p.rotation * Math.PI) / 180;
  const bounds = new THREE.Box3().setFromObject(model);
  model.position.set(p.x * 2 - bounds.min.x, -bounds.min.y, p.y * 2 - bounds.min.z);
  return model;
}

/**
 * Model for one piece: corridors and L-shaped roofs are built from the
 * footprint, other buildings use the Blender template fitted to it. Recoloured
 * and, when `inside`, with roofs taken off. Buildings also get their generated
 * interior (walls, doors, windows, rooms).
 */
export function pieceModel(
  p: Piece,
  template: THREE.Group | undefined,
  pieces: Piece[],
  inside: boolean,
) {
  const generated = isOpenAir(p) || isCorridor(p) || (isBuilding(p) && !!p.shape);
  const empty = new THREE.Group();
  const model: THREE.Object3D = isPath(p)
    ? pathModel(p, pieces)
    : isParking(p)
      ? parkingModel(p, pieces)
      : isGate(p)
      ? gateModel(p)
      : isBarrier(p)
      ? barrierModel(p)
      : isCorridor(p)
      ? corridorModel(p, template ?? empty, pieces)
      : generated
        ? lShapedRoof(p, template ?? empty)
        : template
          ? fittedTemplate(p, template)
          : empty;
  // Built here rather than cloned, so the scene may free this geometry.
  if (generated) model.traverse((o) => (o.userData.generated = true));
  model.userData.pieceId = p.id;
  model.name = p.name;

  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = o.receiveShadow = true;
    const color = tint(p, o.name);
    // Materials are shared with the template, so each piece gets copies.
    const copies = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
      const copy = m.clone();
      if (color && copy instanceof THREE.MeshStandardMaterial) copy.color.set(color);
      return copy;
    });
    o.material = Array.isArray(o.material) ? copies : copies[0];
  });

  // Looking inside, corridors lose their canopy and the posts that hold it up.
  if (inside && isCorridor(p)) removeMeshes(model, (o) => /roof|post/i.test(o.name));
  let interior: THREE.Group | null = null;
  if (isBuilding(p)) {
    // The generated interior replaces the template's shell and doors.
    removeMeshes(
      model,
      (o) =>
        inside ||
        o.name.startsWith("Building_shell") ||
        o.name.startsWith("Building shell") ||
        /Entrance|Door_mullion|Door mullion|Foundation/.test(o.name),
    );
    model.position.y += ((p.floors ?? 1) - 1) * STOREY;
    interior = buildingInterior(p, pieces, inside);
  }
  return { model, interior };
}
