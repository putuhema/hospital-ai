import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Piece } from "../model/layout.ts";
import { corridorEnds, exposedRuns, footprint, isBuilding, isCorridor, isPath } from "../model/interiors.ts";
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
  const generated = isPath(p) || isCorridor(p) || (isBuilding(p) && !!p.shape);
  const empty = new THREE.Group();
  const model: THREE.Object3D = isPath(p)
    ? pathModel(p, pieces)
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
