import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** Editor orbit limit: never below the horizon. */
const LOWEST = Math.PI / 2.15;
/** Map tilt limit: steep enough that the horizon never shows, so it reads as a map. */
const MAP_LOWEST = 0.95;
/** The map's default tilt from straight down: a clear plan with a little depth. */
const MAP_TILT = 0.6;
/** Tilt used to look at a route or a place, at most: walls and trees don't hide it. */
const FRAME_TILT = 0.7;
/** Polar angle of the bird's-eye view: straight down, nudged so the camera keeps a heading. */
const OVERHEAD = 1e-4;
/** Tilt for looking at a room from in front of its door: low enough to see into the doorway. */
const DOOR_TILT = 0.9;
/** Heading that puts the camera outside each wall, looking in (0 is from the south). */
const FROM_SIDE = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 } as const;
/** Tilt for following a route: looking ahead along the way, like walking it. */
const AHEAD_TILT = 0.85;

/** A particular angle to frame something from: heading, tilt and how near the camera may come. */
export type View = { theta: number; tilt: number; near: number };
/** Look at a room from in front of its door wall. */
export const doorView = (side: keyof typeof FROM_SIDE): View => ({ theta: FROM_SIDE[side], tilt: DOOR_TILT, near: 12 });
/** Look along a walk from `dx`, `dz` (metres): the camera behind, the way ahead pointing up the screen. */
export const aheadView = (dx: number, dz: number): View => ({ theta: Math.atan2(-dx, -dz), tilt: AHEAD_TILT, near: 14 });
/** Pixels at the top of a phone's map covered by the search bar and map controls. */
const PHONE_BARS = 110;
/** How long the camera takes to move to a place, a route or north (ms): short and decisive. */
const GLIDE_MS = 260;

type Pose = { target: THREE.Vector3; offset: THREE.Spherical };

