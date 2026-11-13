import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * People strolling between the buildings while nobody is using the map, so the
 * campus feels alive. One instanced mesh: every walker is drawn in one call,
 * and a frame only moves a few dozen matrices. Each walker follows a stroll
 * (a walking route in metres) from door to door, appearing at the first and
 * fading out at the last, then sets off on another. Some walk in pairs, each
 * bobs with their steps, and now and then one stops a moment on the way.
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

/** People are drawn a little larger than life, so they show at map scale. */
const SIZE = 1.3;

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
type Walker = {
  stroll: number;
  /** Metres along the stroll. */
  s: number;
  speed: number;
  /** Metres to the side of the walkway's middle. */
  side: number;
  /** Seconds before setting off (unseen, behind the door). */
  wait: number;
  /** Where on the way they will stop a moment (metres; Infinity for not), and for how long (seconds). */
  stopAt: number;
  stopFor: number;
  /** In a pair: the index of the one they walk beside, or -1. */
  with: number;
};

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
    last = 0,
    /** How many are out and about now (the rest wait behind doors), up to `count`. */
    active = count;
  /** Where each walker stands (x, z) and how much of them shows, for picking one out. */
  const at = new Float32Array(count * 3);
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    up = new THREE.Vector3(0, 1, 0),
    position = new THREE.Vector3(),
    size = new THREE.Vector3();

  const pick = (w: Walker, fresh = false) => {
    w.stroll = Math.floor(Math.random() * strolls.length);
    const total = strolls[w.stroll].total;
    w.s = fresh ? Math.random() * total : 0;
    w.speed = 0.95 + Math.random() * 0.55;
    w.side = (Math.random() - 0.5) * 0.6;
    w.wait = fresh ? 0 : Math.random() * 3;
    // One in four stops a moment somewhere along the way.
    const stops = Math.random() < 0.25 && total > 10;
    w.stopAt = stops ? 4 + Math.random() * (total - 8) : Infinity;
    w.stopFor = 2 + Math.random() * 4;
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
          const w: Walker = { stroll: 0, s: 0, speed: 1, side: 0, wait: 0, stopAt: Infinity, stopFor: 0, with: -1 };
          pick(w, true);
          return w;
        })
      : [];
    // About a third walk with someone, beside them.
    walkers.forEach((w, i) => {
      if (i % 2 === 1 && Math.random() < 0.35) w.with = i - 1;
    });
    mesh.count = Math.min(active, walkers.length);
    place();
  }

  /** Put every walker where it is; true when anyone is drawn. */
  function place() {
    walkers.forEach((w, i) => {
      const s = strolls[w.stroll],
        p = along(s.points, s.lengths, w.s),
        // In through one door and out at the other: they grow and shrink over the first and last metre.
        appear = Math.min(1, w.s / 1, (s.total - w.s) / 1),
        scale = w.wait > 0 ? 0 : Math.max(0, appear) * SIZE,
        standing = w.s >= w.stopAt && w.stopFor > 0,
        // A slight sway and a bob with each step, as people walk; still while standing.
        sway = standing ? 0 : Math.sin(w.s * 3.2) * 0.04,
        bob = standing ? 0 : Math.abs(Math.sin((w.s * Math.PI) / 0.7)) * 0.05;
      position.set(p.x - p.dz * w.side, 0.05 + bob, p.z + p.dx * w.side);
      at[i * 3] = position.x;
      at[i * 3 + 1] = position.z;
      at[i * 3 + 2] = i < active ? scale : 0;
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
      // A companion keeps beside the one they walk with, half a step behind.
      const lead = w.with >= 0 ? walkers[w.with] : null;
      if (lead && lead.with < 0) {
        w.stroll = lead.stroll;
        w.s = Math.max(0, lead.s - 0.5);
        w.side = lead.side + (lead.side > 0 ? -0.55 : 0.55);
        w.wait = lead.wait;
        w.stopAt = lead.stopAt - 0.5;
        w.stopFor = lead.stopFor;
        continue;
      }
      if (w.wait > 0) {
        w.wait -= dt;
        continue;
      }
      if (w.s >= w.stopAt && w.stopFor > 0) {
        w.stopFor -= dt;
        continue;
      }
      w.s += w.speed * dt;
      if (w.s >= strolls[w.stroll].total) pick(w);
    }
    return place();
  }

  const head = new THREE.Vector3();
  /** The top of walker `i`'s head, in the scene. */
  function headOf(i: number, out = head) {
    return out.set(at[i * 3], 1.75 * SIZE, at[i * 3 + 1]);
  }
  /** Whoever is shown nearest a screen point (pixels in a view of `width` × `height`), within `reach` pixels; -1 for none. */
  function pickAt(camera: THREE.Camera, width: number, height: number, x: number, y: number, reach = 26) {
    let best = -1,
      gap = reach;
    const p = new THREE.Vector3();
    for (let i = 0; i < mesh.count; i++) {
      if (at[i * 3 + 2] < 0.6) continue;
      // Their middle, about chest height.
      p.set(at[i * 3], 1 * SIZE, at[i * 3 + 1]).project(camera);
      if (p.z > 1) continue;
      const d = Math.hypot(((p.x + 1) / 2) * width - x, ((1 - p.y) / 2) * height - y);
      if (d < gap) [best, gap] = [i, d];
    }
    return best;
  }
  /** Those in view right now (on screen, fully shown), to choose someone to speak. */
  function inView(camera: THREE.Camera) {
    const p = new THREE.Vector3(),
      seen: number[] = [];
    for (let i = 0; i < mesh.count; i++) {
      if (at[i * 3 + 2] < 0.9) continue;
      p.set(at[i * 3], 1.2 * SIZE, at[i * 3 + 1]).project(camera);
      if (p.z < 1 && Math.abs(p.x) < 0.75 && p.y > -0.5 && p.y < 0.6) seen.push(i);
    }
    return seen;
  }
  /** Walker `i` stands still a while (to say something), with whoever walks beside them. */
  function hold(i: number, seconds: number) {
    const w = walkers[i];
    if (!w) return;
    const lead = w.with >= 0 ? walkers[w.with] : w;
    lead.stopAt = lead.s;
    lead.stopFor = seconds;
  }

  return {
    mesh,
    setStrolls,
    update,
    headOf,
    pickAt,
    inView,
    hold,
    /** How many are about (busy hours, long queues bring more); the others wait unseen. */
    setActive(n: number) {
      active = Math.max(0, Math.min(count, Math.round(n)));
      mesh.count = Math.min(active, walkers.length);
    },
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
