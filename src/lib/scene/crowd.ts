import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * People strolling between the buildings while nobody is using the map, so the
 * campus feels alive. One instanced mesh: every walker is drawn in one call,
 * and a frame only moves a few dozen matrices. Each walker follows a stroll
 * (a walking route in metres) from door to door, appearing at the first and
 * fading out at the last, then sets off on another.
 */

/** Clothes: hospital whites and scrubs, batik browns, everyday colours. */
const CLOTHES = ["#f4f2ec", "#7fb3c9", "#5f9a7a", "#c98a4b", "#8c5a3c", "#d9c27a", "#6a7fb0", "#b5585b", "#4f5d6a", "#e9e4d8"];

/** A point along a path with cumulative lengths, and the way it heads there. */
export function along(points: { x: number; z: number }[], lengths: number[], s: number) {
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < s) i++;
  const a = points[i - 1],
    b = points[i],
    span = lengths[i] - lengths[i - 1] || 1,
    t = Math.min(1, Math.max(0, (s - lengths[i - 1]) / span));
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: (b.x - a.x) / span, dz: (b.z - a.z) / span };
}

/** A little person: body and head, about 1.7 m tall, standing on the origin. */
function person() {
  const body = new THREE.CylinderGeometry(0.17, 0.23, 1.15, 7).translate(0, 0.6, 0),
    head = new THREE.SphereGeometry(0.16, 8, 6).translate(0, 1.4, 0);
  const merged = mergeGeometries([body.toNonIndexed(), head.toNonIndexed()])!;
  body.dispose();
  head.dispose();
  return merged;
}

type Stroll = { points: { x: number; z: number }[]; lengths: number[]; total: number };
type Walker = { stroll: number; s: number; speed: number; side: number; wait: number };

export function createCrowd(scene: THREE.Scene, count: number) {
  const geometry = person(),
    material = new THREE.MeshLambertMaterial({ color: "#ffffff" }),
    mesh = new THREE.InstancedMesh(geometry, material, count);
  // Drawn like everything else: buildings and corridor roofs hide whoever is
  // inside or under them, so people show on the paths and grounds between.
  mesh.frustumCulled = false;
  mesh.count = 0;
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) mesh.setColorAt(i, color.set(CLOTHES[i % CLOTHES.length]));
  scene.add(mesh);

  let strolls: Stroll[] = [],
    walkers: Walker[] = [],
    last = 0;
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    up = new THREE.Vector3(0, 1, 0),
    position = new THREE.Vector3(),
    size = new THREE.Vector3();

  const pick = (w: Walker, fresh = false) => {
    w.stroll = Math.floor(Math.random() * strolls.length);
    w.s = fresh ? Math.random() * strolls[w.stroll].total : 0;
    w.speed = 1 + Math.random() * 0.5;
    w.side = (Math.random() - 0.5) * 0.7;
    w.wait = fresh ? 0 : Math.random() * 3;
  };

  /** The strolls to walk, in metres; walkers spread along them at once. */
  function setStrolls(paths: { x: number; z: number }[][]) {
    strolls = paths
      .filter((p) => p.length > 1)
      .map((points) => {
        const lengths = [0];
        for (let i = 1; i < points.length; i++)
          lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
        return { points, lengths, total: lengths[lengths.length - 1] };
      })
      .filter((s) => s.total > 6);
    walkers = strolls.length
      ? Array.from({ length: count }, () => {
          const w = { stroll: 0, s: 0, speed: 1, side: 0, wait: 0 };
          pick(w, true);
          return w;
        })
      : [];
    mesh.count = walkers.length;
    place();
  }

  /** Put every walker where it is; true when anyone is drawn. */
  function place() {
    walkers.forEach((w, i) => {
      const s = strolls[w.stroll],
        p = along(s.points, s.lengths, w.s),
        // In through one door and out at the other: they grow and shrink over the first and last metre.
        appear = Math.min(1, w.s / 1, (s.total - w.s) / 1),
        scale = w.wait > 0 ? 0 : Math.max(0, appear),
        // A slight sway, as people walk.
        sway = Math.sin(w.s * 3.2) * 0.04;
      position.set(p.x - p.dz * w.side, 0.05, p.z + p.dx * w.side);
      q.setFromAxisAngle(up, Math.atan2(p.dx, p.dz) + sway);
      size.setScalar(scale);
      mesh.setMatrixAt(i, m.compose(position, q, size));
    });
    mesh.instanceMatrix.needsUpdate = true;
    return walkers.length > 0;
  }

  /** Walk on to `time` (ms). Returns true when anyone moved, so the scene needs drawing. */
  function update(time: number) {
    const dt = last ? Math.min(0.1, (time - last) / 1000) : 0;
    last = time;
    if (!walkers.length || !mesh.visible) return false;
    for (const w of walkers) {
      if (w.wait > 0) {
        w.wait -= dt;
        continue;
      }
      w.s += w.speed * dt;
      if (w.s >= strolls[w.stroll].total) pick(w);
    }
    return place();
  }

  return {
    mesh,
    setStrolls,
    update,
    /** Shown or not (the "people" switch); nothing moves while hidden. */
    show(on: boolean) {
      mesh.visible = on;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
