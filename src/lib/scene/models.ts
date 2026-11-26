import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Piece } from "../model/layout.ts";
import {
  corridorEnds,
  exposedRuns,
  footprint,
  gatewayParts,
  inPolygon,
  isBarrier,
  isBuilding,
  isCorridor,
  isGate,
  isMotorcycleParking,
  isOpenAir,
  isParking,
  isPath,
  parkingBays,
} from "../model/interiors.ts";
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

/** Treat both standard buildings and the procedural PHTC building as buildings. */
const isBuildingPiece = (p: Piece) => p.kind === "phtc" || isBuilding(p);

/** Lighten (+amount) or darken (-amount) a hex colour cleanly. */
function shade(hex: string, amount: number) {
  return (
    "#" +
    new THREE.Color(hex)
      .lerp(new THREE.Color(amount < 0 ? "#18231c" : "#ffffff"), Math.min(1, Math.abs(amount)))
      .getHexString()
  );
}

/** Blend two hex colours by ratio t (0..1). */
function mixHex(a: string, b: string, t: number) {
  return "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

/** The colour a template model part should take from the piece, if any. */
function tint(p: Piece, mesh: string) {
  if (/roof|ridge|tile course/i.test(mesh)) return p.roofColor;
  if (isBuildingPiece(p) && /gable.walls/i.test(mesh)) return p.color;
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

/** Offset an orthogonal polygon outward (positive `dist`) or inward (negative `dist`). */
function offsetPoly(poly: Vec[], dist: number): Vec[] {
  const out = turning(poly) > 0 ? 1 : -1;
  return poly.map((v, i) => {
    const prev = poly[(i + poly.length - 1) % poly.length],
      next = poly[(i + 1) % poly.length];
    const normal = (a: Vec, b: Vec) => {
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { x: ((b.z - a.z) / l) * out, z: (-(b.x - a.x) / l) * out };
    };
    const n1 = normal(prev, v),
      n2 = normal(v, next);
    return { x: v.x + dist * (n1.x + n2.x), z: v.z + dist * (n1.z + n2.z) };
  });
}

/** Add a box mesh to `parent` cleanly. */
function addBox(
  parent: THREE.Object3D,
  name: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  noCastShadow = false,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d)),
    material,
  );
  mesh.name = name;
  mesh.position.set(x, y, z);
  if (noCastShadow) mesh.userData.noCastShadow = true;
  parent.add(mesh);
  return mesh;
}

/**
 * Cache HTMLCanvasElements (never disposed) and wrap them in fresh CanvasTextures
 * per build, so `clearGroup()` disposing textures never corrupts cached assets.
 */
const canvasCache = new Map<string, HTMLCanvasElement>();

function getCanvas(key: string, width: number, height: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  if (typeof document === "undefined") return null;
  let canvas = canvasCache.get(key);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) return null;
    draw(g, width, height);
    canvasCache.set(key, canvas);
  }
  return canvas;
}

function makeCanvasTexture(
  canvas: HTMLCanvasElement | null,
  repeatX = 1,
  repeatY = 1,
  wrap = false,
): THREE.CanvasTexture | null {
  if (!canvas) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (wrap) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
  }
  texture.anisotropy = 4;
  return texture;
}

