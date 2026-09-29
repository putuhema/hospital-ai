import * as THREE from "three";
import { center, footprint } from "../model/interiors.ts";
import type { Piece } from "../model/layout.ts";
import type { Point } from "../wayfinding/navigation.ts";
import { clearGroup } from "./dispose.ts";

const TEAL = "#0f9aa6",
  /** Just above the ground and room floors, below the route line. */
  GROUND_Y = 0.12;

/** What to highlight: a building or area, a room in one, or a spot on the map (a landmark). */
export type HighlightTarget = { pieceId?: number; roomId?: number; point: Point };

/**
 * The outline to draw around a highlighted place, in tiles: a room's
 * rectangle, a building's or area's footprint, or a small square around a
 * landmark. Null when the place is no longer on the layout.
 */
export function highlightShape(
  pieces: Piece[],
  target: HighlightTarget,
): { polygon: Point[]; centre: Point; room: boolean } | null {
  if (target.pieceId === undefined) {
    const { x, y } = target.point,
      r = 0.6;
    return {
      polygon: [
        { x: x - r, y: y - r },
        { x: x + r, y: y - r },
        { x: x + r, y: y + r },
        { x: x - r, y: y + r },
      ],
      centre: target.point,
      room: false,
    };
  }
  const p = pieces.find((p) => p.id === target.pieceId);
  if (!p) return null;
  const r = target.roomId === undefined ? undefined : p.roomAssets?.find((r) => r.id === target.roomId);
  if (r) {
    const x = p.x + r.x,
      y = p.y + r.y;
    return {
      polygon: [
        { x, y },
        { x: x + r.w, y },
        { x: x + r.w, y: y + r.h },
        { x, y: y + r.h },
      ],
      centre: { x: x + r.w / 2, y: y + r.h / 2 },
      room: true,
    };
  }
  return { polygon: footprint(p), centre: center(p), room: false };
}

/**
 * A place picked out on the 3D map, e.g. the one the assistant is talking
 * about: a glowing outline and fill on its footprint, pulsing, with a pin
 * bobbing above it.
 */
export function createHighlight() {
  const group = new THREE.Group();
  let fill: THREE.Mesh | null = null,
    pin: THREE.Object3D | null = null,
    pinY = 0;

  /**
   * Show a shape (null clears it). `top` is the height in metres the pin
   * floats above. Returns the bounds in metres, for the camera to frame.
   */
  function show(shape: { polygon: Point[]; centre: Point } | null, top = 0): THREE.Box3 | null {
    clearGroup(group);
    fill = pin = null;
    if (!shape) return null;
    const corners = shape.polygon.map((p) => new THREE.Vector3(p.x * 2, GROUND_Y, p.y * 2));

    // The ground shape is drawn in x/y and laid flat, so y becomes -z.
    const outline = new THREE.Shape(corners.map((c) => new THREE.Vector2(c.x, -c.z)));
    fill = new THREE.Mesh(
      new THREE.ShapeGeometry(outline),
      new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = GROUND_Y;
    fill.renderOrder = 3;
    group.add(fill);

    const edge = new THREE.MeshBasicMaterial({ color: TEAL });
    corners.forEach((a, i) => {
      const b = corners[(i + 1) % corners.length],
        length = a.distanceTo(b);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, length + 0.3), edge.clone());
      band.position.copy(a).lerp(b, 0.5);
      band.lookAt(b);
      group.add(band);
    });
    edge.dispose();

    pin = new THREE.Group();
    const teal = { color: TEAL, roughness: 0.35 };
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 16), new THREE.MeshStandardMaterial(teal));
    head.position.y = 1.2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.2, 24), new THREE.MeshStandardMaterial(teal));
    tip.rotation.x = Math.PI;
    tip.position.y = 0.4;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
    dot.position.set(0, 1.25, 0.5);
    pin.add(head, tip, dot);
    pin.traverse((o) => (o.castShadow = true));
    pinY = top + 0.6;
    pin.position.set(shape.centre.x * 2, pinY, shape.centre.y * 2);
    group.add(pin);

    return new THREE.Box3().setFromPoints(corners).expandByPoint(pin.position);
  }

  const still = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  /** The fill breathes and the pin bobs, so the place catches the eye. */
  function animate(time: number) {
    if (still) return;
    if (fill) (fill.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.18 * (0.5 + 0.5 * Math.sin(time / 420));
    if (pin) pin.position.y = pinY + Math.sin(time / 380) * 0.25;
  }

  return { group, show, animate, dispose: () => clearGroup(group) };
}
