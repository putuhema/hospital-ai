import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Walking about the 3D map yourself, as in a third-person game: a little
 * figure in AIRMA green that you steer, with the camera following behind and
 * above. Walls stop you (doors let you through) and you slide along them
 * rather than sticking.
 *
 * The camera turns with you: left and right turn the figure, forward and back
 * walk the way it faces, and the camera swings round to stay behind. Dragging
 * glances around (and tilts); walking on, the view settles back behind. The
 * wheel or a pinch brings the camera nearer or farther.
 */

/** Where the walker is (metres on the ground), which way they face, and the camera around them. */
export type Roamer = {
  x: number;
  z: number;
  /** Which way the figure faces (radians; 0 is +z, as the crowd). */
  facing: number;
  /** Metres walked, for the bob of each step. */
  stride: number;
  /** Metres a second now; eases towards the pace asked for. */
  speed: number;
  /** The camera's heading around the walker (radians; 0 puts it south, at +z); follows behind the figure. */
  yaw: number;
  /** A look around by dragging, on top of behind the figure (radians); fades as they walk on. */
  glance: number;
  /** How far the camera looks down (radians above the horizon). */
  pitch: number;
  /** Metres from the walker to the camera. */
  distance: number;
};

/** Steering: `x` right (+) and left, `y` forward (+) and back, each -1…1; `run` for the faster pace. */
export type RoamInput = { x: number; y: number; run: boolean };

export const WALK = 3,
  RUN = 6.5,
  /** Walking backwards is slower. */
  BACK = 0.55,
  /** How fast left and right turn the figure (radians a second). */
  TURN = 2.6,
  /** Half the figure's width: kept this far from walls. */
  RADIUS = 0.3,
  PITCH = { min: 0.18, max: 1.2 },
  DISTANCE = { min: 4, max: 20 };

export function roamer(x: number, z: number, yaw = 0): Roamer {
  return { x, z, facing: yaw + Math.PI, stride: 0, speed: 0, yaw, glance: 0, pitch: 0.62, distance: 12 };
}

/** The shortest turn from angle `a` to `b`. */
const turn = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/**
 * One step of `dt` seconds. `canStep` says whether a short move (metres) is
 * clear of walls. Each axis is tried on its own, so walking into a wall at
 * an angle slides along it.
 */
export function step(r: Roamer, input: RoamInput, dt: number, canStep: (from: { x: number; z: number }, to: { x: number; z: number }) => boolean): Roamer {
  dt = Math.min(dt, 0.05);
  // Right (+x) turns clockwise seen from above.
  const facing = r.facing - input.x * TURN * dt;
  const forward = Math.max(-1, Math.min(1, input.y));
  const target = forward > 0.01 ? forward * (input.run ? RUN : WALK) : forward < -0.01 ? forward * WALK * BACK : 0;
  // Quick to set off and to stop, but not instant.
  const speed = r.speed + (target - r.speed) * (1 - Math.exp(-dt * 10));
  let { x, z } = r;
  const dx = Math.sin(facing) * speed * dt,
    dz = Math.cos(facing) * speed * dt;
  if (Math.abs(dx) > 1e-6 && canStep({ x, z }, { x: x + dx + Math.sign(dx) * RADIUS, z })) x += dx;
  if (Math.abs(dz) > 1e-6 && canStep({ x, z }, { x, z: z + dz + Math.sign(dz) * RADIUS })) z += dz;
  const moved = Math.hypot(x - r.x, z - r.z);
  // Walking on, a glance around settles back; the camera swings round to stay behind them.
  const glance = Math.abs(speed) > 0.3 ? r.glance * Math.exp(-dt * 2.5) : r.glance;
  const yaw = r.yaw + turn(r.yaw, facing + Math.PI + glance) * (1 - Math.exp(-dt * 6));
  return { ...r, x, z, facing, speed, yaw, glance, stride: r.stride + moved };
}

/** Glance around the walker by a drag of `dx`, `dy` pixels: turns the camera, and tilts it. */
export function look(r: Roamer, dx: number, dy: number): Roamer {
  return {
    ...r,
    glance: Math.max(-Math.PI, Math.min(Math.PI, r.glance - dx * 0.006)),
    pitch: Math.min(PITCH.max, Math.max(PITCH.min, r.pitch + dy * 0.004)),
  };
}

/** The camera nearer (ratio < 1) or farther. */
export const zoom = (r: Roamer, ratio: number): Roamer => ({
  ...r,
  distance: Math.min(DISTANCE.max, Math.max(DISTANCE.min, r.distance * ratio)),
});

/** Where the camera sits and what it looks at, for a walker. */
export function chasePose(r: Roamer) {
  const flat = Math.cos(r.pitch) * r.distance;
  return {
    position: new THREE.Vector3(r.x + Math.sin(r.yaw) * flat, 1.6 + Math.sin(r.pitch) * r.distance, r.z + Math.cos(r.yaw) * flat),
    target: new THREE.Vector3(r.x, 1.4, r.z),
  };
}

