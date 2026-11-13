import * as THREE from "three";
import type { Piece } from "../model/layout.ts";

// Quiet grounds around the campus, so the buildings stand out like on a map:
// a pale, flat lawn running to the edge of the view, and a few low-poly trees
// on it and around it. No sky: the map looks down too steeply to see one.

/** The lawn, also the colour the map clears to, so it runs off every edge. */
export const LAWN = "#dbe4cc";
const GREENS = ["#7fa36a", "#6d9660", "#8fb178", "#5f8a5a", "#9bbd7f", "#86a877"];
const CONIFERS = ["#4f7a5a", "#5c8766", "#46705a"];

/** Deterministic random numbers, so trees don't jump around between renders. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

  // Instanced parts shared by every tree: fast to draw even with hundreds.
  const MAX = 700;
  const flat = (color: string) =>
    new THREE.MeshLambertMaterial({ color, flatShading: true });
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1.4, 6).translate(0, 0.7, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1).translate(0, 2.3, 0);
  const coneGeo = new THREE.ConeGeometry(1, 2.8, 7).translate(0, 2.6, 0);
  const bushGeo = new THREE.IcosahedronGeometry(0.7, 0).translate(0, 0.4, 0);
  const make = (geo: THREE.BufferGeometry, color: string) => {
    const mesh = new THREE.InstancedMesh(geo, flat(color), MAX);
    // Shadows are drawn once per rebuild (see HospitalScene), so trees can cast them cheaply.
    mesh.castShadow = true;
    mesh.count = 0;
    root.add(mesh);
    return mesh;
  };
  const trunks = make(trunkGeo, "#8a7058");
  const crowns = make(crownGeo, "#ffffff");
  const cones = make(coneGeo, "#ffffff");
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
    // A thin belt of trees just past the canvas edge; the map never looks farther.
    const reach = Math.max(24, extent * 0.3);

    // No frame around the campus: the meadow runs straight under it.
    const rand = random(W * 131 + D * 17);
    const blocked = pieces.map((p) => ({
      x0: p.x * 2 - 2.5,
      z0: p.y * 2 - 2.5,
      x1: (p.x + p.w) * 2 + 2.5,
      z1: (p.y + p.h) * 2 + 2.5,
    }));
    const spots: { x: number; z: number; kind: number }[] = [];
    const free = (x: number, z: number) =>
      !blocked.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
    // Trees around the campus, few by its edge.
    // Wider spacing on big canvases keeps the tree count within budget.
    const step = Math.max(7, Math.sqrt(((W + 2 * reach) * (D + 2 * reach) * 0.5) / (MAX * 0.8)));
    const outside: typeof spots = [];
    for (let x = -reach; x < W + reach; x += step)
      for (let z = -reach; z < D + reach; z += step) {
        const px = x + (rand() - 0.5) * step * 0.7,
          pz = z + (rand() - 0.5) * step * 0.7;
        const out = Math.max(-px, px - W, -pz, pz - D);
        if (out < 0) continue;
        // Open lawn by the campus easing into a light belt of trees.
        const density = 0.12 + 0.3 * Math.min(1, out / reach);
        if (rand() > density * amount) continue;
        if (free(px, pz)) outside.push({ x: px, z: pz, kind: rand() < 0.3 ? 1 : 0 });
      }
    // On the map, open lawns inside the campus get trees and shrubs too.
    if (amount > 0)
      for (let x = 1; x < W; x += 5.5)
        for (let z = 1; z < D; z += 5.5) {
          const px = x + (rand() - 0.5) * 3,
            pz = z + (rand() - 0.5) * 3;
          if (px > 0 && px < W && pz > 0 && pz < D && rand() < 0.18 * amount && free(px, pz))
            spots.push({ x: px, z: pz, kind: rand() < 0.45 ? 2 : 0 });
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
      b = 0;
    for (const spot of spots.slice(0, MAX)) {
      const size = 0.8 + rand() * 0.7;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      p.set(spot.x, 0, spot.z);
      if (spot.kind === 2) {
        s.setScalar(size);
        bushes.setMatrixAt(b, m.compose(p, q, s));
        bushes.setColorAt(b++, color.set(GREENS[Math.floor(rand() * GREENS.length)]));
        continue;
      }
      s.set(size, size * (0.9 + rand() * 0.4), size);
      trunks.setMatrixAt(t++, m.compose(p, q, s));
      if (spot.kind === 1) {
        cones.setMatrixAt(k, m);
        cones.setColorAt(k++, color.set(CONIFERS[Math.floor(rand() * CONIFERS.length)]));
      } else {
        s.set(size * 1.25, size * 1.1, size * 1.25);
        crowns.setMatrixAt(c, m.compose(p, q, s));
        crowns.setColorAt(c++, color.set(GREENS[Math.floor(rand() * GREENS.length)]));
      }
    }
    for (const [mesh, n] of [[trunks, t], [crowns, c], [cones, k], [bushes, b]] as const) {
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
