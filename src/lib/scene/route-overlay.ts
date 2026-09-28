import * as THREE from "three";
import type { Point } from "../wayfinding/navigation.ts";
import { clearGroup } from "./dispose.ts";

const BLUE = "#2f7fc4",
  RED = "#d24b3b",
  /** Height of the route line: just above room floors. */
  LINE_Y = 0.46;

function arrowShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.28);
  s.lineTo(0.2, -0.05);
  s.lineTo(0.08, -0.05);
  s.lineTo(0.08, -0.25);
  s.lineTo(-0.08, -0.25);
  s.lineTo(-0.08, -0.05);
  s.lineTo(-0.2, -0.05);
  return s;
}

function pinMarker() {
  const pin = new THREE.Group();
  const red = { color: RED, roughness: 0.35 };
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16), new THREE.MeshStandardMaterial(red));
  head.position.y = 2.1;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 24), new THREE.MeshStandardMaterial(red));
  tip.rotation.x = Math.PI;
  tip.position.y = 1.35;
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: "#ffffff" }),
  );
  dot.position.set(0, 2.15, 0.45);
  pin.add(head, tip, dot);
  pin.traverse((o) => (o.castShadow = true));
  return pin;
}

/** The walking route drawn in 3D: a line with moving arrows, a start dot and a destination pin. */
export function createRouteOverlay() {
  const group = new THREE.Group();
  let path: { points: THREE.Vector3[]; lengths: number[]; total: number } | null = null;
  let arrows: { mesh: THREE.Mesh; offset: number }[] = [];
  let pin: THREE.Object3D | null = null;
  let halo: THREE.Mesh | null = null;

  /** Draw a route in tile coordinates; returns its bounds in metres, or null when cleared. */
  function show(route: Point[] | null): THREE.Box3 | null {
    clearGroup(group);
    path = null;
    arrows = [];
    pin = halo = null;
    if (!route || route.length < 2) return null;
    const points = route.map((p) => new THREE.Vector3(p.x * 2, LINE_Y, p.y * 2)),
      blue = new THREE.MeshBasicMaterial({ color: BLUE }),
      lengths = [0];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        length = a.distanceTo(b);
      lengths.push(lengths[i - 1] + length);
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, length), blue.clone());
      line.position.copy(a).lerp(b, 0.5);
      line.lookAt(b.x, LINE_Y, b.z);
      const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.06, 20), blue.clone());
      joint.position.copy(b);
      group.add(line, joint);
    }
    blue.dispose();
    const total = lengths[lengths.length - 1];
    path = { points, lengths, total };

    const shape = arrowShape();
    for (let offset = 0; offset < total; offset += 1.6) {
      const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.DoubleSide }),
      );
      mesh.renderOrder = 5;
      group.add(mesh);
      arrows.push({ mesh, offset });
    }

    const start = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.14, 32),
      new THREE.MeshBasicMaterial({ color: BLUE }),
    );
    start.position.copy(points[0]).setY(0.5);
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.75, 0.1, 32),
      new THREE.MeshBasicMaterial({ color: "#ffffff" }),
    );
    ring.position.copy(points[0]).setY(0.47);

    const end = points[points.length - 1];
    pin = pinMarker();
    pin.position.copy(end).setY(0.4);
    halo = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.85, 40),
      new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.copy(end).setY(0.5);
    group.add(ring, start, pin, halo);
    return new THREE.Box3().setFromPoints(points);
  }

  /** Arrows flow along the route, the pin bobs and its halo pulses. */
  function animate(time: number) {
    if (!path) return;
    const { points, lengths, total } = path;
    for (const a of arrows) {
      const s = (a.offset + time * 0.0016) % total;
      let i = 1;
      while (i < lengths.length - 1 && lengths[i] < s) i++;
      const t = (s - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1),
        from = points[i - 1],
        to = points[i];
      a.mesh.position.copy(from).lerp(to, t).setY(0.5);
      a.mesh.rotation.set(-Math.PI / 2, 0, Math.atan2(from.x - to.x, from.z - to.z));
    }
    if (pin) pin.position.y = 0.4 + Math.sin(time / 380) * 0.18;
    if (halo) {
      const k = 1 + ((time / 1400) % 1) * 0.9;
      halo.scale.set(k, k, k);
      (halo.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1.9 - k);
    }
  }

  return { group, show, animate, dispose: () => clearGroup(group) };
}
