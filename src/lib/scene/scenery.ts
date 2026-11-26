import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Piece } from "../model/layout.ts";

// Calm tropical hospital grounds around the campus so the buildings stand out
// like an architectural map: a soft meadow lawn, layered tropical shade trees,
// slender coastal palms, and subtle flowering courtyard shrubs.

/** The lawn, also the colour the map clears to, so it runs off every edge. */
export const LAWN = "#dbe4cc";
const GREENS = ["#7fa36a", "#6d9660", "#8fb178", "#5f8a5a", "#9bbd7f", "#86a877"];
const PALM_GREENS = ["#5e8c54", "#6b995e", "#527e4b", "#78a464"];
const CONIFERS = ["#4f7a5a", "#5c8766", "#46705a"];
/** Subtle warm tropical courtyard shrub accents (croton / bougainvillea, Photo 3). */
const SHRUB_ACCENTS = ["#c99652", "#c8737e", "#c4aa54", "#82ab67", "#749e5f"];

/** Deterministic random numbers, so trees don't jump around between renders. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a low-poly radiating tropical palm crown as a single BufferGeometry. */
function createPalmCrownGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const frondCount = 7;
  for (let i = 0; i < frondCount; i++) {
    const angle = (i / frondCount) * Math.PI * 2;
    const frond = new THREE.ConeGeometry(0.42, 2.15, 4);
    frond.scale(1, 1, 0.22);
    // Shift base to origin, tilt outward and droop slightly like a real tropical palm frond.
    frond.translate(0, 1.05, 0);
    frond.rotateX(1.18 + (i % 2) * 0.14);
    frond.rotateY(angle);
    frond.translate(0, 3.25, 0);
    parts.push(frond);
  }
  // Small central coconut/crown tuft (indexed SphereGeometry to match ConeGeometry fronds).
  const tuft = new THREE.SphereGeometry(0.32, 6, 4).translate(0, 3.22, 0);
  parts.push(tuft);
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged ?? new THREE.IcosahedronGeometry(1.1, 0).translate(0, 3.3, 0);
}

/** Build a gently curved tropical palm trunk geometry. */
function createPalmTrunkGeometry(): THREE.BufferGeometry {
  const lower = new THREE.CylinderGeometry(0.14, 0.21, 1.7, 6).translate(0, 0.85, 0);
  const upper = new THREE.CylinderGeometry(0.1, 0.14, 1.75, 6);
  upper.rotateZ(-0.07);
  upper.translate(0.06, 2.48, 0);
  const merged = mergeGeometries([lower, upper], false);
  lower.dispose();
  upper.dispose();
  return merged ?? new THREE.CylinderGeometry(0.1, 0.2, 3.3, 6).translate(0, 1.65, 0);
}

/** Build a lush two-tier tropical shade tree canopy geometry. */
function createTropicalCrownGeometry(): THREE.BufferGeometry {
  const main = new THREE.IcosahedronGeometry(1.05, 1);
  main.scale(1.12, 0.84, 1.12);
  main.translate(0, 2.25, 0);
  const top = new THREE.IcosahedronGeometry(0.72, 1);
  top.scale(1.05, 0.8, 1.05);
  top.translate(0.18, 2.95, -0.1);
  const merged = mergeGeometries([main, top], false);
  main.dispose();
  top.dispose();
  return merged ?? new THREE.IcosahedronGeometry(1, 1).translate(0, 2.3, 0);
}

