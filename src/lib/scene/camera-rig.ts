import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** The map renders the top of a frame this much taller, leaving room for sky. */
const SKY_FRAME = 1.4;
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
  controls.minDistance = 15;
  controls.maxDistance = 900;

  // Set while a route is framed, so resizing keeps the route in view.
  let routeDistance: number | null = null;
  // On the map: the built campus, framed instead of the whole canvas.
  let site: THREE.Box3 | null = null;
  let framedAs = "";
  // Bird's-eye view: the angles to glide to, and the view to return to afterwards.
  let overhead = false,
    goal: { phi: number; theta: number } | null = null,
    before = { phi: 0.9, theta: 0 };
  const orbit = new THREE.Spherical(),
    offset = new THREE.Vector3();

  // Pixels covered by overlays: where the frame is heading and where it is now.
  // The bottom inset (a sheet sliding up) glides there over a few frames.
  let size = { width: 0, height: 0 },
    target = { left: 0, bottom: 0 },
    shown = { left: 0, bottom: 0 };

  function skyFrame() {
    // Looking straight down there is no sky to leave room for.
    if (overhead) return 1;
    return size.width < size.height ? SKY_FRAME_PORTRAIT : SKY_FRAME;
  }

  function project() {
    const { width, height } = size;
    if (presentation) {
      // Frame the campus in the part of the view the overlays leave clear,
      // then extend the view down behind the bottom overlay.
      const inset = Math.min(shown.left, width / 2),
        clear = height - Math.min(shown.bottom, height * 0.7),
        tall = skyFrame();
      camera.aspect = (width + inset) / (clear * tall);
      camera.setViewOffset(width + inset, clear * tall, 0, 0, width, height);
    } else camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  /**
   * Match the viewport. On the map, render the top-right part of a larger
   * frame: the campus sits lower (sky above it) and clear of a panel of
   * `insetLeft` pixels on the left and a sheet of `insetBottom` pixels at the
   * bottom. Returns false when nothing changed.
   */
  function frame(width: number, height: number, insetLeft = 0, insetBottom = 0) {
    const key = `${width}:${height}:${insetLeft}:${insetBottom}:${overhead}`;
    if (!width || !height || key === framedAs) return false;
    const first = !framedAs;
    framedAs = key;
    size = { width, height };
    target = { left: insetLeft, bottom: insetBottom };
    shown.left = insetLeft;
    if (first || matchMedia("(prefers-reduced-motion: reduce)").matches) shown.bottom = insetBottom;
    project();
    return true;
  }

  /**
   * How far back the camera must be, looking from its current direction, for
   * `box` to fill the part of the view the overlays leave clear: across the
   * width beside the side panel, down to the top of the sheet, and up to just
   * under the search bar.
   */
  function fitDistance(box: THREE.Box3, margin = 0.9) {
    const { width, height } = size;
    const inset = Math.min(target.left, width / 2),
      clear = height - Math.min(target.bottom, height * 0.7),
      tall = skyFrame(),
      tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)),
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
    let distance = 0;
    for (let i = 0; i < 8; i++) {
      corner
        .set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
        .sub(centre);
      const x = corner.dot(right),
        y = corner.dot(up),
        z = corner.dot(back);
      distance = Math.max(
        distance,
        z + Math.abs(x) / (tanH * across),
        z + (y > 0 ? y / (tanV * above) : -y / (tanV * below)),
      );
    }
    return distance;
  }

  /** Move along the current view direction to fit the canvas (or the campus, or a framed route). */
  function fit(width: number, height: number, zoom: number) {
    if (routeDistance === null && presentation && site && size.width) {
      controls.target.copy(site.getCenter(new THREE.Vector3()).setY(0));
      const distance = Math.max(controls.minDistance, fitDistance(site)) * (100 / zoom);
      camera.position.sub(controls.target).normalize().multiplyScalar(distance).add(controls.target);
      return;
    }
    const distance =
      routeDistance ??
      (Math.max(width, height) * 2 * 1.65 * Math.max(1, 0.95 / camera.aspect) * (presentation ? 125 : 100)) /
        zoom;
    camera.position.sub(controls.target).normalize().multiplyScalar(distance).add(controls.target);
  }

  /** On the map, frame the built campus rather than the whole canvas; null forgets it. */
  function frameSite(box: THREE.Box3 | null, zoom: number) {
    site = box && !box.isEmpty() ? box.clone() : null;
    if (site && routeDistance === null) fit(0, 0, zoom);
  }

  /** Orbit around the middle of a canvas of `width` × `height` tiles. */
  function centre(width: number, height: number, zoom: number) {
    const offset = camera.position.clone().sub(controls.target);
    controls.target.set(width, 0, height);
    camera.position.copy(controls.target).add(offset);
    fit(width, height, zoom);
  }

  /** Scale the viewing distance when the zoom level changes. */
  function zoomBy(ratio: number) {
    camera.position.sub(controls.target).multiplyScalar(ratio).add(controls.target);
  }

  /** Look down on a route from about 50° so trees and walls don't hide it; null releases it. */
  function frameRoute(bounds: THREE.Box3 | null) {
    routeDistance = null;
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
      .expandByVector(new THREE.Vector3(Math.max(8, extent.x * 0.25), 0, Math.max(8, extent.z * 0.25)));
    routeDistance = size.width
      ? Math.max(30, fitDistance(padded))
      : Math.max(60, Math.max(extent.x, extent.z) * 3.2) * Math.max(1, 1.1 / camera.aspect);
    camera.position.copy(centre).addScaledVector(direction, routeDistance);
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

  /** Advance the glides (bird's-eye view, bottom inset); call once per frame. */
  function tick(step = 0.14) {
    if (shown.bottom !== target.bottom) {
      const gap = target.bottom - shown.bottom;
      shown.bottom = Math.abs(gap) < 0.5 ? target.bottom : shown.bottom + gap * 0.16;
      project();
    }
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
    /** Distance from the camera to the point it orbits. */
    focusDistance: () => camera.position.distanceTo(controls.target),
  };
}