/** Sign faces, drawn once per text and colour: white letters on a framed board. */
function signTexture(text = "P", background = "#2f5aa8", width = 128) {
  const canvas = getCanvas(`sign:${background}:${width}:${text}`, width, 128, (g, w, h) => {
    g.fillStyle = background;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "white";
    g.lineWidth = 6;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = "white";
    let size = text.length > 2 ? 64 : 92;
    g.font = `bold ${size}px sans-serif`;
    while (size > 20 && g.measureText(text).width > w - 48) g.font = `bold ${(size -= 4)}px sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 6);
  });
  return makeCanvasTexture(canvas);
}

/** Glossy light cream/off-white square ceramic floor tiles for covered corridors (Photo 4). */
function corridorFloorTexture(baseHex: string) {
  const tileHex = mixHex("#ecefe8", baseHex, 0.22);
  const groutHex = shade(tileHex, -0.14);
  const canvas = getCanvas(`corridor-tiles:${tileHex}`, 256, 256, (g, w, h) => {
    g.fillStyle = tileHex;
    g.fillRect(0, 0, w, h);
    const cells = 4,
      step = w / cells;
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < cells; j++) {
        // Subtle per-tile tonal variation for realistic glossy ceramic feel.
        g.fillStyle = (i + j) % 2 === 0 ? tileHex : shade(tileHex, -0.025);
        g.fillRect(i * step + 2, j * step + 2, step - 4, step - 4);
      }
    }
    g.strokeStyle = groutHex;
    g.lineWidth = 3;
    for (let i = 0; i <= cells; i++) {
      g.beginPath();
      g.moveTo(i * step, 0);
      g.lineTo(i * step, h);
      g.stroke();
      g.beginPath();
      g.moveTo(0, i * step);
      g.lineTo(w, i * step);
      g.stroke();
    }
  });
  // ExtrudeGeometry UVs are in metres; 0.5 repeat => 0.5m × 0.5m ceramic tiles.
  return makeCanvasTexture(canvas, 0.5, 0.5, true);
}

/** Subtle corrugated green metal roof texture for covered corridors (Photos 1 & 4). */
function corrugatedRoofTexture(baseHex: string) {
  const canvas = getCanvas(`corrugated:${baseHex}`, 256, 128, (g, w, h) => {
    g.fillStyle = baseHex;
    g.fillRect(0, 0, w, h);
    const ribs = 16,
      step = w / ribs;
    for (let i = 0; i < ribs; i++) {
      const x = i * step;
      g.fillStyle = shade(baseHex, 0.08);
      g.fillRect(x, 0, step * 0.35, h);
      g.fillStyle = shade(baseHex, -0.12);
      g.fillRect(x + step * 0.65, 0, step * 0.25, h);
    }
  });
  return makeCanvasTexture(canvas, 2, 1, true);
}

/** Bold red "RSUD MAMUJU TENGAH" fascia sign for the 3-storey PHTC building (Photo 5). */
function phtcSignTexture() {
  const canvas = getCanvas("phtc-rsud-sign", 1024, 160, (g, w, h) => {
    g.fillStyle = "#f1f3ef";
    g.fillRect(0, 0, w, h);
    // Subtle crisp architectural panel seam line along top & bottom.
    g.fillStyle = "#dde1da";
    g.fillRect(0, 0, w, 5);
    g.fillRect(0, h - 5, w, 5);
    // Crisp bold red institutional typography matching Photo 5.
    g.fillStyle = "#c41e22";
    g.font = "900 72px 'Arial Black', 'Helvetica Neue', Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("RSUD MAMUJU TENGAH", w / 2, h / 2 + 4);
  });
  return makeCanvasTexture(canvas);
}

/** Dark bronze-charcoal perforated batik/kerawang privacy lattice screen texture (Photo 5). */
function perforatedScreenTexture(repeatX = 3, repeatY = 1) {
  const canvas = getCanvas("phtc-kerawang-screen", 256, 256, (g, w, h) => {
    g.fillStyle = "#383530";
    g.fillRect(0, 0, w, h);
    const n = 4,
      step = w / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const cx = (i + 0.5) * step,
          cy = (j + 0.5) * step,
          r = step * 0.34;
        // Laser-cut diamond & petal perforations.
        g.fillStyle = "#1c1a17";
        g.beginPath();
        g.moveTo(cx, cy - r);
        g.lineTo(cx + r, cy);
        g.lineTo(cx, cy + r);
        g.lineTo(cx - r, cy);
        g.closePath();
        g.fill();
        // Corner circular cutouts forming a traditional Indonesian kerawang motif.
        g.beginPath();
        g.arc(i * step, j * step, step * 0.16, 0, Math.PI * 2);
        g.fill();
        // Bronze-charcoal filigree ring & inner star highlight.
        g.strokeStyle = "#5c574e";
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(cx, cy - r * 0.72);
        g.lineTo(cx + r * 0.72, cy);
        g.lineTo(cx, cy + r * 0.72);
        g.lineTo(cx - r * 0.72, cy);
        g.closePath();
        g.stroke();
        g.fillStyle = "#4a463f";
        g.beginPath();
        g.arc(cx, cy, step * 0.1, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Crisp dark bronze perimeter frame seam per panel tile.
    g.strokeStyle = "#262420";
    g.lineWidth = 5;
    g.strokeRect(2, 2, w - 4, h - 4);
  });
  return makeCanvasTexture(canvas, repeatX, repeatY, true);
}

/** Warm travertine/beige stone cladding texture for PHTC ground-floor base (Photo 5). */
function travertineTexture(repeatX = 3, repeatY = 2) {
  const canvas = getCanvas("phtc-travertine", 256, 256, (g, w, h) => {
    g.fillStyle = "#ddd2ba";
    g.fillRect(0, 0, w, h);
    const rows = 4,
      cols = 2,
      rh = h / rows,
      cw = w / cols;
    const tones = ["#ddd2ba", "#e3d9c3", "#d4c8ae", "#dacfb7"];
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (cw * 0.5);
      for (let c = -1; c <= cols; c++) {
        const x = c * cw + offset;
        g.fillStyle = tones[(r * 3 + c + 4) % tones.length];
        g.fillRect(x + 2, r * rh + 2, cw - 4, rh - 4);
        // Subtle horizontal travertine veining.
        g.fillStyle = "rgba(120, 102, 74, 0.08)";
        g.fillRect(x + 4, r * rh + rh * 0.42, cw - 8, 3);
      }
    }
    g.strokeStyle = "#c4b69a";
    g.lineWidth = 2;
    for (let r = 0; r <= rows; r++) {
      g.beginPath();
      g.moveTo(0, r * rh);
      g.lineTo(w, r * rh);
      g.stroke();
    }
  });
  return makeCanvasTexture(canvas, repeatX, repeatY, true);
}

const FLOOR_TOP = 0.24,
  ROOF_BOTTOM = 2.78,
  POST = 0.18,
  /** Target distance between support columns along a side, in metres. */
  POST_SPACING = 2.8,
  CORRIDOR_PITCH = 0.34,
  CORRIDOR_OVERHANG = 0.24;

/**
 * Iconic RSUD Mamuju Tengah covered walkway (Photos 1, 3, 4):
 * glossy off-white ceramic tiled floor, square lime-green painted concrete
 * columns with concrete footings & capitals, continuous green tie-beams,
 * pitched/gabled green-tinted corrugated metal canopy with crisp white fascia
 * and underside cross-beams.
 */
function corridorModel(p: Piece, _template: THREE.Object3D, pieces: Piece[]) {
  const group = new THREE.Group();
  const poly = footprint(p).map((v) => ({ x: v.x * 2, z: v.y * 2 }));
  const roofHex = p.roofColor ?? "#5b7d63";
  const tileTex = corridorFloorTexture(p.color);
  const roofTex = corrugatedRoofTexture(roofHex);

  const floorMaterial = new THREE.MeshStandardMaterial({
      color: tileTex ? "#ffffff" : mixHex("#ecefe8", p.color, 0.22),
      map: tileTex,
      roughness: 0.36,
      metalness: 0.04,
    }),
    columnMaterial = new THREE.MeshStandardMaterial({ color: "#8cc962", roughness: 0.68, metalness: 0.04 }),
    capitalMaterial = new THREE.MeshStandardMaterial({ color: "#76b350", roughness: 0.64, metalness: 0.05 }),
    concreteMaterial = new THREE.MeshStandardMaterial({ color: "#d5dbd0", roughness: 0.8, metalness: 0.04 }),
    fasciaMaterial = new THREE.MeshStandardMaterial({ color: "#f3f6f1", roughness: 0.52, metalness: 0.05 }),
    roofMaterial = new THREE.MeshStandardMaterial({
      color: roofTex ? "#ffffff" : roofHex,
      map: roofTex,
      roughness: 0.56,
      metalness: 0.22,
    }),
    ridgeMaterial = new THREE.MeshStandardMaterial({ color: shade(roofHex, -0.18), roughness: 0.52, metalness: 0.26 }),
    trussMaterial = new THREE.MeshStandardMaterial({ color: "#b6c0b8", roughness: 0.48, metalness: 0.35 }),
    lightMaterial = new THREE.MeshStandardMaterial({
      color: "#fffcf2",
      emissive: "#fff4d6",
      emissiveIntensity: 0.4,
      roughness: 0.3,
    });

  group.add(slab("Continuous corridor floor", poly, 0, FLOOR_TOP, floorMaterial));

  const postH = ROOF_BOTTOM - FLOOR_TOP,
    inward = turning(poly) > 0 ? 1 : -1,
    ends = corridorEnds(p);

  poly.forEach((a, i) => {
    if (ends.includes(i)) return;
    const b = poly[(i + 1) % poly.length],
      open = exposedRuns(p, i, pieces),
      length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.01) return;
    const dx = (b.x - a.x) / length,
      dz = (b.z - a.z) / length,
      nx = -dz * inward,
      nz = dx * inward,
      alongX = Math.abs(b.x - a.x) > Math.abs(b.z - a.z),
      count = Math.max(1, Math.round(length / POST_SPACING));

    // Square lime-green concrete columns with concrete footings & top capitals.
    for (let k = 0; k < count; k++) {
      const f = (k + 0.5) / count;
      if (!open.some(([from, to]) => f >= from && f <= to)) continue;
      const t = f * length,
        px = a.x + dx * t + nx * 0.12,
        pz = a.z + dz * t + nz * 0.12;

      addBox(group, "Corridor post column", px, FLOOR_TOP + postH / 2, pz, POST, postH, POST, columnMaterial);
      addBox(group, "Corridor post footing", px, FLOOR_TOP + 0.07, pz, POST + 0.08, 0.14, POST + 0.08, concreteMaterial);
      addBox(group, "Corridor post capital", px, ROOF_BOTTOM - 0.08, pz, POST + 0.05, 0.1, POST + 0.05, capitalMaterial);
    }

    // Exposed walkway edges get a clean floor kerb, green top tie-beam, and crisp white roof fascia.
    for (const [from, to] of open) {
      const run = (to - from) * length;
      if (run < 0.15) continue;
      const mid = ((from + to) / 2) * length,
        mx = a.x + dx * mid,
        mz = a.z + dz * mid;

      // Low concrete edge kerb flush with the tiled walkway.
      addBox(
        group,
        "Corridor floor kerb",
        mx + nx * 0.05,
        FLOOR_TOP + 0.035,
        mz + nz * 0.05,
        alongX ? run : 0.1,
        0.07,
        alongX ? 0.1 : run,
        concreteMaterial,
      );

      // Continuous lime-green concrete tie-beam along column tops (Photo 4).
      addBox(
        group,
        "Corridor beam tie",
        mx + nx * 0.12,
        ROOF_BOTTOM - 0.1,
        mz + nz * 0.12,
        alongX ? run : 0.16,
        0.16,
        alongX ? 0.16 : run,
        columnMaterial,
      );

      // Crisp white canopy fascia trim along overhanging eave edge.
      addBox(
        group,
        "Corridor roof fascia",
        mx - nx * (CORRIDOR_OVERHANG - 0.03),
        ROOF_BOTTOM + 0.04,
        mz - nz * (CORRIDOR_OVERHANG - 0.03),
        alongX ? run + 0.08 : 0.06,
        0.17,
        alongX ? 0.06 : run + 0.08,
        fasciaMaterial,
      );
    }
  });

  // Pitched / gabled canopy roof builder for a rectangular corridor arm.
  const addCanopySpan = (
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    alongX: boolean,
    extendStart = false,
    extendEnd = false,
  ) => {
    const span = alongX ? z1 - z0 : x1 - x0,
      len = alongX ? x1 - x0 : z1 - z0,
      half = span / 2 + CORRIDOR_OVERHANG,
      rise = Math.min(0.82, half * CORRIDOR_PITCH),
      slope = Math.atan2(rise, half),
      slopeLen = Math.hypot(half, rise),
      lo = (alongX ? x0 : z0) - (extendStart ? 0.16 : 0),
      hi = (alongX ? x1 : z1) + (extendEnd ? 0.16 : 0),
      mid = (lo + hi) / 2,
      cx = (x0 + x1) / 2,
      cz = (z0 + z1) / 2,
      runLen = hi - lo;

    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? runLen : slopeLen, 0.08, alongX ? slopeLen : runLen),
        roofMaterial,
      );
      panel.name = "Corridor roof slope";
      if (alongX) {
        panel.position.set(mid, ROOF_BOTTOM + 0.06 + rise / 2, cz + (side * half) / 2);
        panel.rotation.x = side * slope;
      } else {
        panel.position.set(cx + (side * half) / 2, ROOF_BOTTOM + 0.06 + rise / 2, mid);
        panel.rotation.z = -side * slope;
      }
      group.add(panel);
    }

    // Crisp metal ridge cap along the canopy peak.
    addBox(
      group,
      "Corridor roof ridge",
      alongX ? mid : cx,
      ROOF_BOTTOM + 0.1 + rise,
      alongX ? cz : mid,
      alongX ? runLen + 0.06 : 0.15,
      0.1,
      alongX ? 0.15 : runLen + 0.06,
      ridgeMaterial,
    );

    // Underside lime-green cross-beams & steel roof truss chords (Photo 4).
    const bays = Math.max(1, Math.round(len / POST_SPACING));
    for (let k = 0; k < bays; k++) {
      const u = (alongX ? x0 : z0) + ((k + 0.5) / bays) * len;
      addBox(
        group,
        "Corridor beam cross",
        alongX ? u : cx,
        ROOF_BOTTOM - 0.08,
        alongX ? cz : u,
        alongX ? 0.14 : Math.max(0.2, span - 0.16),
        0.14,
        alongX ? Math.max(0.2, span - 0.16) : 0.14,
        columnMaterial,
      );
      // Slim galvanized king-post strut rising from cross-beam to ridge.
      addBox(
        group,
        "Corridor truss strut",
        alongX ? u : cx,
        ROOF_BOTTOM + rise / 2,
        alongX ? cz : u,
        0.05,
        Math.max(0.1, rise),
        0.05,
        trussMaterial,
        true,
      );
    }
    return rise;
  };

  const wM = p.w * 2,
    hM = p.h * 2,
    x0 = p.x * 2,
    z0 = p.y * 2,
    x1 = x0 + wM,
    z1 = z0 + hM,
    cx = (x0 + x1) / 2,
    cz = (z0 + z1) / 2;

  if (p.kind === "straight") {
    const alongX = p.w !== p.h ? p.w > p.h : p.rotation % 180 === 0;
    addCanopySpan(x0, z0, x1, z1, alongX, false, false);

    // Subtle recessed ceiling light bar under centerline.
    const span = Math.max(0.6, (alongX ? wM : hM) - 0.8);
    addBox(
      group,
      "Corridor roof light",
      cx,
      ROOF_BOTTOM + 0.02,
      cz,
      alongX ? span : 0.12,
      0.03,
      alongX ? 0.12 : span,
      lightMaterial,
      true,
    );
  } else {
    // Corner, T-junction, and cross corridors: pitched canopy arms + crisp soffit deck.
    const soffitPoly = offsetPoly(poly, 0.06);
    group.add(slab("Corridor roof soffit", soffitPoly, ROOF_BOTTOM - 0.02, ROOF_BOTTOM + 0.08, fasciaMaterial));

    const rectFromUnit = (ux0: number, uy0: number, ux1: number, uy1: number) => {
      const turn = (x: number, y: number) => {
        for (let i = 0; i < p.rotation / 90; i++) [x, y] = [1 - y, x];
        return { x: (p.x + x * p.w) * 2, z: (p.y + y * p.h) * 2 };
      };
      const a = turn(ux0, uy0),
        b = turn(ux1, uy1);
      return {
        x0: Math.min(a.x, b.x),
        z0: Math.min(a.z, b.z),
        x1: Math.max(a.x, b.x),
        z1: Math.max(a.z, b.z),
      };
    };
    const quarter = p.rotation % 180 !== 0;

    if (p.kind === "corner") {
      const armA = rectFromUnit(0, 0.5, 1, 1);
      const armB = rectFromUnit(0, 0, 0.5, 0.8);
      addCanopySpan(armA.x0, armA.z0, armA.x1, armA.z1, !quarter);
      addCanopySpan(armB.x0, armB.z0, armB.x1, armB.z1, quarter);
    } else if (p.kind === "junction") {
      const mainArm = rectFromUnit(0, 0, 1, 0.5);
      const stemArm = rectFromUnit(1 / 3, 0.2, 2 / 3, 1);
      addCanopySpan(mainArm.x0, mainArm.z0, mainArm.x1, mainArm.z1, !quarter);
      addCanopySpan(stemArm.x0, stemArm.z0, stemArm.x1, stemArm.z1, quarter);
    } else {
      // Cross junction: two crossing pitched arms.
      const hArm = rectFromUnit(0, 1 / 3, 1, 2 / 3);
      const vArm = rectFromUnit(1 / 3, 0, 2 / 3, 1);
      addCanopySpan(hArm.x0, hArm.z0, hArm.x1, hArm.z1, !quarter);
      addCanopySpan(vArm.x0, vArm.z0, vArm.x1, vArm.z1, quarter);
    }
  }

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
      nx = (-(b.z - a.z) / length) * inward,
      nz = ((b.x - a.x) / length) * inward;
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
  const motorcycle = (bay: { x: number; y: number; row: number }, colour: string) => {
    const x = bay.x * 2,
      z = bay.y * 2,
      out = bay.row ? -1 : 1,
      along = (d: number) => (alongX ? { x, z: z + d * out } : { x: x + d * out, z });
    const body = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.4, metalness: 0.2 });
    for (const d of [-0.62, 0.62]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 16), rubber),
        at = along(d);
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
      back = bay.row ? 0.25 : -0.25,
      x = bay.x * 2,
      z = bay.y * 2;
    box("Parking car body", x, 0.5, z, 1.8, 0.6, Math.min(4.2, depth - 0.6), body);
    box("Parking car cabin", alongX ? x : x + back, 1.05, alongX ? z + back : z, 1.6, 0.5, Math.min(2.2, depth - 1.6), glass);
  }
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
  const steel = new THREE.MeshStandardMaterial({ color: "#8d9599", metalness: 0.6, roughness: 0.4 }),
    corner = { x: p.x * 2 + 0.35, z: (p.y + p.h) * 2 - 0.35 };
  box("Parking sign post", corner.x, 1.1, corner.z, 0.08, 2.2, 0.08, steel);
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
  const face = signTexture(p.name, "#2f7d44", 512),
    board = new THREE.MeshStandardMaterial({ color: face ? "white" : "#2f7d44", map: face, roughness: 0.5 }),
    signLength = Math.max(0.5, length - 0.3);
  for (const side of [-1, 1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(signLength, 0.75), board),
      v = a.v + side * 0.21;
    sign.position.set(p.x * 2 + (alongX ? mid : v), HEIGHT - 0.55, p.y * 2 + (alongX ? v : mid));
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
  OVERHANG = 0.36,
  PITCH = 0.46;

type PitchedMats = {
  roof: THREE.MeshStandardMaterial;
  tileRib: THREE.MeshStandardMaterial;
  ridge: THREE.MeshStandardMaterial;
  fascia: THREE.MeshStandardMaterial;
  gutter: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  ventDark: THREE.MeshStandardMaterial;
};

/**
 * High-craft gabled roof over a rectangle (metres), matching Photos 1 & 3:
 * layered sage-green ceramic tile roof with horizontal tile courses, crisp
 * white fascia boards & overhanging eaves soffits, ridge cap, solid triangular
 * gable end walls, and dark louvered triangular attic vents.
 */
function buildGable(
  group: THREE.Group,
  r: { x0: number; z0: number; x1: number; z1: number },
  alongX: boolean,
  gables: [boolean, boolean],
  mats: PitchedMats,
) {
  const span = alongX ? r.z1 - r.z0 : r.x1 - r.x0,
    half = span / 2 + OVERHANG,
    rise = half * PITCH,
    slope = Math.atan2(rise, half),
    slopeLen = Math.hypot(half, rise),
    // Ends with a gable wall overhang cleanly; ends meeting a crossing roof stop flush.
    lo = (alongX ? r.x0 : r.z0) - (gables[0] ? 0.34 : 0),
    hi = (alongX ? r.x1 : r.z1) + (gables[1] ? 0.34 : 0),
    runLen = hi - lo,
    mid = (lo + hi) / 2,
    cx = (r.x0 + r.x1) / 2,
    cz = (r.z0 + r.z1) / 2;

  // Overhanging white soffit & fascia box enclosing parapet coping (y=3.84..3.98).
  const soffitW = alongX ? runLen - 0.04 : span + OVERHANG * 2 - 0.04,
    soffitD = alongX ? span + OVERHANG * 2 - 0.04 : runLen - 0.04;
  addBox(group, "Roof eave soffit", alongX ? mid : cx, EAVE - 0.02, alongX ? cz : mid, soffitW, 0.14, soffitD, mats.fascia);

  // Sloped ceramic tile planes, stepped tile rib courses, eave fascia, and gutters.
  const ribSpacing = 0.44,
    ribCount = Math.max(2, Math.floor((slopeLen - 0.25) / ribSpacing));

  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(alongX ? runLen : slopeLen, 0.13, alongX ? slopeLen : runLen),
      mats.roof,
    );
    panel.name = "Pitched roof plane";
    if (alongX) {
      panel.position.set(mid, EAVE + 0.04 + rise / 2, cz + (side * half) / 2);
      panel.rotation.x = side * slope;
    } else {
      panel.position.set(cx + (side * half) / 2, EAVE + 0.04 + rise / 2, mid);
      panel.rotation.z = -side * slope;
    }
    group.add(panel);

    // Subtle stepped horizontal ceramic tile courses up each slope (Photo 1).
    for (let k = 0; k < ribCount; k++) {
      const f = (k + 0.4) / ribCount; // 0 near eave -> 1 near ridge
      const distOut = half * (1 - f),
        y = EAVE + 0.12 + rise * f;
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? runLen + 0.02 : 0.11, 0.045, alongX ? 0.11 : runLen + 0.02),
        mats.tileRib,
      );
      rib.name = "Roof tile course";
      if (alongX) {
        rib.position.set(mid, y, cz + side * distOut);
        rib.rotation.x = side * slope;
      } else {
        rib.position.set(cx + side * distOut, y, mid);
        rib.rotation.z = -side * slope;
      }
      group.add(rib);
    }

    // Crisp white eave fascia board + slim dark rain gutter along outer eave.
    const eaveOut = half - 0.02;
    addBox(
      group,
      "Roof eave fascia",
      alongX ? mid : cx + side * eaveOut,
      EAVE + 0.01,
      alongX ? cz + side * eaveOut : mid,
      alongX ? runLen + 0.04 : 0.06,
      0.19,
      alongX ? 0.06 : runLen + 0.04,
      mats.fascia,
    );
    addBox(
      group,
      "Roof rain gutter",
      alongX ? mid : cx + side * (half + 0.04),
      EAVE - 0.02,
      alongX ? cz + side * (half + 0.04) : mid,
      alongX ? runLen + 0.06 : 0.07,
      0.08,
      alongX ? 0.07 : runLen + 0.06,
      mats.gutter,
    );
  }

  // Layered ceramic ridge cap along the peak.
  addBox(
    group,
    "Roof ridge cap",
    alongX ? mid : cx,
    EAVE + rise + 0.11,
    alongX ? cz : mid,
    alongX ? runLen + 0.08 : 0.22,
    0.14,
    alongX ? 0.22 : runLen + 0.08,
    mats.ridge,
  );
  addBox(
    group,
    "Roof ridge crest",
    alongX ? mid : cx,
    EAVE + rise + 0.19,
    alongX ? cz : mid,
    alongX ? runLen + 0.12 : 0.12,
    0.06,
    alongX ? 0.12 : runLen + 0.12,
    mats.ridge,
  );

  // Solid triangular gable end walls, white sloped bargeboards, and louvered attic vents (Photo 3).
  gables.forEach((show, i) => {
    if (!show) return;
    const isHigh = i === 1,
      outDir = isHigh ? 1 : -1,
      wallFace = alongX ? (isHigh ? r.x1 : r.x0) : isHigh ? r.z1 : r.z0,
      endEdge = isHigh ? hi : lo,
      a = alongX ? r.z0 : r.x0,
      b = alongX ? r.z1 : r.x1,
      vMid = (a + b) / 2,
      innerRise = (span / 2) * PITCH + 0.08;

    // Solid extruded triangular gable prism flush with the wall below.
    const tri = new THREE.Shape([
      new THREE.Vector2(-span / 2, 0),
      new THREE.Vector2(span / 2, 0),
      new THREE.Vector2(0, innerRise),
    ]);
    const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.16, bevelEnabled: false });
    if (alongX) {
      geo.rotateY(Math.PI / 2);
      geo.translate(wallFace - (isHigh ? 0.16 : 0), EAVE - 0.06, vMid);
    } else {
      geo.translate(vMid, EAVE - 0.06, wallFace - (isHigh ? 0.16 : 0));
    }
    const gableWall = new THREE.Mesh(geo, mats.wall);
    gableWall.name = "Triangular gable walls";
    group.add(gableWall);

    // Crisp white sloped gable bargeboards at the overhanging end.
    for (const side of [-1, 1]) {
      const barge = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? 0.06 : slopeLen + 0.04, 0.17, alongX ? slopeLen + 0.04 : 0.06),
        mats.fascia,
      );
      barge.name = "Roof gable bargeboard";
      if (alongX) {
        barge.position.set(endEdge - outDir * 0.03, EAVE + 0.03 + rise / 2, vMid + (side * half) / 2);
        barge.rotation.x = side * slope;
      } else {
        barge.position.set(vMid + (side * half) / 2, EAVE + 0.03 + rise / 2, endEdge - outDir * 0.03);
        barge.rotation.z = -side * slope;
      }
      group.add(barge);
    }

    // Neat triangular louvered attic vent centered in the upper gable (Photo 3).
    const ventBaseY = EAVE + innerRise * 0.42,
      ventH = Math.min(0.68, innerRise * 0.42),
      ventW = Math.min(1.35, ventH / PITCH * 1.75),
      ventOut = wallFace + outDir * 0.02;

    if (ventH > 0.22 && ventW > 0.4) {
      // Crisp white vent frame + dark recessed louver backing.
      const frameTri = new THREE.Shape([
        new THREE.Vector2(-ventW / 2 - 0.06, -0.04),
        new THREE.Vector2(ventW / 2 + 0.06, -0.04),
        new THREE.Vector2(0, ventH + 0.07),
      ]);
      const frameGeo = new THREE.ExtrudeGeometry(frameTri, { depth: 0.05, bevelEnabled: false });
      const darkTri = new THREE.Shape([
        new THREE.Vector2(-ventW / 2, 0),
        new THREE.Vector2(ventW / 2, 0),
        new THREE.Vector2(0, ventH),
      ]);
      const darkGeo = new THREE.ExtrudeGeometry(darkTri, { depth: 0.06, bevelEnabled: false });
      if (alongX) {
        frameGeo.rotateY(Math.PI / 2);
        frameGeo.translate(ventOut - (isHigh ? 0.03 : 0.02), ventBaseY, vMid);
        darkGeo.rotateY(Math.PI / 2);
        darkGeo.translate(ventOut - (isHigh ? 0.02 : 0.04), ventBaseY, vMid);
      } else {
        frameGeo.translate(vMid, ventBaseY, ventOut - (isHigh ? 0.03 : 0.02));
        darkGeo.translate(vMid, ventBaseY, ventOut - (isHigh ? 0.02 : 0.04));
      }
      const frameMesh = new THREE.Mesh(frameGeo, mats.fascia);
      frameMesh.name = "Gable vent frame";
      const darkMesh = new THREE.Mesh(darkGeo, mats.ventDark);
      darkMesh.name = "Gable louver vent";
      group.add(frameMesh, darkMesh);

      // Horizontal louver slats across the triangular vent.
      for (let s = 0; s < 3; s++) {
        const frac = (s + 0.5) / 3.4,
          sy = ventBaseY + ventH * frac,
          sw = ventW * (1 - frac) * 0.9;
        addBox(
          group,
          "Gable louver slat",
          alongX ? ventOut + outDir * 0.03 : vMid,
          sy,
          alongX ? vMid : ventOut + outDir * 0.03,
          alongX ? 0.03 : sw,
          0.035,
          alongX ? sw : 0.03,
          mats.fascia,
          true,
        );
      }
    }
  });
}

/**
 * Polished procedural pitched roof for both rectangular and L-shaped buildings
 * (Photos 1 & 3). Positioned at single-storey height; `pieceModel` elevates by
 * `((p.floors ?? 1) - 1) * STOREY`.
 */
function pitchedRoofModel(p: Piece) {
  const group = new THREE.Group();
  const roofHex = p.roofColor ?? "#4c7051";
  const mats: PitchedMats = {
    roof: new THREE.MeshStandardMaterial({ color: roofHex, roughness: 0.62, metalness: 0.06 }),
    tileRib: new THREE.MeshStandardMaterial({ color: shade(roofHex, -0.11), roughness: 0.68, metalness: 0.05 }),
    ridge: new THREE.MeshStandardMaterial({ color: shade(roofHex, -0.18), roughness: 0.56, metalness: 0.08 }),
    fascia: new THREE.MeshStandardMaterial({ color: "#f4f6f2", roughness: 0.52, metalness: 0.04 }),
    gutter: new THREE.MeshStandardMaterial({ color: "#586660", roughness: 0.45, metalness: 0.3 }),
    wall: new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.72 }),
    ventDark: new THREE.MeshStandardMaterial({ color: "#28322e", roughness: 0.78 }),
  };

  if (p.shape === "L") {
    const rect = (ux0: number, uy0: number, ux1: number, uy1: number) => {
      const turn = (x: number, y: number) => {
        for (let i = 0; i < p.rotation / 90; i++) [x, y] = [1 - y, x];
        return { x: (p.x + x * p.w) * 2, z: (p.y + y * p.h) * 2 };
      };
      const a = turn(ux0, uy0),
        b = turn(ux1, uy1);
      return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) };
    };
    const quarter = p.rotation % 180 !== 0;
    buildGable(group, rect(0, 0.5, 1, 1), !quarter, [true, true], mats);
    const outerLow = p.rotation === 0 || p.rotation === 270;
    buildGable(group, rect(0, 0, 0.5, 0.75), quarter, outerLow ? [true, false] : [false, true], mats);
    return group;
  }

  const r = { x0: p.x * 2, z0: p.y * 2, x1: (p.x + p.w) * 2, z1: (p.y + p.h) * 2 };
  const alongX = p.w !== p.h ? p.w > p.h : p.rotation % 180 === 0;
  buildGable(group, r, alongX, [true, true], mats);
  return group;
}

/**
 * Polished procedural flat roof for rectangular & L-shaped hospital buildings
 * (Photo 2 & multi-storey hospital wings): overhanging concrete roof slab with
 * crisp drip edge, raised parapet rim tinted from `p.roofColor` / `p.color`,
 * recessed roof membrane, and architectural rooftop details (stair/lift
 * bulkhead penthouse, HVAC chillers, exhaust vents).
 */
function flatRoofModel(p: Piece) {
  const group = new THREE.Group();
  const polyTile = footprint(p);
  const poly = polyTile.map((v) => ({ x: v.x * 2, z: v.y * 2 }));
  const eaves = offsetPoly(poly, 0.24);
  const innerDeck = offsetPoly(poly, -0.22);

  const parapetHex = p.roofColor ?? shade(p.color, -0.14);
  const slabHex = mixHex("#eef2ea", p.color, 0.14);
  const slabMat = new THREE.MeshStandardMaterial({ color: slabHex, roughness: 0.62, metalness: 0.05 }),
    fasciaMat = new THREE.MeshStandardMaterial({ color: "#f4f6f2", roughness: 0.52, metalness: 0.06 }),
    parapetMat = new THREE.MeshStandardMaterial({ color: parapetHex, roughness: 0.64, metalness: 0.06 }),
    copingMat = new THREE.MeshStandardMaterial({ color: "#e8ece5", roughness: 0.58, metalness: 0.08 }),
    membraneMat = new THREE.MeshStandardMaterial({ color: "#7d8884", roughness: 0.88 }),
    mechMat = new THREE.MeshStandardMaterial({ color: "#cfd6d1", roughness: 0.5, metalness: 0.22 }),
    grilleMat = new THREE.MeshStandardMaterial({ color: "#2d3538", roughness: 0.62, metalness: 0.3 }),
    bulkheadMat = new THREE.MeshStandardMaterial({ color: mixHex("#eef2ec", p.color, 0.28), roughness: 0.68 }),
    glassMat = new THREE.MeshStandardMaterial({ color: "#527a8a", roughness: 0.18, metalness: 0.32 });
  glassMat.name = "Skylight window glazing";

  // Overhanging concrete roof slab (y=3.84..4.08) enclosing wall coping cleanly.
  group.add(slab("Flat roof slab", eaves, 3.84, 4.08, slabMat));
  // Recessed dark waterproof roof membrane inside the parapet.
  group.add(slab("Flat roof membrane", innerDeck, 4.06, 4.13, membraneMat));

  // Crisp raised perimeter parapet wall + concrete coping + outer drip-edge trim.
  const inward = turning(poly) > 0 ? 1 : -1;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length],
      length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.01) return;
    const horizontal = Math.abs(b.x - a.x) > Math.abs(b.z - a.z),
      nx = (-(b.z - a.z) / length) * inward,
      nz = ((b.x - a.x) / length) * inward,
      mx = (a.x + b.x) / 2,
      mz = (a.z + b.z) / 2;

    // Raised parapet wall along footprint boundary.
    addBox(
      group,
      "Flat roof parapet",
      mx + nx * 0.11,
      4.26,
      mz + nz * 0.11,
      horizontal ? length + 0.02 : 0.22,
      0.36,
      horizontal ? 0.22 : length + 0.02,
      parapetMat,
    );
    // Crisp parapet coping cap.
    addBox(
      group,
      "Flat roof coping",
      mx + nx * 0.11,
      4.47,
      mz + nz * 0.11,
      horizontal ? length + 0.08 : 0.28,
      0.07,
      horizontal ? 0.28 : length + 0.08,
      copingMat,
    );
    // Crisp outer slab fascia drip edge.
    addBox(
      group,
      "Flat roof fascia",
      mx - nx * 0.24,
      3.96,
      mz - nz * 0.24,
      horizontal ? length + 0.52 : 0.05,
      0.24,
      horizontal ? 0.05 : length + 0.52,
      fasciaMat,
    );
  });

  // Helper to verify a rooftop item (centred at world x, z with half-extents hx, hz) fits safely inside the roof.
  const fitsRoof = (wx: number, wz: number, hx: number, hz: number) => {
    const pad = 0.65;
    for (const [dx, dz] of [
      [-hx - pad, -hz - pad],
      [hx + pad, -hz - pad],
      [hx + pad, hz + pad],
      [-hx - pad, hz + pad],
    ]) {
      if (!inPolygon({ x: (wx + dx) / 2, y: (wz + dz) / 2 }, polyTile)) return false;
    }
    return true;
  };

  const occupied: { x: number; z: number; hx: number; hz: number }[] = [];
  const freeSpot = (wx: number, wz: number, hx: number, hz: number) =>
    fitsRoof(wx, wz, hx, hz) &&
    !occupied.some((o) => Math.abs(wx - o.x) < hx + o.hx + 0.4 && Math.abs(wz - o.z) < hz + o.hz + 0.4);

  const deckY = 4.13;
  const floors = p.floors ?? 1;
  const areaTiles = p.shape === "L" ? p.w * p.h * 0.75 : p.w * p.h;

  // 1. Stair / lift bulkhead penthouse when multi-storey or large footprint.
  if (floors >= 2 || areaTiles >= 24) {
    const stairsRoom = p.roomAssets?.find((r) => r.type === "stairs");
    const bx = stairsRoom ? (p.x + stairsRoom.x + stairsRoom.w / 2) * 2 : (p.x + p.w * 0.28) * 2;
    const bz = stairsRoom ? (p.y + stairsRoom.y + stairsRoom.h / 2) * 2 : (p.y + p.h * 0.35) * 2;
    const bw = Math.min(2.8, Math.max(1.8, (stairsRoom?.w ?? 1.2) * 1.6));
    const bd = Math.min(2.4, Math.max(1.6, (stairsRoom?.h ?? 1.0) * 1.6));
    const bh = floors >= 3 ? 2.15 : 1.75;
    if (freeSpot(bx, bz, bw / 2, bd / 2)) {
      occupied.push({ x: bx, z: bz, hx: bw / 2, hz: bd / 2 });
      addBox(group, "Roof bulkhead body", bx, deckY + bh / 2, bz, bw, bh, bd, bulkheadMat);
      addBox(group, "Roof bulkhead cap", bx, deckY + bh + 0.08, bz, bw + 0.24, 0.14, bd + 0.24, copingMat);
      addBox(group, "Roof bulkhead door", bx, deckY + Math.min(1.4, bh - 0.25) / 2, bz + bd / 2 + 0.02, 0.75, Math.min(1.4, bh - 0.25), 0.05, grilleMat);
    }
  }

  // 2. Rooftop HVAC chiller units with dark fan grilles and slim ductwork.
  const hvacCandidates = [
    { x: (p.x + p.w * 0.72) * 2, z: (p.y + p.h * 0.65) * 2 },
    { x: (p.x + p.w * 0.55) * 2, z: (p.y + p.h * 0.7) * 2 },
    { x: (p.x + p.w * 0.26) * 2, z: (p.y + p.h * 0.72) * 2 },
    { x: (p.x + p.w * 0.5) * 2, z: (p.y + p.h * 0.5) * 2 },
  ];
  const wantUnits = areaTiles >= 30 ? 3 : areaTiles >= 14 ? 2 : 1;
  let placedUnits = 0;
  for (const cand of hvacCandidates) {
    if (placedUnits >= wantUnits) break;
    const uw = 1.35,
      ud = 0.95,
      uh = 0.76;
    if (!freeSpot(cand.x, cand.z, uw / 2, ud / 2)) continue;
    occupied.push({ x: cand.x, z: cand.z, hx: uw / 2, hz: ud / 2 });
    placedUnits++;
    addBox(group, "Roof HVAC pad", cand.x, deckY + 0.06, cand.z, uw + 0.16, 0.12, ud + 0.16, copingMat);
    addBox(group, "Roof HVAC unit", cand.x, deckY + 0.12 + uh / 2, cand.z, uw, uh, ud, mechMat);
    // Twin dark fan grilles on top + side louver panel.
    for (const dx of [-0.32, 0.32]) {
      addBox(group, "Roof HVAC fan", cand.x + dx, deckY + 0.12 + uh + 0.02, cand.z, 0.44, 0.04, 0.54, grilleMat, true);
    }
    addBox(group, "Roof HVAC louver", cand.x, deckY + 0.12 + uh * 0.5, cand.z + ud / 2 + 0.015, uw * 0.75, uh * 0.52, 0.03, grilleMat, true);
  }

  // 3. Compact skylight or exhaust vent on wider roofs.
  const skyX = (p.x + p.w * 0.42) * 2,
    skyZ = (p.y + p.h * 0.34) * 2;
  if (areaTiles >= 20 && freeSpot(skyX, skyZ, 1.1, 0.7)) {
    occupied.push({ x: skyX, z: skyZ, hx: 1.1, hz: 0.7 });
    addBox(group, "Roof skylight curb", skyX, deckY + 0.14, skyZ, 2.1, 0.28, 1.3, copingMat);
    addBox(group, "Roof skylight window glazing", skyX, deckY + 0.32, skyZ, 1.94, 0.1, 1.14, glassMat, true);
    addBox(group, "Roof skylight mullion", skyX, deckY + 0.34, skyZ, 0.06, 0.12, 1.18, grilleMat, true);
  } else {
    const ventX = (p.x + p.w * 0.3) * 2,
      ventZ = (p.y + p.h * 0.68) * 2;
    if (freeSpot(ventX, ventZ, 0.35, 0.35)) {
      addBox(group, "Roof exhaust vent", ventX, deckY + 0.24, ventZ, 0.46, 0.48, 0.46, mechMat);
      addBox(group, "Roof exhaust cap", ventX, deckY + 0.5, ventZ, 0.58, 0.08, 0.58, grilleMat);
    }
  }

  return group;
}

/**
 * Signature 3-storey RSUD Mamuju Tengah PHTC building (Photo 5 — Karya PTPP).
 * Built in local centred coordinates (`x ∈ [-L/2, L/2]`, `z ∈ [-D/2, D/2]`),
 * with the main front facade facing `+z` (south at rotation 0°), then turned
 * cleanly for `p.rotation` (0 / 90 / 180 / 270) and placed on the footprint.
 *
 * Features:
 * - Crisp white architectural concrete frame & cantilevered horizontal floor bands
 * - Warm travertine/beige stone ground-floor base piers & corner plinths
 * - Continuous dark-tinted reflective blue-grey curtain walls (named with
 *   "window glazing" so dusk/night glow in HospitalScene lights up!) with
 *   charcoal aluminum mullions & transoms
 * - 3rd-floor recessed balcony with dark perforated batik/kerawang screens
 * - Monumental front-right entrance atrium tower with tall vertical projecting
 *   white fins, full-height perforated accent screen bay, and right glass wing
 * - Cantilevered glass-and-steel entrance canopy (porte-cochère) with tension rods
 * - Bold red "RSUD MAMUJU TENGAH" parapet fascia sign
 * - Flat rooftop with raised white parapet, recessed dark membrane, stair/lift
 *   bulkhead penthouse, and screened HVAC chiller units
 */
function phtcModel(p: Piece) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const rotated = p.rotation % 180 !== 0;
  const L = (rotated ? p.h : p.w) * 2; // Front facade width (metres)
  const D = (rotated ? p.w : p.h) * 2; // Building depth (metres)
  const floors = p.floors ?? 3;
  const H = floors * STOREY;

  body.rotation.y = (-p.rotation * Math.PI) / 180;
  body.position.set((p.x + p.w / 2) * 2, 0, (p.y + p.h / 2) * 2);

  // Shared materials per building so `batchMeshes()` merges efficiently.
  const whiteHex = p.color && /^#[0-9a-f]{6}$/i.test(p.color) ? mixHex("#f3f5f2", p.color, 0.2) : "#f3f5f2";
  const whiteMat = new THREE.MeshStandardMaterial({ color: whiteHex, roughness: 0.56, metalness: 0.04 });
  const slabMat = new THREE.MeshStandardMaterial({ color: "#eaeee8", roughness: 0.52, metalness: 0.05 });
  const copingMat = new THREE.MeshStandardMaterial({ color: "#d9ded6", roughness: 0.52, metalness: 0.08 });

  const travTex = travertineTexture(2, 1);
  const travertineMat = new THREE.MeshStandardMaterial({
    color: travTex ? "#ffffff" : "#ddd2ba",
    map: travTex,
    roughness: 0.72,
    metalness: 0.03,
  });

  // Bright sky-tinted translucent architectural glass (keeps "window glazing" name for dusk/night glow).
  const glazingMat = new THREE.MeshStandardMaterial({
    color: "#8cc4dc",
    roughness: 0.12,
    metalness: 0.08,
    transparent: true,
    opacity: 0.54,
    depthWrite: false,
  });
  glazingMat.name = "PHTC window glazing";

  const mullionMat = new THREE.MeshStandardMaterial({ color: "#4b5861", roughness: 0.38, metalness: 0.22 });
  // Bright warm-cream sunlit hospital interior backing & subtle ceiling/floor bands seen through the glass.
  const interiorWallMat = new THREE.MeshStandardMaterial({ color: "#e6e8df", roughness: 0.8, metalness: 0.02 });
  const interiorSlabMat = new THREE.MeshStandardMaterial({ color: "#dce5e2", roughness: 0.68, metalness: 0.04 });

  const screenTexH = perforatedScreenTexture(3, 1);
  const screenMatH = new THREE.MeshStandardMaterial({
    color: screenTexH ? "#ffffff" : "#383530",
    map: screenTexH,
    roughness: 0.52,
    metalness: 0.2,
  });
  const screenTexV = perforatedScreenTexture(1, 5);
  const screenMatV = new THREE.MeshStandardMaterial({
    color: screenTexV ? "#ffffff" : "#383530",
    map: screenTexV,
    roughness: 0.52,
    metalness: 0.2,
  });

  // Translucent sky-blue canopy panel (intentionally avoids "window|glass|glazing" so it doesn't glow yellow at night).
  const canopyPanelMat = new THREE.MeshStandardMaterial({
    color: "#86c0da",
    roughness: 0.14,
    metalness: 0.1,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  });
  const steelMat = new THREE.MeshStandardMaterial({ color: "#4e5961", roughness: 0.36, metalness: 0.28 });
  const roofMembraneMat = new THREE.MeshStandardMaterial({ color: "#687270", roughness: 0.9 });
  const mechMat = new THREE.MeshStandardMaterial({ color: "#cfd6d2", roughness: 0.5, metalness: 0.2 });

  // Horizontal layout zones along front facade X ∈ [-L/2, +L/2]:
  // [Main Wing (left ~60%)] | [Monumental Entrance Atrium Tower (~23%)] | [Full-Height Glass Wing (right ~17%)]
  const xMin = -L / 2,
    xMax = L / 2,
    zMin = -D / 2,
    zMax = D / 2;
  const mainEnd = xMin + L * 0.6;
  const atriumEnd = xMin + L * 0.83;
  const mainW = mainEnd - xMin;
  const atriumW = atriumEnd - mainEnd;
  const wingW = xMax - atriumEnd;
  const atriumProj = Math.min(0.65, D * 0.06); // Entrance tower projects slightly forward for bold architectural depth.
  const frontRecess = Math.min(0.55, D * 0.05);
  const sideRecess = Math.min(0.45, L * 0.03);

  // 1. Ground concrete plinth platform (y = 0..0.28).
  addBox(body, "PHTC base plinth", 0, 0.14, 0, L + 0.2, 0.28, D + 0.2, copingMat);
  // Bright warm-cream sunlit interior core backing behind the translucent glass,
  // split so Floor 3 recessed balcony glazing is never buried, plus subtle interior floor/ceiling bands.
  const coreLowerW = Math.max(1, L - 0.5);
  const coreLowerD = Math.max(1, D - 0.5);
  if (floors >= 2) {
    const lowerH = (floors - 1) * STOREY - 0.14;
    addBox(body, "PHTC inner core lower", 0, 0.28 + lowerH / 2, 0, coreLowerW, lowerH, coreLowerD, interiorWallMat);
    for (let f = 0; f < floors - 1; f++) {
      // Subtle interior ceiling/floor band depth visible through translucent glazing.
      addBox(
        body,
        "PHTC interior ceiling band",
        0,
        (f + 1) * STOREY - 0.18,
        0,
        coreLowerW + 0.04,
        0.24,
        coreLowerD + 0.04,
        interiorSlabMat,
      );
    }
    const topX0 = xMin + sideRecess + 0.14;
    const topX1 = xMax - 0.25;
    const topZ0 = zMin + 0.25;
    const topZ1 = zMax - frontRecess - 0.14;
    if (topX1 - topX0 > 0.5 && topZ1 - topZ0 > 0.5) {
      const topH = STOREY - 0.08;
      addBox(
        body,
        "PHTC inner core upper",
        (topX0 + topX1) / 2,
        (floors - 1) * STOREY + topH / 2,
        (topZ0 + topZ1) / 2,
        topX1 - topX0,
        topH,
        topZ1 - topZ0,
        interiorWallMat,
      );
      addBox(
        body,
        "PHTC interior ceiling band",
        (topX0 + topX1) / 2,
        floors * STOREY - 0.18,
        (topZ0 + topZ1) / 2,
        topX1 - topX0 + 0.04,
        0.22,
        topZ1 - topZ0 + 0.04,
        interiorSlabMat,
      );
    }
  } else {
    addBox(body, "PHTC inner core", 0, H / 2 + 0.14, 0, coreLowerW, H - 0.2, coreLowerD, interiorWallMat);
    addBox(body, "PHTC interior ceiling band", 0, H - 0.16, 0, coreLowerW + 0.04, 0.22, coreLowerD + 0.04, interiorSlabMat);
  }

  // Helper: bright sky-tinted glass curtain-wall bay with sleek slate aluminum mullions & transoms.
  const addCurtainWallX = (
    name: string,
    ax: number,
    bx: number,
    yBot: number,
    yTop: number,
    zFace: number,
    outDir: 1 | -1,
    mullionStep = 1.15,
  ) => {
    const w = bx - ax,
      h = yTop - yBot;
    if (w < 0.25 || h < 0.3) return;
    const cx = (ax + bx) / 2,
      cy = (yBot + yTop) / 2;
    addBox(body, name, cx, cy, zFace - outDir * 0.035, w, h, 0.06, glazingMat, true);
    // Slim horizontal top, bottom, and mid transoms.
    const transoms = h > 2.2 ? [yBot + 0.03, yBot + h * 0.34, yBot + h * 0.72, yTop - 0.03] : [yBot + 0.03, cy, yTop - 0.03];
    for (const ty of transoms) {
      addBox(body, "PHTC transom", cx, ty, zFace + outDir * 0.01, w + 0.02, 0.045, 0.055, mullionMat);
    }
    const cols = Math.max(1, Math.round(w / mullionStep));
    for (let i = 0; i <= cols; i++) {
      const mx = ax + (i / cols) * w;
      addBox(body, "PHTC mullion", mx, cy, zFace + outDir * 0.01, 0.045, h, 0.055, mullionMat);
    }
  };

  const addCurtainWallZ = (
    name: string,
    az: number,
    bz: number,
    yBot: number,
    yTop: number,
    xFace: number,
    outDir: 1 | -1,
    mullionStep = 1.15,
  ) => {
    const d = bz - az,
      h = yTop - yBot;
    if (d < 0.25 || h < 0.3) return;
    const cz = (az + bz) / 2,
      cy = (yBot + yTop) / 2;
    addBox(body, name, xFace - outDir * 0.035, cy, cz, 0.06, h, d, glazingMat, true);
    const transoms = h > 2.2 ? [yBot + 0.03, yBot + h * 0.34, yBot + h * 0.72, yTop - 0.03] : [yBot + 0.03, cy, yTop - 0.03];
    for (const ty of transoms) {
      addBox(body, "PHTC transom", xFace + outDir * 0.01, ty, cz, 0.055, 0.045, d + 0.02, mullionMat);
    }
    const cols = Math.max(1, Math.round(d / mullionStep));
    for (let i = 0; i <= cols; i++) {
      const mz = az + (i / cols) * d;
      addBox(body, "PHTC mullion", xFace + outDir * 0.01, cy, mz, 0.055, h, 0.045, mullionMat);
    }
  };

  // =========================================================================
  // 2. MAIN WING (LEFT ~60% — xMin .. mainEnd): 3 distinct architectural tiers
  // =========================================================================
  const mainCx = (xMin + mainEnd) / 2;

  // Horizontal cantilevered white floor-slab bands between every storey (Photo 5).
  // Top roof structural slab stops at H + 0.24 so the roof deck inside the parapet stays hollow.
  for (let f = 1; f < floors; f++) {
    addBox(
      body,
      "PHTC floor slab band",
      mainCx - 0.08,
      f * STOREY + 0.14,
      0,
      mainW + 0.42,
      0.38,
      D + 0.44,
      slabMat,
    );
  }
  addBox(
    body,
    "PHTC main roof slab",
    mainCx - 0.145,
    H + 0.1,
    0,
    mainW + 0.29,
    0.28,
    D + 0.44,
    whiteMat,
  );

  // Per-floor facade detailing on Main Wing (front +z, left -x, back -z).
  const bayCount = Math.max(2, Math.round((mainW - 1.2) / 3.2));
  const bayW = (mainW - 1.2) / bayCount;

  for (let f = 0; f < floors; f++) {
    const y0 = f * STOREY + 0.28;
    const y1 = (f + 1) * STOREY - 0.04;
    const fh = y1 - y0;
    const fcy = (y0 + y1) / 2;
    const isTopRecessed = floors >= 2 && f === floors - 1;

    if (f === 0) {
      // Ground floor: crisp white columns + tall reflective lobby/clinic windows + corner travertine plinth.
      addCurtainWallX("PHTC window glazing", xMin + 0.9, mainEnd - 0.25, y0 + 0.06, y1 - 0.04, zMax - 0.08, 1, 1.05);
      for (let i = 0; i <= bayCount; i++) {
        const px = xMin + 0.95 + i * bayW;
        if (px > mainEnd - 0.2) continue;
        addBox(body, "PHTC ground pier", px, fcy, zMax + 0.06, 0.34, fh + 0.06, 0.34, whiteMat);
      }
      // Left-corner ground cladding (travertine accent plinth).
      addBox(body, "PHTC corner travertine", xMin + 0.45, fcy, zMax - 0.18, 0.96, fh + 0.08, 0.56, travertineMat);
    } else if (!isTopRecessed) {
      // Middle floor (Floor 2): continuous dark-tinted curtain wall wrapping around the front-left corner!
      addCurtainWallX("PHTC window glazing", xMin + 0.95, mainEnd - 0.1, y0, y1, zMax + 0.04, 1, 0.95);
    } else {
      // Top floor (Floor 3): signature recessed balcony glazing + dark perforated batik/kerawang balustrade screens!
      addCurtainWallX("PHTC window glazing", xMin + 0.95, mainEnd - 0.18, y0, y1, zMax - frontRecess, 1, 1.05);
      // White structural balcony piers + dark perforated kerawang privacy balustrade panels.
      for (let i = 0; i <= bayCount; i++) {
        const px = xMin + 0.95 + i * bayW;
        if (px <= mainEnd - 0.15) {
          addBox(body, "PHTC balcony pier", px, fcy, zMax + 0.04, 0.32, fh + 0.06, 0.28, whiteMat);
        }
        if (i < bayCount) {
          const bx0 = px + 0.18;
          const bx1 = Math.min(mainEnd - 0.22, px + bayW - 0.18);
          if (bx1 - bx0 > 0.4) {
            const panelH = Math.min(1.42, fh * 0.46);
            addBox(
              body,
              "PHTC perforated screen",
              (bx0 + bx1) / 2,
              y0 + panelH / 2 + 0.05,
              zMax + 0.07,
              bx1 - bx0,
              panelH,
              0.08,
              screenMatH,
            );
            // Slim charcoal top handrail on the perforated balustrade.
            addBox(body, "PHTC balcony rail", (bx0 + bx1) / 2, y0 + panelH + 0.08, zMax + 0.07, bx1 - bx0 + 0.04, 0.06, 0.1, mullionMat);
          }
        }
      }
    }

    // Left end facade (-x): wrap the exact same 3-tier rhythm!
    const sideStart = zMin + 0.7;
    const sideEnd = zMax - 0.7;
    if (isTopRecessed) {
      addCurtainWallZ("PHTC window glazing", sideStart, sideEnd, y0, y1, xMin + sideRecess, -1, 1.05);
      const panelH = Math.min(1.42, fh * 0.46);
      addBox(body, "PHTC perforated screen", xMin - 0.06, y0 + panelH / 2 + 0.05, (sideStart + sideEnd) / 2, 0.08, panelH, sideEnd - sideStart - 0.3, screenMatH);
    } else {
      addCurtainWallZ("PHTC window glazing", sideStart, sideEnd, y0 + (f === 0 ? 0.06 : 0), y1, xMin - 0.02, -1, 1.05);
    }

    // Back facade (-z) on Main Wing: clean ribbon windows + pilasters so building looks finished 360°.
    addCurtainWallX("PHTC window glazing", xMin + 0.9, mainEnd - 0.3, y0 + 0.2, y1 - 0.15, zMin - 0.02, -1, 1.25);
  }

  // Far-left vertical dark perforated kerawang accent tower (matching far-left edge of Photo 5!).
  addBox(body, "PHTC left vertical screen", xMin + 0.42, H / 2 + 0.22, zMax + 0.08, 0.82, H - 0.12, 0.14, screenMatV);
  addBox(body, "PHTC left corner pilaster", xMin - 0.04, H / 2 + 0.22, zMax + 0.04, 0.26, H + 0.12, 0.34, whiteMat);

  // =========================================================================
  // 3. BOLD RED "RSUD MAMUJU TENGAH" SIGN ON UPPER FRONT FASCIA (Photo 5)
  // =========================================================================
  const signTex = phtcSignTexture();
  const signW = Math.min(mainW * 0.76, Math.max(4.6, mainW * 0.68));
  const signH = 0.76;
  const signX = mainEnd - signW / 2 - 0.35;
  const signY = H + 0.44;
  const signMat = new THREE.MeshStandardMaterial({
    color: signTex ? "#ffffff" : "#c41e22",
    map: signTex,
    roughness: 0.42,
    metalness: 0.06,
  });
  // Slight raised fascia backing plaque + crisp front sign face.
  addBox(body, "PHTC sign plaque", signX, signY, zMax + 0.23, signW + 0.12, signH + 0.06, 0.05, whiteMat);
  const signPlane = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), signMat);
  signPlane.name = "PHTC RSUD sign";
  signPlane.position.set(signX, signY, zMax + 0.265);
  signPlane.userData.noCastShadow = true;
  body.add(signPlane);

  // =========================================================================
  // 4. MONUMENTAL ENTRANCE ATRIUM TOWER (mainEnd .. atriumEnd, front +z & back -z)
  // =========================================================================
  const atrCx = (mainEnd + atriumEnd) / 2;
  const atrZ = zMax + atriumProj;
  const atrBackZ = zMin - atriumProj;
  const atrTopY = H + 1.15; // Rises boldly above the main wing parapet like Photo 5!

  // Ground-floor atrium backing recessed symmetrically behind both front (atrZ - 0.56)
  // and back (atrBackZ + 0.56) grand lobby entrance doors so neither glazing is buried.
  const atrGroundFrontZ = atrZ - 0.56;
  const atrGroundBackZ = atrBackZ + 0.56;
  const atrGroundD = Math.max(0.8, atrGroundFrontZ - atrGroundBackZ);
  addBox(
    body,
    "PHTC atrium ground core",
    atrCx,
    0.28 + (STOREY - 0.28) / 2,
    (atrGroundBackZ + atrGroundFrontZ) / 2,
    atriumW + 0.08,
    STOREY - 0.28,
    atrGroundD,
    whiteMat,
  );
  // Upper atrium white concrete tower mass projecting symmetrically to atrZ (+z) and atrBackZ (-z).
  const atrUpperD = atrZ - atrBackZ;
  const atrUpperH = atrTopY - STOREY;
  addBox(
    body,
    "PHTC atrium tower",
    atrCx,
    STOREY + atrUpperH / 2,
    (atrBackZ + atrZ) / 2,
    atriumW + 0.12,
    atrUpperH,
    atrUpperD,
    whiteMat,
  );
  // Crisp coping cap crowning the symmetrically extended atrium tower.
  addBox(body, "PHTC atrium coping", atrCx, atrTopY + 0.04, (atrBackZ + atrZ) / 2, atriumW + 0.24, 0.08, atrUpperD + 0.14, copingMat);

  // Mirror ground-floor travertine entrance piers, recessed double-glass lobby doors,
  // vertical white projecting fins, narrow slot windows, and perforated screen bay on both +z and -z.
  const lobbyW = Math.max(1.8, atriumW * 0.46);
  const sidePierW = Math.max(0.65, (atriumW - lobbyW) / 2);
  const stoneH = STOREY + 0.22;
  const finPositions = [
    mainEnd + 0.16,
    atrCx - lobbyW / 2 - 0.14,
    atrCx + lobbyW / 2 + 0.14,
    atriumEnd - 0.16,
  ];
  const towerScreenY0 = STOREY + 0.35;
  const towerScreenY1 = atrTopY - 0.55;

  for (const dir of [1, -1] as const) {
    const faceZ = dir === 1 ? atrZ : atrBackZ;

    // Ground-floor warm travertine/beige stone base piers flanking the recessed grand lobby entrance.
    for (const side of [-1, 1]) {
      const px = atrCx + side * (lobbyW / 2 + sidePierW / 2);
      addBox(body, "PHTC travertine pier", px, stoneH / 2 + 0.14, faceZ - dir * 0.28, sidePierW + 0.14, stoneH, 0.9, travertineMat);
    }
    // Recessed grand double-glass entrance doors under the atrium (visible in front of ground core).
    addCurtainWallX("PHTC window glazing", atrCx - lobbyW / 2 + 0.08, atrCx + lobbyW / 2 - 0.08, 0.28, STOREY - 0.05, faceZ - dir * 0.42, dir, 0.9);
    addBox(body, "PHTC lobby lintel", atrCx, STOREY + 0.1, faceZ - dir * 0.1, lobbyW + 0.3, 0.32, 0.72, whiteMat);

    // Bold vertical white projecting architectural fins/pilasters rising full height (Photo 5!).
    for (const fx of finPositions) {
      // Upper projecting fin (starts above travertine base on outer piers, full height on main frame).
      addBox(body, "PHTC vertical fin", fx, (atrTopY + stoneH * 0.82) / 2, faceZ + dir * 0.24, 0.36, atrTopY - stoneH * 0.82 + 0.2, 0.62, whiteMat);
      // Ground-floor travertine continuation at the base of each fin.
      addBox(body, "PHTC fin stone base", fx, stoneH / 2 + 0.14, faceZ + dir * 0.16, 0.42, stoneH, 0.48, travertineMat);
    }

    // Tall vertical narrow slot windows on the left & right atrium piers (Photo 5).
    if (sidePierW > 0.85) {
      for (const side of [-1, 1]) {
        const sx = atrCx + side * (lobbyW / 2 + sidePierW * 0.52);
        addCurtainWallX("PHTC window glazing", sx - 0.24, sx + 0.24, stoneH + 0.2, atrTopY - 0.75, faceZ + dir * 0.05, dir, 0.55);
      }
    }

    // Full-height dark perforated batik/kerawang accent screen bay right in the center of the entrance tower.
    if (towerScreenY1 > towerScreenY0 + 0.6) {
      addBox(
        body,
        "PHTC atrium perforated screen",
        atrCx,
        (towerScreenY0 + towerScreenY1) / 2,
        faceZ + dir * 0.08,
        Math.max(0.8, lobbyW - 0.24),
        towerScreenY1 - towerScreenY0,
        0.14,
        screenMatV,
      );
    }
  }

  // =========================================================================
  // 5. CANTILEVERED GLASS-AND-STEEL PORTE-COCHÈRE CANOPIES (front +z & back -z)
  // =========================================================================
  // Constrain canopy left edge >= mainEnd so it covers only the atrium + east wing
  // and stays clear of walkways connecting to the main wing facade.
  const canopyLeft = mainEnd + 0.08;
  const canopyRight = Math.min(xMax - 0.12, atriumEnd + wingW * 0.85);
  const canopyW = Math.max(2.0, canopyRight - canopyLeft);
  const canopyX = (canopyLeft + canopyRight) / 2;
  const canopyProj = Math.min(2.2, Math.max(1.5, D * 0.18));
  const canopyY = STOREY + 0.08;
  const ribCount = Math.max(3, Math.round(canopyW / 1.8));
  const wingZMax = zMax - 0.12;
  const wingZMin = zMin + 0.12;

  for (const dir of [1, -1] as const) {
    const faceZ = dir === 1 ? atrZ : atrBackZ;
    const wingEdgeZ = dir === 1 ? wingZMax : wingZMin;
    const canopyInnerZ = dir === 1 ? zMax - 0.14 : zMin + 0.14;
    const canopyOuterZ = faceZ + dir * canopyProj;
    const canopyDepth = Math.abs(canopyOuterZ - canopyInnerZ);
    const canopyZ = (canopyInnerZ + canopyOuterZ) / 2;

    // Translucent blue-tinted canopy deck + perimeter dark steel framing & purlins.
    addBox(body, "PHTC entrance canopy panel", canopyX, canopyY, canopyZ, canopyW - 0.12, 0.06, canopyDepth - 0.12, canopyPanelMat, true);
    // Outer & inner steel fascia beams.
    addBox(body, "PHTC canopy beam", canopyX, canopyY, canopyOuterZ, canopyW, 0.12, 0.1, steelMat);
    addBox(body, "PHTC canopy beam", canopyX, canopyY, canopyInnerZ + dir * 0.05, canopyW, 0.12, 0.1, steelMat);
    // Transverse steel cantilever ribs + diagonal tension tie-rods anchored cleanly to facade.
    for (let i = 0; i <= ribCount; i++) {
      const rx = canopyLeft + (i / ribCount) * canopyW;
      addBox(body, "PHTC canopy rib", rx, canopyY - 0.02, canopyZ, 0.07, 0.12, canopyDepth, steelMat);
      const anchorZ = rx <= atriumEnd ? faceZ : wingEdgeZ;
      const spanZ = Math.max(0.6, Math.abs(canopyOuterZ - anchorZ) * 0.78);
      const rodLen = Math.hypot(spanZ, 1.35);
      const rod = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, rodLen), steelMat);
      rod.name = "PHTC canopy tension rod";
      rod.position.set(rx, canopyY + 0.68, anchorZ + dir * (spanZ / 2));
      rod.rotation.x = dir * Math.atan2(1.35, spanZ);
      rod.userData.noCastShadow = true;
      body.add(rod);
    }
  }

  // =========================================================================
  // 6. RIGHT FULL-HEIGHT LUMINOUS CURTAIN-WALL WING (atriumEnd .. xMax, Photo 5!)
  // =========================================================================
  if (wingW > 0.9) {
    const wingCx = (atriumEnd + xMax) / 2;
    // Roof structural slab & travertine base plinth (named without "glass" to avoid night-glow false positives).
    addBox(body, "PHTC east wing roof slab", wingCx, H + 0.15, 0, wingW + 0.04, 0.18, D - 0.2, whiteMat);
    addBox(body, "PHTC east wing base", wingCx, 0.32, 0, wingW + 0.08, 0.38, D - 0.2, travertineMat);
    // Crisp light interior floor slabs recessed cleanly behind the translucent sky-blue curtain wall.
    const ewSlabW = Math.max(0.4, wingW - 0.16);
    const ewSlabD = Math.max(0.4, wingZMax - wingZMin - 0.16);
    const ewSlabCz = (wingZMin + wingZMax) / 2;
    for (let f = 1; f < floors; f++) {
      addBox(body, "PHTC wing floor slab", wingCx - 0.03, f * STOREY + 0.14, ewSlabCz, ewSlabW, 0.28, ewSlabD, interiorSlabMat);
    }
    // Full-height luminous sky-blue curtain wall wrapping front (+z), right (+x), and rear (-z)!
    addCurtainWallX("PHTC window glazing", atriumEnd + 0.06, xMax - 0.08, 0.48, H + 0.08, wingZMax, 1, 0.85);
    addCurtainWallZ("PHTC window glazing", wingZMin + 0.05, wingZMax - 0.05, 0.48, H + 0.08, xMax + 0.02, 1, 0.95);
    addCurtainWallX("PHTC window glazing", atriumEnd + 0.06, xMax - 0.08, 0.48, H + 0.08, wingZMin, -1, 0.85);
  }

  // =========================================================================
  // 7. HOLLOW ROOFTOP PARAPETS, MEMBRANE, STAIR/LIFT PENTHOUSE & HVAC CHILLERS
  // =========================================================================
  const slabTopY = H + 0.24;
  const deckTopY = H + 0.3;
  const paraTop = H + 0.88;
  const paraH = paraTop - slabTopY;
  const paraCy = slabTopY + paraH / 2;

  // Main wing hollow perimeter parapet walls (flush with overhanging roof slab, stopping cleanly at mainEnd).
  const mainLeftEdge = xMin - 0.29;
  const mainFrontEdge = zMax + 0.22;
  const mainBackEdge = zMin - 0.22;
  const mainSpanX = mainEnd - mainLeftEdge;
  const mainSpanZ = mainFrontEdge - mainBackEdge;
  const mainMidX = (mainLeftEdge + mainEnd) / 2;

  // Front fascia parapet (carries the bold red RSUD MAMUJU TENGAH sign), back & left parapets.
  addBox(body, "PHTC main parapet front", mainMidX, paraCy, mainFrontEdge - 0.14, mainSpanX, paraH, 0.28, whiteMat);
  addBox(body, "PHTC main parapet back", mainMidX, paraCy, mainBackEdge + 0.14, mainSpanX, paraH, 0.28, whiteMat);
  addBox(body, "PHTC main parapet left", mainLeftEdge + 0.14, paraCy, 0, 0.28, paraH, mainSpanZ - 0.56, whiteMat);
  // Crisp coping cap seated flush on main wing parapet walls (never slices atrium tower or overlaps corners).
  addBox(body, "PHTC roof coping", mainMidX, paraTop + 0.04, mainFrontEdge - 0.14, mainSpanX + 0.08, 0.08, 0.36, copingMat);
  addBox(body, "PHTC roof coping", mainMidX, paraTop + 0.04, mainBackEdge + 0.14, mainSpanX + 0.08, 0.08, 0.36, copingMat);
  addBox(body, "PHTC roof coping", mainLeftEdge + 0.14, paraTop + 0.04, 0, 0.36, 0.08, mainSpanZ - 0.64, copingMat);

  // Main wing recessed dark waterproof roof membrane (sits cleanly on top of roof slab).
  const memMainW = Math.max(0.6, mainSpanX - 0.34);
  const memMainD = Math.max(0.6, mainSpanZ - 0.62);
  addBox(body, "PHTC roof membrane", (mainLeftEdge + 0.3 + mainEnd - 0.04) / 2, slabTopY + 0.03, 0, memMainW, 0.06, memMainD, roofMembraneMat);

  // East wing hollow perimeter parapet walls + flush coping cap + roof membrane (aligned to paraTop = H + 0.88).
  if (wingW > 0.9) {
    const ewCx = (atriumEnd + xMax) / 2;
    const ewFrontZ = wingZMax - 0.08;
    const ewBackZ = wingZMin + 0.08;
    const ewSpanZ = ewFrontZ - ewBackZ;
    addBox(body, "PHTC east wing parapet", ewCx, paraCy, ewFrontZ, wingW, paraH, 0.24, whiteMat);
    addBox(body, "PHTC east wing parapet", ewCx, paraCy, ewBackZ, wingW, paraH, 0.24, whiteMat);
    addBox(body, "PHTC east wing parapet", xMax - 0.12, paraCy, (ewFrontZ + ewBackZ) / 2, 0.24, paraH, Math.max(0.4, ewSpanZ - 0.24), whiteMat);
    addBox(body, "PHTC east wing coping", ewCx, paraTop + 0.04, ewFrontZ, wingW + 0.08, 0.08, 0.32, copingMat);
    addBox(body, "PHTC east wing coping", ewCx, paraTop + 0.04, ewBackZ, wingW + 0.08, 0.08, 0.32, copingMat);
    addBox(body, "PHTC east wing coping", xMax - 0.12, paraTop + 0.04, (ewFrontZ + ewBackZ) / 2, 0.32, 0.08, Math.max(0.4, ewSpanZ - 0.32), copingMat);
    addBox(
      body,
      "PHTC east roof membrane",
      (atriumEnd + 0.04 + xMax - 0.26) / 2,
      slabTopY + 0.03,
      (ewFrontZ + ewBackZ) / 2,
      Math.max(0.4, wingW - 0.3),
      0.06,
      Math.max(0.4, ewSpanZ - 0.3),
      roofMembraneMat,
    );
  }

  // Stair & elevator core bulkhead penthouse + HVAC chiller bank seated cleanly on deckTopY (inside main wing roof).
  if (L >= 8 && D >= 6) {
    const pentW = Math.min(3.6, mainW * 0.26);
    const pentD = Math.min(3.0, memMainD * 0.36);
    const pentH = 2.05;
    const pentX = mainEnd - pentW / 2 - 0.45;
    const pentZ = -D * 0.08;
    addBox(body, "PHTC rooftop penthouse", pentX, deckTopY + pentH / 2, pentZ, pentW, pentH, pentD, whiteMat);
    addBox(body, "PHTC penthouse cap", pentX, deckTopY + pentH + 0.08, pentZ, pentW + 0.26, 0.16, pentD + 0.26, copingMat);
    addBox(body, "PHTC penthouse louver", pentX, deckTopY + pentH * 0.56, pentZ + pentD / 2 + 0.02, pentW * 0.45, 0.7, 0.05, mullionMat);

    // Rooftop HVAC chiller bank with perforated mechanical screen enclosure, clear of penthouse & parapet.
    const mechMaxRight = pentX - pentW / 2 - 0.65;
    const mechMinLeft = mainLeftEdge + 0.85;
    const availW = mechMaxRight - mechMinLeft;
    if (availW >= 2.2) {
      const mechW = Math.min(4.8, availW * 0.82);
      const mechX = (mechMinLeft + mechMaxRight) / 2;
      const mechD = Math.min(2.4, memMainD * 0.32);
      const mechZ = -D * 0.06;
      addBox(body, "PHTC mechanical screen", mechX, deckTopY + 0.58, mechZ + mechD / 2, mechW, 1.15, 0.08, steelMat);
      addBox(body, "PHTC mechanical screen", mechX, deckTopY + 0.58, mechZ - mechD / 2, mechW, 1.15, 0.08, steelMat);
      const chillers = mechW >= 3.6 ? 3 : 2;
      for (let i = 0; i < chillers; i++) {
        const cx = mechX - mechW * 0.31 + (i / Math.max(1, chillers - 1)) * (mechW * 0.62);
        addBox(body, "PHTC HVAC pad", cx, deckTopY + 0.05, mechZ, 1.24, 0.1, Math.min(1.66, mechD - 0.42), copingMat);
        addBox(body, "PHTC HVAC chiller", cx, deckTopY + 0.55, mechZ, 1.12, 0.9, Math.min(1.54, mechD - 0.54), mechMat);
        addBox(body, "PHTC HVAC fan", cx, deckTopY + 1.02, mechZ, 0.76, 0.05, 0.76, mullionMat, true);
      }
    }
  }

  return root;
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
 * Model for one piece: corridors, open-air features, pitched/flat roofs, and
 * the 3-storey PHTC building are built procedurally from the footprint with
 * crisp architectural proportions and shared materials for `batchMeshes`.
 * When `inside` is true, roofs and overhead corridor fixtures come off cleanly.
 */
export function pieceModel(
  p: Piece,
  template: THREE.Group | undefined,
  pieces: Piece[],
  inside: boolean,
) {
  const isPhtc = p.kind === "phtc";
  const isProceduralRoof = p.kind === "pitched" || p.kind === "flat";
  const building = isBuildingPiece(p);
  const generated = isOpenAir(p) || isCorridor(p) || isProceduralRoof || isPhtc;
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
            : isPhtc
              ? inside
                ? empty
                : phtcModel(p)
              : isProceduralRoof
                ? inside
                  ? empty
                  : p.kind === "pitched"
                    ? pitchedRoofModel(p)
                    : flatRoofModel(p)
                : template
                  ? fittedTemplate(p, template)
                  : empty;

  // Built here rather than cloned from templates, so the scene may free this geometry.
  if (generated) model.traverse((o) => (o.userData.generated = true));
  model.userData.pieceId = p.id;
  model.name = p.name;

  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = !o.userData.noCastShadow;
    o.receiveShadow = true;
    const color = generated ? undefined : tint(p, o.name);
    // Give every mesh its own material copy so `batchMeshes` can safely dispose duplicates.
    const copies = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
      const copy = m.clone();
      if (color && copy instanceof THREE.MeshStandardMaterial) copy.color.set(color);
      return copy;
    });
    o.material = Array.isArray(o.material) ? copies : copies[0];
  });

  // Looking inside, corridors lose their canopy, posts, handrails, signs, beams, and overhead fixtures.
  if (inside && isCorridor(p))
    removeMeshes(model, (o) => /roof|post|rail|fascia|light|sign|beam|ridge|truss|soffit|cap/i.test(o.name));

  let interior: THREE.Group | null = null;
  if (building) {
    if (!generated) {
      // Legacy template fallback: strip shell/doors replaced by buildingInterior.
      removeMeshes(
        model,
        (o) =>
          inside ||
          o.name.startsWith("Building_shell") ||
          o.name.startsWith("Building shell") ||
          /Entrance|Door_mullion|Door mullion|Foundation/.test(o.name),
      );
    }
    // Pitched and flat roofs are built at 1-storey height and elevated to the top floor;
    // PHTC builds all storeys from y = 0 directly.
    if (!isPhtc) model.position.y += ((p.floors ?? 1) - 1) * STOREY;
    interior = buildingInterior(p, pieces, inside);
  }
  return { model, interior };
}