export function createScenery(scene: THREE.Scene) {
  const root = new THREE.Group();
  root.name = "Scenery";
  scene.add(root);

  const meadow = new THREE.Mesh(
    new THREE.CircleGeometry(1400, 48),
    new THREE.MeshLambertMaterial({ color: LAWN }),
  );
  meadow.rotation.x = -Math.PI / 2;
  meadow.position.y = -0.08;
  meadow.receiveShadow = true;
  root.add(meadow);

  // Instanced parts shared by every tree & palm: fast to draw even with hundreds.
  const MAX = 700;
  const flat = (color: string) =>
    new THREE.MeshLambertMaterial({ color, flatShading: true });
  const trunkGeo = new THREE.CylinderGeometry(0.13, 0.22, 1.5, 6).translate(0, 0.75, 0);
  const crownGeo = createTropicalCrownGeometry();
  const coneGeo = new THREE.ConeGeometry(0.95, 2.8, 7).translate(0, 2.6, 0);
  const palmTrunkGeo = createPalmTrunkGeometry();
  const palmCrownGeo = createPalmCrownGeometry();
  const bushGeo = new THREE.IcosahedronGeometry(0.68, 0).translate(0, 0.38, 0);

  const make = (geo: THREE.BufferGeometry, color: string) => {
    const mesh = new THREE.InstancedMesh(geo, flat(color), MAX);
    // Shadows are drawn once per rebuild (see HospitalScene), so foliage casts them cheaply.
    mesh.castShadow = true;
    mesh.count = 0;
    root.add(mesh);
    return mesh;
  };
  const trunks = make(trunkGeo, "#876d55");
  const crowns = make(crownGeo, "#ffffff");
  const cones = make(coneGeo, "#ffffff");
  const palmTrunks = make(palmTrunkGeo, "#8f7a62");
  const palmCrowns = make(palmCrownGeo, "#ffffff");
  const bushes = make(bushGeo, "#ffffff");

  let signature = "";
  /** Rebuild the trees for a canvas of W × D metres. */
  function update(
    pieces: Piece[],
    W: number,
    D: number,
    /** Tree and foliage amount: 0 none, 1 normal, 2 lush. */
    amount: number,
  ) {
    const next = JSON.stringify([W, D, amount, pieces.map((p) => [p.x, p.y, p.w, p.h])]);
    if (next === signature) return false;
    signature = next;
    const extent = Math.max(W, D);
    meadow.position.set(W / 2, meadow.position.y, D / 2);
    // A thin belt of tropical trees & palms just past the canvas edge.
    const reach = Math.max(24, extent * 0.3);

    const rand = random(W * 131 + D * 17);
    const blocked = pieces.map((p) => ({
      x0: p.x * 2 - 2.5,
      z0: p.y * 2 - 2.5,
      x1: (p.x + p.w) * 2 + 2.5,
      z1: (p.y + p.h) * 2 + 2.5,
    }));
    // kind: 0 = layered tropical tree, 1 = conifer/cypress, 2 = courtyard shrub, 3 = coastal palm
    const spots: { x: number; z: number; kind: number }[] = [];
    const free = (x: number, z: number) =>
      !blocked.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);

    // Trees & palms around the campus perimeter.
    const step = Math.max(7, Math.sqrt(((W + 2 * reach) * (D + 2 * reach) * 0.5) / (MAX * 0.8)));
    const outside: typeof spots = [];
    for (let x = -reach; x < W + reach; x += step)
      for (let z = -reach; z < D + reach; z += step) {
        const px = x + (rand() - 0.5) * step * 0.7,
          pz = z + (rand() - 0.5) * step * 0.7;
        const out = Math.max(-px, px - W, -pz, pz - D);
        if (out < 0) continue;
        const density = 0.12 + 0.3 * Math.min(1, out / reach);
        if (rand() > density * amount) continue;
        if (free(px, pz)) {
          const r = rand();
          outside.push({ x: px, z: pz, kind: r < 0.24 ? 3 : r < 0.44 ? 1 : 0 });
        }
      }

    // Courtyard lawns inside the campus get palms, shade trees, and subtle tropical flowering shrubs (Photo 3).
    if (amount > 0)
      for (let x = 1; x < W; x += 5.5)
        for (let z = 1; z < D; z += 5.5) {
          const px = x + (rand() - 0.5) * 3,
            pz = z + (rand() - 0.5) * 3;
          if (px > 0 && px < W && pz > 0 && pz < D && rand() < 0.2 * amount && free(px, pz)) {
            const r = rand();
            spots.push({ x: px, z: pz, kind: r < 0.48 ? 2 : r < 0.7 ? 3 : 0 });
          }
        }

    for (let i = outside.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [outside[i], outside[j]] = [outside[j], outside[i]];
    }
    spots.push(...outside);

    const m = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      s = new THREE.Vector3(),
      p = new THREE.Vector3(),
      up = new THREE.Vector3(0, 1, 0),
      color = new THREE.Color();
    let t = 0,
      c = 0,
      k = 0,
      pt = 0,
      pc = 0,
      b = 0;

    for (const spot of spots.slice(0, MAX)) {
      const size = 0.82 + rand() * 0.65;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      p.set(spot.x, 0, spot.z);

      if (spot.kind === 2) {
        // Courtyard shrub: mix lush greens with occasional subtle croton/flowering accents.
        s.set(size * 1.05, size * 0.85, size * 1.05);
        bushes.setMatrixAt(b, m.compose(p, q, s));
        const palette = rand() < 0.35 ? SHRUB_ACCENTS : GREENS;
        bushes.setColorAt(b++, color.set(palette[Math.floor(rand() * palette.length)]));
        continue;
      }

      if (spot.kind === 3) {
        // Tropical coastal palm tree.
        const palmScale = 0.78 + rand() * 0.52;
        s.set(palmScale, palmScale * (0.95 + rand() * 0.3), palmScale);
        m.compose(p, q, s);
        palmTrunks.setMatrixAt(pt++, m);
        palmCrowns.setMatrixAt(pc, m);
        palmCrowns.setColorAt(pc++, color.set(PALM_GREENS[Math.floor(rand() * PALM_GREENS.length)]));
        continue;
      }

      s.set(size, size * (0.9 + rand() * 0.35), size);
      trunks.setMatrixAt(t++, m.compose(p, q, s));
      if (spot.kind === 1) {
        cones.setMatrixAt(k, m);
        cones.setColorAt(k++, color.set(CONIFERS[Math.floor(rand() * CONIFERS.length)]));
      } else {
        s.set(size * 1.18, size * 1.08, size * 1.18);
        crowns.setMatrixAt(c, m.compose(p, q, s));
        crowns.setColorAt(c++, color.set(GREENS[Math.floor(rand() * GREENS.length)]));
      }
    }

    for (const [mesh, n] of [
      [trunks, t],
      [crowns, c],
      [cones, k],
      [palmTrunks, pt],
      [palmCrowns, pc],
      [bushes, b],
    ] as const) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    return true;
  }

  function dispose() {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    scene.remove(root);
  }

  return {
    update,
    dispose,
    /** The lawn's colour, as the light of the hour tints it. */
    setLawn(color: string) {
      (meadow.material as THREE.MeshLambertMaterial).color.set(color);
    },
  };
}