/** Steering from the keys held: WASD or the arrows, Shift to run. */
export function keysInput(held: Set<string>): RoamInput {
  const on = (...keys: string[]) => keys.some((k) => held.has(k));
  return {
    x: (on("d", "arrowright") ? 1 : 0) - (on("a", "arrowleft") ? 1 : 0),
    y: (on("w", "arrowup") ? 1 : 0) - (on("s", "arrowdown") ? 1 : 0),
    run: on("shift"),
  };
}

/**
 * The walker's figure: a bright hi-vis top and an AIRMA-green cap, a little
 * larger than the crowd. Wherever a wall or a roof hides them, their
 * outline shows through in bright lime, and the arrow at their feet always
 * shows, so you never lose yourself.
 */
export function createAvatar() {
  const look = (color: string) => new THREE.MeshLambertMaterial({ color });
  const parts = (list: THREE.BufferGeometry[]) => {
    const merged = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)))!;
    for (const g of list) g.dispose();
    return merged;
  };
  const body = new THREE.Mesh(
    parts([
      new THREE.CylinderGeometry(0.18, 0.24, 1.15, 10).translate(0, 0.6, 0),
      // A small backpack, so you can tell which way they face.
      new THREE.BoxGeometry(0.3, 0.4, 0.14).translate(0, 0.8, -0.22),
    ]),
    look("#c5ee3a"),
  );
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8).translate(0, 1.42, 0), look("#a8714a"));
  const cap = new THREE.Mesh(
    parts([
      new THREE.SphereGeometry(0.18, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.47, 0),
      new THREE.BoxGeometry(0.22, 0.03, 0.16).translate(0, 1.48, 0.17),
    ]),
    look("#2d4a38"),
  );
  // The outline through walls: drawn only where something nearer hides the figure.
  const ghost = new THREE.MeshBasicMaterial({
    color: "#c5ee3a",
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth,
  });
  const shadows = [body, head, cap].map((m) => {
    const g = new THREE.Mesh(m.geometry, ghost);
    g.renderOrder = 20;
    return g;
  });
  const figure = new THREE.Group();
  figure.add(body, head, cap, ...shadows);
  figure.scale.setScalar(1.3);
  for (const m of [body, head, cap]) m.castShadow = true;
  // An arrow at their feet, pointing the way: to the lost visitor, then along the route to where they want to go.
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.42, 3).rotateX(Math.PI / 2).translate(0, 0.08, 1.05),
    new THREE.MeshBasicMaterial({ color: "#f2b134", depthTest: false, transparent: true }),
  );
  arrow.visible = false;
  arrow.renderOrder = 22;
  const group = new THREE.Group();
  group.add(arrow, figure);
  group.visible = false;

  return {
    group,
    /** Point the arrow at their feet (radians, as `facing`), or hide it. */
    pointTo(angle: number | null) {
      arrow.visible = angle !== null;
      if (angle !== null) arrow.rotation.y = angle;
    },
    /** Stand the figure where the walker is, bobbing with each step. */
    place(r: Roamer) {
      group.position.set(r.x, 0, r.z);
      const walking = Math.abs(r.speed) > 0.2;
      figure.position.y = 0.05 + (walking ? Math.abs(Math.sin((r.stride * Math.PI) / 0.75)) * 0.08 : 0);
      figure.rotation.set(0, r.facing + (walking ? Math.sin(r.stride * 4.2) * 0.05 : 0), 0);
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    },
  };
}

/** A round label with a mark on it ("?" over a lost visitor), always facing the camera. */
function badge(text: string, fill: string, ink: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const c = canvas.getContext("2d")!;
  c.fillStyle = fill;
  c.beginPath();
  c.arc(64, 64, 58, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 8;
  c.strokeStyle = "#ffffff";
  c.stroke();
  c.fillStyle = ink;
  c.font = "bold 84px system-ui, sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.renderOrder = 10;
  sprite.scale.setScalar(1.1);
  return sprite;
}

/** A person as the crowd draws them: body and head, `height` against a grown-up. */
function personMesh(clothes: string, skin: string, height: number) {
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.23, 1.15, 8).translate(0, 0.6, 0), new THREE.MeshLambertMaterial({ color: clothes })),
    head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8).translate(0, 1.4, 0), new THREE.MeshLambertMaterial({ color: skin }));
  const g = new THREE.Group();
  g.add(body, head);
  g.scale.setScalar(1.3 * height);
  return g;
}

/**
 * A lost visitor (scene/guide-game.ts): a grandmother, a patient in hospital
 * blue, or a mother with her child, with a "?" bobbing over them while they
 * wait. Found, they follow the walker's footsteps a step behind, so they go
 * where the walker went and never through a wall.
 */