/** Camera, orbit controls and how the view is framed around the campus or a route. */
export function createCameraRig(dom: HTMLElement, presentation: boolean) {
  // The map uses a long lens from high up, so it reads as a flat, legible plan.
  const camera = new THREE.PerspectiveCamera(presentation ? 30 : 38, 1, 0.1, 1500);
  const controls = new OrbitControls(camera, dom);
  controls.target.set(24, 0, 20);
  if (presentation) {
    // North up (the camera south of the campus, looking north), like the plan.
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSphericalCoords(90, MAP_TILT, 0));
    // Like a map app: one finger or the left button pans along the ground,
    // two fingers pinch to zoom and slide to turn or tilt, the right button turns.
    controls.screenSpacePanning = false;
    controls.zoomToCursor = true;
    controls.dampingFactor = 0.3;
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.maxPolarAngle = MAP_LOWEST;
    controls.minDistance = 10;
  } else {
    camera.position.set(59, 53, 67);
    controls.maxPolarAngle = LOWEST;
    controls.minDistance = 6;
  }
  controls.enableDamping = true;
  controls.maxDistance = 900;
  const lowest = controls.maxPolarAngle;

  // Set while a route is framed, so resizing keeps the route in view.
  let routeDistance: number | null = null;
  // On the map: the canvas, which the view never leaves, and the built
  // campus on it, which the view opens on.
  let site: THREE.Box3 | null = null,
    campus: THREE.Box3 | null = null,
    opened = false;
  let framedAs = "";
  // Bird's-eye view, and the angles to return to afterwards.
  let overhead = false,
    before = { phi: MAP_TILT, theta: 0 };
  const orbit = new THREE.Spherical(),
    offset = new THREE.Vector3();
  // A camera move under way: from one pose to another over GLIDE_MS.
  let glide: { from: Pose; to: Pose; start: number; duration: number; done?: () => void } | null = null;

  // Pixels covered by overlays. A side panel narrows the view; a bottom sheet
  // floats over the map, which only leaves room for it when framing a place.
  let size = { width: 0, height: 0 },
    target = { left: 0, bottom: 0 };
  // The last place or route framed, framed again if a sheet rises just after or grows.
  // `moved`: the visitor has dragged or zoomed since, so it is left where they put it.
  let framed: { bounds: THREE.Box3; pad: number; view?: View; at: number; moved?: boolean } | null = null;
  const ray = new THREE.Raycaster(),
    ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // A visitor's own drag or pinch takes over from any move under way.
  controls.addEventListener("start", () => {
    if (glide) finish(false);
    if (framed) framed.moved = true;
  });

  const pose = (): Pose => ({
    target: controls.target.clone(),
    offset: new THREE.Spherical().setFromVector3(offset.copy(camera.position).sub(controls.target)),
  });
  function apply(p: Pose) {
    controls.target.copy(p.target);
    camera.position.copy(p.target).add(offset.setFromSpherical(p.offset));
    camera.lookAt(controls.target);
  }
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** Move from `from` to where the camera is now, over a short ease-out. */
  function glideFrom(from: Pose, done?: () => void) {
    const to = pose();
    if (glide?.done && glide.done !== done) glide.done();
    glide = null;
    const still =
      from.target.distanceToSquared(to.target) < 1e-4 &&
      Math.abs(from.offset.radius - to.offset.radius) < 1e-3 &&
      Math.abs(from.offset.phi - to.offset.phi) < 1e-4 &&
      Math.abs(from.offset.theta - to.offset.theta) < 1e-4;
    if (still || reduced()) return done?.();
    glide = { from, to, start: performance.now(), duration: GLIDE_MS, done };
    apply(from);
  }
  /**
   * Start a new move: returns where the camera shows now, to glide from, and
   * puts the camera where any move under way was heading, to work out the next
   * destination from.
   */
  function begin() {
    const from = pose();
    finish(true);
    return from;
  }
  /** End the move under way: at its destination, or where it is now. */
  function finish(arrive: boolean) {
    if (!glide) return;
    const { to, done } = glide;
    glide = null;
    if (arrive) apply(to);
    done?.();
  }

  function project() {
    const { width, height } = size;
    if (presentation) {
      // Frame the campus beside the side panel.
      const inset = Math.min(target.left, width / 2);
      camera.aspect = (width + inset) / height;
      camera.setViewOffset(width + inset, height, 0, 0, width, height);
    } else camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  /**
   * Match the viewport. On the map, render the right-hand part of a wider
   * frame, so the campus sits clear of a panel of `insetLeft` pixels on the
   * left. A sheet of `insetBottom` pixels floats over the bottom; places
   * framed from now on sit above it. Returns false when nothing changed.
   */
  function frame(width: number, height: number, insetLeft = 0, insetBottom = 0) {
    const key = `${width}:${height}:${insetLeft}:${insetBottom}:${overhead}`;
    if (!width || !height || key === framedAs) return false;
    const risen = insetBottom !== target.bottom;
    framedAs = key;
    size = { width, height };
    target = { left: insetLeft, bottom: insetBottom };
    project();
    // A sheet opening with the place it shows, growing over it (a route's steps) or
    // shrinking: keep the place in the clear part, unless the visitor has moved the map.
    if (risen && framed && (!framed.moved || performance.now() - framed.at < 700))
      frameRoute(framed.bounds, framed.pad, framed.view);
    return true;
  }

  /**
   * How far back the camera must be, looking from its current direction, for
   * `box` to fill the part of the view the overlays leave clear: across the
   * width beside the side panel, down to the top of the sheet, and up to just
   * under the search bar. With `cover`, it may run off the view the tight
   * way, meeting halfway between fitting it and filling the view with it.
   * Without `sheet`, the whole height counts, as if no sheet were open.
   */
  function fitDistance(box: THREE.Box3, margin = 0.9, cover = false, sheet = true) {
    const { width, height } = size;
    const inset = Math.min(target.left, width / 2),
      clear = height - (sheet ? Math.min(target.bottom, height * 0.7) : 0),
      // The view angles of the clear part, at the scale of the whole view.
      tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (clear / height),
      tanH = tanV * ((width + inset) / clear);
    // Shares of the half-frame, measured from its centre where the box sits.
    const across = ((width - inset) / (width + inset)) * margin,
      below = margin,
      above = 0.8 * margin;
    const back = offset.copy(camera.position).sub(controls.target).normalize(),
      right =
        Math.abs(back.y) > 0.999
          ? new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
          : new THREE.Vector3(0, 1, 0).cross(back).normalize(),
      up = back.clone().cross(right);
    const centre = box.getCenter(new THREE.Vector3()).setY(0),
      corner = new THREE.Vector3();
    let byWidth = 0,
      byHeight = 0;
    for (let i = 0; i < 8; i++) {
      corner
        .set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
        .sub(centre);
      const x = corner.dot(right),
        y = corner.dot(up),
        z = corner.dot(back);
      byWidth = Math.max(byWidth, z + Math.abs(x) / (tanH * across));
      byHeight = Math.max(byHeight, z + (y > 0 ? y / (tanV * above) : -y / (tanV * below)));
    }
    return cover ? Math.sqrt(byWidth * byHeight) : Math.max(byWidth, byHeight);
  }

  /** Slide the view so `centre`, framed by `fitDistance`, sits in the part above the sheet. */
  function clearOfSheet(centre: THREE.Vector3) {
    const { width, height } = size,
      clear = height - Math.min(target.bottom, height * 0.7);
    if (!width || clear === height) return;
    camera.updateMatrixWorld();
    // Where the centre should show: the middle of the clear part, below the bars
    // that cover the top of a phone's map (search, map controls), as `project`
    // places it for the whole view.
    const inset = Math.min(target.left, width / 2),
      top = width < height ? Math.min(PHONE_BARS, clear / 3) : 0;
    ray.setFromCamera(new THREE.Vector2(inset / width, 1 - (top + clear) / height), camera);
    const hit = ray.ray.intersectPlane(ground, new THREE.Vector3());
    if (!hit) return;
    const shift = centre.clone().sub(hit).setY(0);
    camera.position.add(shift);
    controls.target.add(shift);
  }

  /** Point the camera's heading north, keeping its tilt and distance. */
  function northUp() {
    orbit.setFromVector3(offset.copy(camera.position).sub(controls.target));
    orbit.theta = 0;
    camera.position.copy(controls.target).add(offset.setFromSpherical(orbit));
    camera.lookAt(controls.target);
  }

  /** Move along the current view direction to fit the canvas (or the campus, or a framed route). */
  function fit(width: number, height: number, zoom: number) {
    if (routeDistance === null && presentation && site && size.width) {
      const opening = campus ?? site;
      controls.target.copy(opening.getCenter(new THREE.Vector3()).setY(0));
      // Opens north up, like the plan; later refits keep the visitor's heading.
      if (!opened) northUp();
      opened = true;
      // On a phone it opens close in, the campus filling the view and its empty
      // corners running off it; on a wide screen the whole campus shows. Zooming
      // out still shows the whole canvas (see `bound`).
      const cover = size.width < size.height,
        distance = Math.max(controls.minDistance, fitDistance(opening, 1, cover)) * (100 / zoom);
      camera.position.sub(controls.target).normalize().multiplyScalar(distance).add(controls.target);
      clearOfSheet(controls.target.clone());
      return;
    }
    const distance =
      routeDistance ??
      (Math.max(width, height) * 2 * 1.65 * Math.max(1, 0.95 / camera.aspect) * (presentation ? 125 : 100)) /
        zoom;
    camera.position.sub(controls.target).normalize().multiplyScalar(distance).add(controls.target);
  }

  /**
   * On the map, keep the view over this area (the canvas), opening on
   * `built` (the campus) when there is one; null forgets it.
   */
  function frameSite(box: THREE.Box3 | null, zoom: number, built: THREE.Box3 | null = null) {
    site = box && !box.isEmpty() ? box.clone() : null;
    campus = built && !built.isEmpty() ? built.clone() : null;
    if (site && routeDistance === null) fit(0, 0, zoom);
  }

  /** Orbit around the middle of a canvas of `width` × `height` tiles. */
  function centre(width: number, height: number, zoom: number) {
    const offset = camera.position.clone().sub(controls.target);
    controls.target.set(width, 0, height);
    camera.position.copy(controls.target).add(offset);
    fit(width, height, zoom);
  }

  /**
   * On the map, keep the view over the canvas: no zooming out past the
   * distance that fits it, no panning its centre off it. Call after the
   * controls update.
   */
  function bound() {
    if (!site || !size.width) return;
    controls.maxDistance = Math.max(controls.minDistance, fitDistance(site, 1, false, false) * 1.05);
    const t = controls.target,
      x = THREE.MathUtils.clamp(t.x, site.min.x, site.max.x),
      z = THREE.MathUtils.clamp(t.z, site.min.z, site.max.z);
    if (x === t.x && z === t.z) return;
    camera.position.x += x - t.x;
    camera.position.z += z - t.z;
    t.set(x, t.y, z);
  }

  /** Scale the viewing distance when the zoom level changes. */
  function zoomBy(ratio: number) {
    camera.position.sub(controls.target).multiplyScalar(ratio).add(controls.target);
  }

  /**
   * Look down on a route (or a highlighted place) steeply, so trees and walls
   * don't hide it; null releases it. `pad` metres at least are kept clear
   * around it: routes keep the rooms around them in view, a single place is
   * framed closer. With a `view`, on the map, it looks from that angle: from
   * in front of a room's door (`doorView`) or along the way ahead
   * (`aheadView`). On the map the camera glides there.
   */
  function frameRoute(bounds: THREE.Box3 | null, pad = 8, view?: View) {
    const from = begin();
    routeDistance = null;
    framed = bounds && { bounds: bounds.clone(), pad, view, at: performance.now() };
    if (!bounds) {
      // Back to the whole campus once a route is cleared.
      if (site) {
        fit(0, 0, 100);
        if (presentation) glideFrom(from);
      }
      return;
    }
    const centre = bounds.getCenter(new THREE.Vector3()).setY(0),
      extent = bounds.getSize(new THREE.Vector3());
    orbit.setFromVector3(offset.copy(camera.position).sub(controls.target));
    // Keeps the visitor's heading, and their tilt if it is already steeper,
    // unless a view is asked for (in the top view only its heading).
    const angle = presentation ? view : undefined,
      tilt = overhead
        ? OVERHEAD
        : angle
          ? angle.tilt
          : presentation
            ? Math.min(orbit.phi, FRAME_TILT)
            : Math.PI / 2 - 0.87,
      direction = new THREE.Vector3().setFromSphericalCoords(1, tilt, angle ? angle.theta : orbit.theta);
    // Look from the final direction first: the fit depends on it. Short
    // routes are padded so the rooms around them stay in view.
    controls.target.copy(centre);
    camera.position.copy(centre).add(direction);
    camera.lookAt(centre);
    const padded = bounds
      .clone()
      .expandByVector(new THREE.Vector3(Math.max(pad, extent.x * 0.25), 0, Math.max(pad, extent.z * 0.25)));
    routeDistance = size.width
      ? Math.max(angle?.near ?? 30, fitDistance(padded))
      : Math.max(60, Math.max(extent.x, extent.z) * 3.2) * Math.max(1, 1.1 / camera.aspect);
    camera.position.copy(centre).addScaledVector(direction, routeDistance);
    clearOfSheet(centre);
    if (presentation) glideFrom(from);
  }

  /** Turn the map so north is up again, keeping its tilt. */
  function faceNorth() {
    const from = begin();
    northUp();
    glideFrom(from);
  }

  /**
   * Switch the bird's-eye view on or off; the camera glides there. Returns
   * false when nothing changed.
   */
  function setOverhead(on: boolean) {
    if (on === overhead) return false;
    const from = begin(),
      settled = pose().offset;
    overhead = on;
    if (on) before = { phi: settled.phi, theta: settled.theta };
    // Overhead faces north, like the plan: the camera sits south (+z) of its target.
    const goal = on ? { phi: OVERHEAD, theta: 0 } : before;
    // Free the orbit limits while gliding; they are set on arrival.
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = lowest;
    orbit.set(settled.radius, goal.phi, goal.theta);
    camera.position.copy(controls.target).add(offset.setFromSpherical(orbit));
    camera.lookAt(controls.target);
    // Overhead, dragging turns the map but can't tip the camera back down.
    glideFrom(from, () => {
      if (overhead) controls.maxPolarAngle = OVERHEAD;
    });
    return true;
  }

  /** Advance a camera move; call once per frame. Returns true while the camera is moving. */
  function tick(now = performance.now()) {
    if (!glide) return false;
    const { from, to, start, duration } = glide,
      t = Math.min(1, (now - start) / duration),
      // Ease out: fast off the mark, settling gently.
      k = 1 - Math.pow(1 - t, 3);
    const turn = Math.atan2(Math.sin(to.offset.theta - from.offset.theta), Math.cos(to.offset.theta - from.offset.theta));
    orbit.set(
      THREE.MathUtils.lerp(from.offset.radius, to.offset.radius, k),
      THREE.MathUtils.lerp(from.offset.phi, to.offset.phi, k),
      from.offset.theta + turn * k,
    );
    controls.target.lerpVectors(from.target, to.target, k);
    camera.position.copy(controls.target).add(offset.setFromSpherical(orbit));
    camera.lookAt(controls.target);
    if (t >= 1) finish(true);
    return true;
  }

  return {
    camera,
    setOverhead,
    faceNorth,
    tick,
    controls,
    frame,
    fit,
    centre,
    zoomBy,
    frameRoute,
    frameSite,
    bound,
    /** Where the camera is heading, in radians: 0 when north is up. */
    heading: () => (glide ? glide.to.offset.theta : controls.getAzimuthalAngle()),
    /** Distance from the camera to the point it orbits, where it is going to be when it is moving. */
    focusDistance: () => (glide ? glide.to.offset.radius : camera.position.distanceTo(controls.target)),
  };
}
