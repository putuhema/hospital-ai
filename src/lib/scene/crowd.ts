import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * People (and the hospital's cats) strolling between the buildings while
 * nobody is using the map, so the campus feels alive. Four instanced meshes,
 * so everyone is drawn in four calls: bodies, heads (skin or a hijab),
 * umbrellas against the midday sun, and cats. Each walker follows a stroll (a
 * walking route in metres) from door to door, appearing at the first and
 * fading out at the last, then sets off on another.
 *
 * Who is about: grown-ups, children skipping beside a parent, older people
 * taking their time, and a few cats that wander slowly and sit down a while.
 * Someone tapped gives a little hop before they speak.
 *
 * Cheap to run: the scene only moves them as often as they visibly move (see
 * `stepEvery`), and asks for a frame only when someone is on screen.
 */

/** Clothes: hospital whites and scrubs, batik browns, everyday colours. */
const CLOTHES = ["#f4f2ec", "#7fb3c9", "#5f9a7a", "#c98a4b", "#8c5a3c", "#d9c27a", "#6a7fb0", "#b5585b", "#4f5d6a", "#e9e4d8"];
/** Children wear brighter things. */
const KIDS = ["#f2b134", "#e2574c", "#4fa3d9", "#7cc47f", "#e98bb4", "#f7d44c"];
const SKIN = ["#8d5a3b", "#a8714a", "#6e4529", "#c08a5f", "#9b6744"];
const HIJAB = ["#2f3e5c", "#b5585b", "#e2c9a6", "#5f7d64", "#7a4b6b", "#d9d2c2", "#3d6f86", "#c9a03f"];
const UMBRELLAS = ["#e2574c", "#f2b134", "#4fa3d9", "#e98bb4", "#7cc47f", "#ffffff", "#7b5ea7"];
/** Ginger, white, black, grey tabby, cream. */
const CATS = ["#d9873a", "#f1ece2", "#2b2724", "#8a8580", "#e6c98f"];

export type Kind = "adult" | "child" | "elder" | "cat";

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

/**
 * How often (ms) to move the crowd while the map rests: about as often as a
 * walker moves one pixel, so far out (a few pixels a metre) a handful of
 * frames a second is enough, and up close 20. Calmer still once the map has
 * been left alone a minute and a half, as on a phone lying on a table.
 */
export function stepEvery(pixelsPerMetre: number, idleMs: number) {
  const pixel = 1000 / (1.2 * Math.max(0.05, pixelsPerMetre));
  const ms = Math.min(160, Math.max(48, pixel * 1.2));
  return idleMs > 90_000 ? Math.max(ms, 120) : ms;
}

/** Whether people carry an umbrella against the sun at this hour (late morning to mid afternoon). */
export const sunny = (hour: number) => hour >= 10 && hour < 15.5;

/** People are drawn a little larger than life, so they show at map scale; cats more so. */
const SIZE = 1.3,
  CAT_SIZE = 2.2;

function merged(parts: THREE.BufferGeometry[]) {
  const out = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!;
  for (const g of parts) g.dispose();
  return out;
}
/** A body about 1.25 m tall, standing on the origin; the head sits on it (1.4 m). */
const bodyShape = () => new THREE.CylinderGeometry(0.17, 0.23, 1.15, 7).translate(0, 0.6, 0);
const headShape = () => new THREE.SphereGeometry(0.16, 8, 6).translate(0, 1.4, 0);
/** An umbrella held up over the head: a pole and an open canopy. */
const umbrellaShape = () =>
  merged([
    new THREE.CylinderGeometry(0.015, 0.015, 0.75, 4).translate(0.12, 1.7, 0),
    new THREE.ConeGeometry(0.6, 0.26, 8, 1, true).translate(0.12, 2.12, 0),
  ]);
/** A cat about 0.45 m long, facing +z: body, head, ears and a tail up. */
const catShape = () =>
  merged([
    new THREE.BoxGeometry(0.16, 0.15, 0.36).translate(0, 0.2, 0),
    new THREE.BoxGeometry(0.15, 0.13, 0.13).translate(0, 0.31, 0.21),
    new THREE.ConeGeometry(0.035, 0.07, 4).translate(-0.045, 0.4, 0.21),
    new THREE.ConeGeometry(0.035, 0.07, 4).translate(0.045, 0.4, 0.21),
    new THREE.CylinderGeometry(0.018, 0.022, 0.26, 4).rotateX(-0.5).translate(0, 0.33, -0.22),
    // Four short legs.
    ...[-1, 1].flatMap((x) => [-1, 1].map((z) => new THREE.BoxGeometry(0.04, 0.13, 0.04).translate(x * 0.05, 0.065, z * 0.13))),
  ]);

type Stroll = { points: { x: number; z: number }[]; lengths: number[]; total: number };
type Walker = {
  kind: Kind;
  /** Height against a grown-up's. */
  height: number;
  /** The walk they are on: their own, so new walks arriving never move them. */
  stroll: Stroll;
  /** Not about just now (fewer people wanted): waiting unseen behind a door. */
  benched: boolean;
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
  umbrella: boolean;
  /** Seconds left of a hop (when tapped). */
  hop: number;
};

const random = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

export function createCrowd(scene: THREE.Scene, count: number) {
  const cats = count >= 30 ? 3 : 2,
    total = count + cats;
  const look = (side: THREE.Side = THREE.FrontSide) => new THREE.MeshLambertMaterial({ color: "#ffffff", side });
  const meshes = {
    body: new THREE.InstancedMesh(bodyShape(), look(), total),
    head: new THREE.InstancedMesh(headShape(), look(), total),
    umbrella: new THREE.InstancedMesh(umbrellaShape(), look(THREE.DoubleSide), total),
    cat: new THREE.InstancedMesh(catShape(), look(), total),
  };
  const all = Object.values(meshes);
  const group = new THREE.Group();
  for (const mesh of all) {
    // Drawn like everything else: buildings and corridor roofs hide whoever is
    // inside or under them, so people show on the paths and grounds between.
    mesh.frustumCulled = false;
    mesh.count = 0;
    group.add(mesh);
  }
  scene.add(group);

  /** Walks enough to spread the people over, before bringing them out; with fewer, a few seconds' wait. */
  const ENOUGH = 8;
  let firstAt = 0;
  let strolls: Stroll[] = [],
    walkers: Walker[] = [],
    last = 0,
    hour = 12,
    /** How many are out and about now (the rest wait behind doors), up to `total`. The cats are always about. */
    active = total;
  /** Where each walker stands (x, z), how much of them shows, and the top of their head, for picking one out. */
  const at = new Float32Array(total * 4);
  const m = new THREE.Matrix4(),
    zero = new THREE.Matrix4().makeScale(0, 0, 0),
    q = new THREE.Quaternion(),
    up = new THREE.Vector3(0, 1, 0),
    position = new THREE.Vector3(),
    size = new THREE.Vector3(),
    point = new THREE.Vector3(),
    frustum = new THREE.Frustum(),
    viewProjection = new THREE.Matrix4(),
    color = new THREE.Color();

  /** Who walker `i` is: the cats come first, so they stay about however few people are. */
  function cast(i: number): Pick<Walker, "kind" | "height"> {
    if (i < cats) return { kind: "cat", height: 1 };
    const r = Math.random();
    if (r < 0.15) return { kind: "elder", height: 0.95 };
    if (r < 0.27) return { kind: "child", height: 0.62 };
    return { kind: "adult", height: 0.94 + Math.random() * 0.12 };
  }

  /** Walker `i` sets off on a walk: from a door, or (`fresh`, when the map opens) somewhere along it. */
  const pick = (w: Walker, i: number, fresh = false) => {
    // Fewer people wanted: they go in at the end of their walk, rather than vanishing on the way.
    w.benched = i >= active;
    if (strolls.length) w.stroll = random(strolls);
    const length = w.stroll.total;
    w.s = fresh ? Math.random() * length : 0;
    w.speed =
      w.kind === "cat" ? 0.45 + Math.random() * 0.3 : w.kind === "elder" ? 0.6 + Math.random() * 0.25 : w.kind === "child" ? 1.2 + Math.random() * 0.5 : 0.95 + Math.random() * 0.55;
    w.side = (Math.random() - 0.5) * (w.kind === "cat" ? 1.6 : 0.6);
    w.wait = fresh ? 0 : Math.random() * (w.kind === "cat" ? 8 : 3);
    // One in four stops a moment on the way; cats mostly, and sit down a good while.
    const stops = Math.random() < (w.kind === "cat" ? 0.75 : 0.25) && length > 10;
    w.stopAt = stops ? 4 + Math.random() * (length - 8) : Infinity;
    w.stopFor = w.kind === "cat" ? 4 + Math.random() * 8 : 2 + Math.random() * 4;
    w.umbrella = w.kind !== "cat" && w.kind !== "child" && sunny(hour) && Math.random() < 0.3;
  };

  /** Colours per walker: clothes, skin or a hijab, their umbrella, a cat's coat. */
  function dress() {
    walkers.forEach((w, i) => {
      meshes.cat.setColorAt(i, color.set(random(CATS)));
      meshes.body.setColorAt(i, color.set(w.kind === "child" ? random(KIDS) : random(CLOTHES)));
      // About two in five grown-ups wear a hijab.
      meshes.head.setColorAt(i, color.set(w.kind !== "child" && Math.random() < 0.4 ? random(HIJAB) : random(SKIN)));
      meshes.umbrella.setColorAt(i, color.set(random(UMBRELLAS)));
    });
    for (const mesh of all) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /**
   * The walks to choose from, in metres. The first ones bring the people out, spread along them; later
   * ones (they arrive a few at a time) only join the choice: everyone already about walks on as they
   * were, in the same clothes, so nobody jumps when more arrive.
   */
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
    if (strolls.length && !firstAt) firstAt = performance.now();
    if (strolls.length >= ENOUGH) populate();
  }

  /** Bring the people out, spread along the walks there are; once only. */
  function populate() {
    if (walkers.length || !strolls.length) return;
    walkers = Array.from({ length: total }, (_, i) => {
      const w: Walker = { ...cast(i), stroll: strolls[0], benched: false, s: 0, speed: 1, side: 0, wait: 0, stopAt: Infinity, stopFor: 0, with: -1, umbrella: false, hop: 0 };
      pick(w, i, true);
      return w;
    });
    // About a third walk with someone, beside them; most children walk with a grown-up.
    walkers.forEach((w, i) => {
      const lead = walkers[i - 1];
      if (w.kind === "cat" || !lead || lead.kind === "cat" || lead.with >= 0 || (i - cats) % 2 !== 1) return;
      if (w.kind === "child" ? Math.random() < 0.85 && lead.kind !== "child" : Math.random() < 0.35) w.with = i - 1;
    });
    dress();
    counts();
    place();
  }

  function counts() {
    // Everyone is drawn; those benched have no size.
    for (const mesh of all) mesh.count = walkers.length;
  }

  /** Put every walker where they are. */
  function place() {
    walkers.forEach((w, i) => {
      const s = w.stroll,
        p = along(s.points, s.lengths, w.s),
        cat = w.kind === "cat",
        // In through one door and out at the other: they grow and shrink over the first and last metre.
        appear = Math.max(0, Math.min(1, w.s, s.total - w.s)),
        scale = w.wait > 0 || w.benched ? 0 : appear * (cat ? CAT_SIZE : SIZE * w.height),
        standing = w.s >= w.stopAt && w.stopFor > 0,
        // A slight sway and a bob with each step; children skip, higher. A hop when tapped.
        stride = w.kind === "child" ? 0.5 : 0.7,
        sway = standing || cat ? 0 : Math.sin(w.s * 3.2) * 0.04,
        bob = standing ? 0 : Math.abs(Math.sin((w.s * Math.PI) / stride)) * (w.kind === "child" ? 0.12 : cat ? 0.015 : 0.05),
        hop = w.hop > 0 ? Math.sin((1 - w.hop / 0.5) * Math.PI) * 0.45 : 0;
      position.set(p.x - p.dz * w.side, 0.05 + bob + hop, p.z + p.dx * w.side);
      q.setFromAxisAngle(up, Math.atan2(p.dx, p.dz) + sway);
      // A cat sitting down is a little lower and shorter.
      size.set(scale, cat && standing ? scale * 0.82 : scale, scale);
      m.compose(position, q, size);
      at[i * 4] = position.x;
      at[i * 4 + 1] = position.z;
      at[i * 4 + 2] = scale / (cat ? CAT_SIZE : SIZE * w.height);
      at[i * 4 + 3] = position.y + (cat ? 0.42 * size.y : 1.75 * scale);
      meshes.cat.setMatrixAt(i, cat ? m : zero);
      meshes.body.setMatrixAt(i, cat ? zero : m);
      meshes.head.setMatrixAt(i, cat ? zero : m);
      meshes.umbrella.setMatrixAt(i, !cat && w.umbrella ? m : zero);
    });
    for (const mesh of all) mesh.instanceMatrix.needsUpdate = true;
  }

  /** Whether anyone drawn is in the camera's view, so a frame would show them move. */
  function seen(camera: THREE.Camera) {
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    for (let i = 0; i < walkers.length; i++)
      if (at[i * 4 + 2] > 0 && frustum.containsPoint(point.set(at[i * 4], 1, at[i * 4 + 1]))) return true;
    return false;
  }

  /** Walk on to `time` (ms). True when someone in view moved, so the scene needs drawing. */
  function update(time: number, camera?: THREE.Camera) {
    const dt = last ? Math.min(0.2, (time - last) / 1000) : 0;
    last = time;
    // A small campus may never have many walks: out they come after a few seconds anyway.
    if (!walkers.length && firstAt && performance.now() - firstAt > 3000) populate();
    if (!walkers.length || !group.visible) return false;
    walkers.forEach((w, i) => {
      if (w.hop > 0) w.hop = Math.max(0, w.hop - dt);
      // A companion keeps beside the one they walk with, half a step behind.
      const lead = w.with >= 0 ? walkers[w.with] : null;
      if (lead && lead.with < 0) {
        w.stroll = lead.stroll;
        w.benched = lead.benched;
        w.s = Math.max(0, lead.s - 0.5);
        w.side = lead.side + (lead.side > 0 ? -0.55 : 0.55);
        w.wait = lead.wait;
        w.stopAt = lead.stopAt - 0.5;
        w.stopFor = lead.stopFor;
        return;
      }
      if (w.benched) {
        // More people wanted: out of a door they come.
        if (i < active) pick(w, i);
        return;
      }
      if (w.wait > 0) {
        w.wait -= dt;
        return;
      }
      if (w.s >= w.stopAt && w.stopFor > 0) {
        w.stopFor -= dt;
        return;
      }
      w.s += w.speed * dt;
      if (w.s >= w.stroll.total) pick(w, i);
    });
    place();
    return camera ? seen(camera) : true;
  }

  const head = new THREE.Vector3();
  /** The top of walker `i`'s head, in the scene. */
  function headOf(i: number, out = head) {
    return out.set(at[i * 4], at[i * 4 + 3], at[i * 4 + 1]);
  }
  /** Whoever is shown nearest a screen point (pixels in a view of `width` × `height`), within `reach` pixels; -1 for none. */
  function pickAt(camera: THREE.Camera, width: number, height: number, x: number, y: number, reach = 26) {
    let best = -1,
      gap = reach;
    for (let i = 0; i < walkers.length; i++) {
      if (at[i * 4 + 2] < 0.6) continue;
      // Their middle, about chest height (a cat's back).
      point.set(at[i * 4], at[i * 4 + 3] * 0.6, at[i * 4 + 1]).project(camera);
      if (point.z > 1) continue;
      const d = Math.hypot(((point.x + 1) / 2) * width - x, ((1 - point.y) / 2) * height - y);
      if (d < gap) [best, gap] = [i, d];
    }
    return best;
  }
  /** Those in view right now (on screen, fully shown), to choose someone to speak. */
  function inView(camera: THREE.Camera) {
    const list: number[] = [];
    for (let i = 0; i < walkers.length; i++) {
      if (at[i * 4 + 2] < 0.9) continue;
      point.set(at[i * 4], at[i * 4 + 3] * 0.7, at[i * 4 + 1]).project(camera);
      if (point.z < 1 && Math.abs(point.x) < 0.75 && point.y > -0.5 && point.y < 0.6) list.push(i);
    }
    return list;
  }
  /** Walker `i` stands still a while (to say something), with whoever walks beside them, after a little hop. */
  function hold(i: number, seconds: number) {
    const w = walkers[i];
    if (!w) return;
    const lead = w.with >= 0 ? walkers[w.with] : w;
    lead.stopAt = lead.s;
    lead.stopFor = seconds;
    w.hop = 0.5;
  }

  return {
    group,
    setStrolls,
    update,
    headOf,
    pickAt,
    inView,
    hold,
    /** Who walker `i` is, for what they say. */
    kindOf: (i: number): Kind => walkers[i]?.kind ?? "adult",
    /** Someone is hopping: the scene moves them every frame for that half second, even right after a tap. */
    lively: () => walkers.some((w) => w.hop > 0),
    /** The hour at the hospital: umbrellas come out in the midday sun, for those setting off from now on. */
    setHour(h: number) {
      hour = h;
    },
    /**
     * How many people are about (busy hours, long queues bring more); the others wait unseen. The cats
     * stay. A change comes gently: the extra ones go in at the end of their walk, new ones come out of a door.
     */
    setActive(n: number) {
      active = cats + Math.max(0, Math.min(count, Math.round(n)));
    },
    /** Shown or not (the "people" switch); nothing moves while hidden. */
    show(on: boolean) {
      group.visible = on;
    },
    dispose() {
      scene.remove(group);
      for (const mesh of all) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.dispose();
      }
    },
  };
}
