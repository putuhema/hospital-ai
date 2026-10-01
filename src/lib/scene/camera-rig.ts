import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** The map renders the top of a frame this much taller, leaving room for sky. */
const SKY_FRAME = 1.25;
/** Less on a portrait phone, where the search bar already covers the top. */
const SKY_FRAME_PORTRAIT = 1.2;
/** Normal orbit limit: never below the horizon. */
const LOWEST = Math.PI / 2.15;
/** Polar angle of the bird's-eye view: straight down, nudged so the camera keeps a heading. */
const OVERHEAD = 1e-4;

/** Camera, orbit controls and how the view is framed around the campus or a route. */
export function createCameraRig(dom: HTMLElement, presentation: boolean) {
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1500);
  // The map uses a lower, scenic angle so the horizon and sky show, but
  // high enough to see into the campus.
  camera.position.set(59, presentation ? 30 : 53, 67);
  const controls = new OrbitControls(camera, dom);
  controls.target.set(24, 0, 20);
  controls.enableDamping = true;
  controls.maxPolarAngle = LOWEST;
  // The map lets you get closer; how far out is set by the canvas (see `bound`).
  controls.minDistance = presentation ? 6 : 15;
  controls.maxDistance = 900;

  // Set while a route is framed, so resizing keeps the route in view.
  let routeDistance: number | null = null;
  // On the map: the canvas, which the view never leaves, and the built
  // campus on it, which the view opens on.
  let site: THREE.Box3 | null = null,
    campus: THREE.Box3 | null = null;
  let framedAs = "";
  // Bird's-eye view: the angles to glide to, and the view to return to afterwards.
  let overhead = false,
    goal: { phi: number; theta: number } | null = null,
    before = { phi: 0.9, theta: 0 };
  const orbit = new THREE.Spherical(),
    offset = new THREE.Vector3();

  // Pixels covered by overlays. A side panel narrows the view; a bottom sheet
  // floats over the map, which only leaves room for it when framing a place.
  let size = { width: 0, height: 0 },
    target = { left: 0, bottom: 0 };
  // The last place or route framed, framed again if a sheet rises just after or grows.
  let framed: { bounds: THREE.Box3; pad: number; at: number } | null = null;
  const ray = new THREE.Raycaster(),
    ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function skyFrame() {
    // Looking straight down there is no sky to leave room for.
    if (overhead) return 1;
    return size.width < size.height ? SKY_FRAME_PORTRAIT : SKY_FRAME;
  }

  function project() {
    const { width, height } = size;
    if (presentation) {
      // Frame the campus beside the side panel, sitting low with sky above it.
      const inset = Math.min(target.left, width / 2),
        tall = skyFrame();
      camera.aspect = (width + inset) / (height * tall);
      camera.setViewOffset(width + inset, height * tall, 0, 0, width, height);
    } else camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  /**
   * Match the viewport. On the map, render the top-right part of a larger
   * frame: the campus sits lower (sky above it) and clear of a panel of
   * `insetLeft` pixels on the left. A sheet of `insetBottom` pixels floats
   * over the bottom; places framed from now on sit above it. Returns false
   * when nothing changed.
   */
  function frame(width: number, height: number, insetLeft = 0, insetBottom = 0) {
    const key = `${width}:${height}:${insetLeft}:${insetBottom}:${overhead}`;
    if (!width || !height || key === framedAs) return false;
    const risen = insetBottom !== target.bottom,
      grew = insetBottom > target.bottom;
    framedAs = key;
    size = { width, height };
    target = { left: insetLeft, bottom: insetBottom };
    project();
    // A sheet opening with the place it shows, or growing over it (a route's steps): keep the place above it.
    if (risen && framed && (grew || performance.now() - framed.at < 700)) frameRoute(framed.bounds, framed.pad);
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
      tall = skyFrame(),
      // The view angles of the clear part, at the scale of the whole view.
      tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (clear / height),
      tanH = tanV * ((width + inset) / (clear * tall));
    // Shares of the half-frame, measured from its centre where the box sits.
    const across = ((width - inset) / (width + inset)) * margin,
      below = (2 / tall - 1) * margin,
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
    // Where the centre should show: middle of the clear part's frame, as `project` places it for the whole view.
    const inset = Math.min(target.left, width / 2);
    ray.setFromCamera(new THREE.Vector2(inset / width, 1 - (clear * skyFrame()) / height), camera);
    const hit = ray.ray.intersectPlane(ground, new THREE.Vector3());
    if (!hit) return;
    const shift = centre.clone().sub(hit).setY(0);
    camera.position.add(shift);
    controls.target.add(shift);
  }

  /**
   * Look at a long campus from its side, so it runs across a wide screen (or
   * up a tall one) and fills it, rather than end-on and far away. Keeps the
   * camera's height angle; used when the view opens on the campus.
   */
  function turnAlong(box: THREE.Box3) {
    const extent = box.getSize(new THREE.Vector3()),
      wide = size.width >= size.height,
      // From the south-east, the start view; from the east-south-east when a deep campus should run across.
      across = wide ? extent.z > extent.x * 1.2 : extent.x > extent.z * 1.2,
      heading = across ? new THREE.Vector3(1, 0, 0.45) : new THREE.Vector3(0.6, 0, 0.8);
    orbit.setFromVector3(offset.copy(camera.position).sub(controls.target));
    const polar = orbit.phi,
      radius = orbit.radius;
    orbit.setFromVector3(heading);
    orbit.set(radius, polar, orbit.theta);
    camera.position.copy(controls.target).add(offset.setFromSpherical(orbit));
    camera.lookAt(controls.target);
  }

  /** Move along the current view direction to fit the canvas (or the campus, or a framed route). */
  function fit(width: number, height: number, zoom: number) {
    if (routeDistance === null && presentation && site && size.width) {
      const opening = campus ?? site;
      controls.target.copy(opening.getCenter(new THREE.Vector3()).setY(0));
      if (!overhead) turnAlong(opening);
      // Opens close in, the campus filling the view and its empty corners
      // running off it; zooming out still shows the whole canvas (see `bound`).
      const distance = Math.max(controls.minDistance, fitDistance(opening, 1, true)) * (100 / zoom);
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
   * Look down on a route (or a highlighted place) from about 50° so trees and
   * walls don't hide it; null releases it. `pad` metres at least are kept
   * clear around it: routes keep the rooms around them in view, a single
   * place is framed closer.
   */
  function frameRoute(bounds: THREE.Box3 | null, pad = 8) {
    routeDistance = null;
    framed = bounds && { bounds: bounds.clone(), pad, at: performance.now() };
    if (!bounds) {
      // Back to the whole campus once a route is cleared.
      if (site) fit(0, 0, 100);
      return;
    }
    const centre = bounds.getCenter(new THREE.Vector3()).setY(0),
      extent = bounds.getSize(new THREE.Vector3()),
      direction = camera.position.clone().sub(controls.target).setY(0).normalize(),
      elevation = overhead ? Math.PI / 2 - OVERHEAD : 0.87;
    direction.multiplyScalar(Math.cos(elevation)).setY(Math.sin(elevation));
    // Look from the final direction first: the fit depends on it. Short
    // routes are padded so the rooms around them stay in view.
    controls.target.copy(centre);
    camera.position.copy(centre).add(direction);
    camera.lookAt(centre);
    const padded = bounds
      .clone()
      .expandByVector(new THREE.Vector3(Math.max(pad, extent.x * 0.25), 0, Math.max(pad, extent.z * 0.25)));
    routeDistance = size.width
      ? Math.max(30, fitDistance(padded))
      : Math.max(60, Math.max(extent.x, extent.z) * 3.2) * Math.max(1, 1.1 / camera.aspect);
    camera.position.copy(centre).addScaledVector(direction, routeDistance);
    clearOfSheet(centre);
  }

  /**
   * Switch the bird's-eye view on or off. The camera glides there over a few
   * frames (see `tick`); with reduced motion it jumps. Returns false when
   * nothing changed.
   */
  function setOverhead(on: boolean) {
    if (on === overhead) return false;
    overhead = on;
    orbit.setFromVector3(offset.copy(camera.position).sub(controls.target));
    if (on) before = { phi: orbit.phi, theta: orbit.theta };
    // Overhead faces north, like the plan: the camera sits south (+z) of its target.
    goal = on ? { phi: OVERHEAD, theta: 0 } : before;
    // Free the orbit limits while gliding; `tick` sets them when it arrives.
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = LOWEST;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) tick(1);
    return true;
  }

  /** Advance the bird's-eye glide; call once per frame. */
  function tick(step = 0.14) {
    if (goal === null) return;
    orbit.setFromVector3(offset.copy(camera.position).sub(controls.target));
    // Turn the short way round.
    const turn = Math.atan2(Math.sin(goal.theta - orbit.theta), Math.cos(goal.theta - orbit.theta));
    orbit.phi += (goal.phi - orbit.phi) * step;
    orbit.theta += turn * step;
    if (Math.abs(goal.phi - orbit.phi) < 0.002 && Math.abs(turn) < 0.002) {
      orbit.phi = goal.phi;
      orbit.theta = goal.theta;
      goal = null;
      // Overhead, dragging turns the map but can't tip the camera back down.
      if (overhead) controls.maxPolarAngle = OVERHEAD;
    }
    camera.position.copy(controls.target).add(offset.setFromSpherical(orbit));
    camera.lookAt(controls.target);
  }

  return {
    camera,
    setOverhead,
    tick,
    controls,
    frame,
    fit,
    centre,
    zoomBy,
    frameRoute,
    frameSite,
    bound,
    /** Distance from the camera to the point it orbits. */
    focusDistance: () => camera.position.distanceTo(controls.target),
  };
}