export function createLost() {
  const group = new THREE.Group(),
    people = new THREE.Group(),
    mark = badge("?", "#f2b134", "#3d2700");
  group.add(people, mark);
  group.visible = false;
  /** Where the walker has been lately (metres), oldest first, for following in their footsteps. */
  let trail: Spot2[] = [],
    following = false,
    at = { x: 0, z: 0 },
    facing = 0,
    stride = 0;
  type Spot2 = { x: number; z: number };
  const looks: Record<string, [string, string, number][]> = {
    elder: [["#8c5a3c", "#a8714a", 0.95]],
    adult: [["#6a7fb0", "#8d5a3b", 1]],
    patient: [["#9cc3dd", "#c08a5f", 1]],
    pair: [
      ["#b5585b", "#a8714a", 1],
      ["#f2b134", "#c08a5f", 0.62],
    ],
  };
  function clear() {
    people.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    people.clear();
  }
  return {
    group,
    /** Someone new waits at `x`, `z`, looking like `look`. */
    wait(look: keyof typeof looks, x: number, z: number) {
      clear();
      looks[look].forEach(([clothes, skin, height], i) => {
        const p = personMesh(clothes, skin, height);
        p.position.x = i * 0.7;
        people.add(p);
      });
      at = { x, z };
      trail = [];
      following = false;
      group.visible = true;
      mark.visible = true;
    },
    /** They follow from now on. */
    follow() {
      following = true;
      mark.visible = false;
    },
    hide() {
      group.visible = false;
      clear();
    },
    /** Move them on: waiting, they bob under their "?"; following, they keep a step and a half behind the walker. */
    update(time: number, walker: Spot2) {
      if (!group.visible) return;
      if (following) {
        const last = trail.at(-1);
        if (!last || Math.hypot(walker.x - last.x, walker.z - last.z) > 0.25) trail.push({ ...walker });
        if (trail.length > 60) trail.shift();
        // The footstep about 1.6 m back along the way the walker came.
        let back = 0,
          goal = trail[0];
        for (let i = trail.length - 1; i > 0; i--) {
          back += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].z - trail[i - 1].z);
          if (back >= 1.6) {
            goal = trail[i - 1];
            break;
          }
        }
        if (goal) {
          const dx = goal.x - at.x,
            dz = goal.z - at.z,
            d = Math.hypot(dx, dz);
          if (d > 0.05) {
            const move = Math.min(d, d * 0.2 + 0.02);
            at = { x: at.x + (dx / d) * move, z: at.z + (dz / d) * move };
            facing = Math.atan2(dx, dz);
            stride += move;
          }
        }
      } else {
        // Waiting: they look about, a little lost.
        facing = Math.sin(time / 900) * 0.8;
      }
      group.position.set(at.x, 0, at.z);
      people.rotation.y = facing;
      people.position.y = following ? Math.abs(Math.sin(stride * 4.2)) * 0.06 : 0;
      mark.position.set(0, 3 + Math.sin(time / 300) * 0.15, 0);
    },
    dispose() {
      clear();
      mark.material.map?.dispose();
      mark.material.dispose();
    },
  };
}

/** Where to bring them: a tall beam of light and a ring on the ground, gently pulsing. */
export function createBeacon() {
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 14, 20, 1, true).translate(0, 7, 0),
    new THREE.MeshBasicMaterial({ color: "#7cc47f", transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
  );
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.6, 2.1, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: "#7cc47f", transparent: true, opacity: 0.9, depthWrite: false }),
  );
  ring.position.y = 0.08;
  const group = new THREE.Group();
  group.add(beam, ring);
  group.visible = false;
  return {
    group,
    show(x: number, z: number) {
      group.position.set(x, 0, z);
      group.visible = true;
    },
    hide() {
      group.visible = false;
    },
    update(time: number) {
      if (!group.visible) return;
      const pulse = (Math.sin(time / 250) + 1) / 2;
      ring.scale.setScalar(1 + pulse * 0.15);
      (beam.material as THREE.MeshBasicMaterial).opacity = 0.2 + pulse * 0.15;
    },
    dispose() {
      for (const m of [beam, ring]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
  };
}

/**
 * Which way to point along a route (spots in metres) from `x`, `z`: towards
 * the first point of it more than `ahead` metres on from the nearest, so the
 * arrow leads round corners and through doors rather than at walls.
 */
export function wayAlong(route: { x: number; z: number }[], x: number, z: number, ahead = 2.5): number | null {
  if (!route.length) return null;
  let nearest = 0,
    best = Infinity;
  route.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < best) [best, nearest] = [d, i];
  });
  for (let i = nearest; i < route.length; i++)
    if (Math.hypot(route[i].x - x, route[i].z - z) > ahead) return Math.atan2(route[i].x - x, route[i].z - z);
  const end = route.at(-1)!;
  return Math.hypot(end.x - x, end.z - z) > 0.5 ? Math.atan2(end.x - x, end.z - z) : null;
}
