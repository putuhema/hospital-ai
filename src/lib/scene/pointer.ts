import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Piece } from "../model/layout.ts";

type Tile = { x: number; y: number };
export type Hover = { id: number | null; room: number | null; x: number; y: number };

/** The component's current state, read on every event. */
type State = {
  pan: boolean;
  /** Asset being placed, if any. */
  active: { w: number; h: number } | null;
  pieces: Piece[];
  /** Roofs are off, so individual rooms can be picked. */
  inside: boolean;
};

/**
 * Pointer handling for the 3D scene: drag buildings along the ground,
 * hover for tooltips, preview and place assets, click to select.
 * Returns a function that detaches the listeners.
 */
export function attachPointer(options: {
  dom: HTMLElement;
  camera: THREE.Camera;
  controls: OrbitControls;
  buildings: THREE.Group;
  ground: THREE.Mesh;
  ghost: THREE.Mesh;
  selectedBox: THREE.Box3Helper;
  state: () => State;
  /** A click: the piece and room under it, and where it landed on that piece or the ground, in tiles. */
  onselect: (id: number | null, room?: number, point?: Tile) => void;
  onplace: (tile: Tile) => void;
  /** Without it, buildings can't be dragged (the map is read-only). */
  onmove?: (id: number, x: number, y: number) => void;
  onhover: (hover: Hover | null) => void;
  /** A drag ended; the scene should rebuild models at their committed spots. */
  ondragend: () => void;
}) {
  const { dom, camera, controls, buildings, ground, ghost, selectedBox } = options;
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2(),
    floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let down = { x: 0, y: 0 };
  let drag: { id: number; x: number; y: number; offsetX: number; offsetY: number } | null = null;

  function cast(e: PointerEvent) {
    const r = dom.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, (-(e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
  }
  const groundPoint = () => ray.ray.intersectPlane(floor, new THREE.Vector3());
  const groundTile = (): Tile | null => {
    const hit = ray.intersectObject(ground)[0];
    return hit ? { x: Math.floor(hit.point.x / 2), y: Math.floor(hit.point.z / 2) } : null;
  };
  /** The piece (and room, if any) under the pointer. */
  function pieceHit() {
    const hit = ray.intersectObjects(buildings.children, true)[0];
    let object: THREE.Object3D | undefined = hit?.object;
    while (object && object.parent !== buildings) object = object.parent ?? undefined;
    return {
      id: object?.userData.pieceId as number | undefined,
      room: hit?.object.userData.roomId as number | undefined,
      point: hit?.point,
    };
  }

  function start(e: PointerEvent) {
    down = { x: e.clientX, y: e.clientY };
    const { pan, active, pieces } = options.state();
    if (e.button !== 0 || pan || active || !options.onmove) return;
    cast(e);
    const p = pieces.find((p) => p.id === pieceHit().id),
      point = groundPoint();
    if (!p || !point) return;
    drag = { id: p.id, x: p.x, y: p.y, offsetX: point.x / 2 - p.x, offsetY: point.z / 2 - p.y };
    controls.enabled = false;
    dom.setPointerCapture(e.pointerId);
    options.onselect(p.id);
  }

  function move(e: PointerEvent) {
    cast(e);
    const { active, inside } = options.state();
    if (drag) {
      options.onhover(null);
      const point = groundPoint();
      if (!point) return;
      // Snap to tiles and slide the models along without rebuilding them.
      const x = Math.round(point.x / 2 - drag.offsetX),
        y = Math.round(point.z / 2 - drag.offsetY);
      for (const o of buildings.children.filter((o) => o.userData.pieceId === drag!.id)) {
        o.position.x += (x - drag.x) * 2;
        o.position.z += (y - drag.y) * 2;
      }
      drag.x = x;
      drag.y = y;
      selectedBox.visible = false;
      return;
    }
    if (e.buttons) return options.onhover(null);
    if (!active) {
      const hit = pieceHit(),
        r = dom.getBoundingClientRect();
      options.onhover({
        id: hit.id ?? null,
        room: inside ? (hit.room ?? null) : null,
        x: Math.max(8, Math.min(e.clientX - r.left + 14, r.width - 240)),
        y: Math.max(8, Math.min(e.clientY - r.top + 14, r.height - 200)),
      });
      return;
    }
    options.onhover(null);
    const tile = groundTile();
    ghost.visible = !!tile;
    if (tile) {
      ghost.scale.set(active.w * 2, 1, active.h * 2);
      ghost.position.set(tile.x * 2 + active.w, 0.1, tile.y * 2 + active.h);
    }
  }

  function finishDrag(commit: boolean) {
    if (!drag) return;
    const d = drag;
    drag = null;
    controls.enabled = true;
    if (commit) options.onmove?.(d.id, d.x, d.y);
    options.ondragend();
  }

  function end(e: PointerEvent) {
    if (drag) return finishDrag(true);
    const { pan, active, inside } = options.state();
    // A drag of more than a few pixels was an orbit, not a click.
    if (e.button !== 0 || pan || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    cast(e);
    if (active) {
      const tile = groundTile();
      if (tile) options.onplace(tile);
      return;
    }
    const hit = pieceHit(),
      // A corridor canopy covers its floor, so where the click hit it is where it is on the floor.
      at = hit.point ?? groundPoint();
    options.onselect(hit.id ?? null, inside ? hit.room : undefined, at ? { x: at.x / 2, y: at.z / 2 } : undefined);
  }

  const leave = () => options.onhover(null),
    cancel = () => finishDrag(false);
  dom.addEventListener("pointerleave", leave);
  dom.addEventListener("pointerdown", start, { capture: true });
  dom.addEventListener("pointermove", move);
  dom.addEventListener("pointerup", end);
  dom.addEventListener("pointercancel", cancel);
  return () => {
    dom.removeEventListener("pointerleave", leave);
    dom.removeEventListener("pointerdown", start, { capture: true });
    dom.removeEventListener("pointermove", move);
    dom.removeEventListener("pointerup", end);
    dom.removeEventListener("pointercancel", cancel);
  };
}
