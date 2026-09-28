import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** The map renders the top of a frame this much taller, leaving room for sky. */
const SKY_FRAME = 1.4;
/** Normal orbit limit: never below the horizon. */
const LOWEST = Math.PI / 2.15;
/** Polar angle of the bird's-eye view: straight down, nudged so the camera keeps a heading. */
const OVERHEAD = 1e-4;

/** Camera, orbit controls and how the view is framed around the campus or a route. */
export function createCameraRig(dom: HTMLElement, presentation: boolean) {
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1500);
  // The map uses a lower, scenic angle so the horizon and sky show.
  camera.position.set(59, presentation ? 16 : 53, 67);
  const controls = new OrbitControls(camera, dom);
  controls.target.set(24, 0, 20);
  controls.enableDamping = true;
  controls.maxPolarAngle = LOWEST;
  controls.minDistance = 15;
  controls.maxDistance = 900;

  // Set while a route is framed, so resizing keeps the route in view.
  let routeDistance: number | null = null;
  let framedAs = "";
  // Bird's-eye view: the angles to glide to, and the view to return to afterwards.
  let overhead = false,
    goal: { phi: number; theta: number } | null = null,
    before = { phi: 0.9, theta: 0 };
  const orbit = new THREE.Spherical(),
    offset = new THREE.Vector3();

  /**
   * Match the viewport. On the map, render the top-right part of a larger
   * frame: the campus sits lower (sky above it) and clear of a panel of
   * `inset` pixels on the left. Returns false when nothing changed.
   */
  function frame(width: number, height: number, insetLeft = 0) {
    const inset = Math.min(insetLeft, width / 2),
      key = `${width}:${height}:${inset}:${overhead}`;
    if (!width || !height || key === framedAs) return false;
    framedAs = key;
    if (presentation) {
      // Looking straight down there is no sky to leave room for.
      const tall = overhead ? 1 : SKY_FRAME;
      camera.aspect = (width + inset) / (height * tall);
      camera.setViewOffset(width + inset, height * tall, 0, 0, width, height);
    } else camera.aspect = width / height;
    camera.updateProjectionMatrix();
    return true;
  }

  /** Move along the current view direction to fit the canvas (or a framed route). */
  function fit(width: number, height: number, zoom: number) {
    const distance =
      routeDistance ??
      (Math.max(width, height) * 2 * 1.65 * Math.max(1, 0.95 / camera.aspect) * (presentation ? 125 : 100)) /
        zoom;
    camera.position.sub(controls.target).normalize().multiplyScalar(distance).add(controls.target);
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
    if (!bounds) return;
    const centre = bounds.getCenter(new THREE.Vector3()).setY(0),
      size = bounds.getSize(new THREE.Vector3()),
      direction = camera.position.clone().sub(controls.target).setY(0).normalize(),
      elevation = overhead ? Math.PI / 2 - OVERHEAD : 0.87;
    direction.multiplyScalar(Math.cos(elevation)).setY(Math.sin(elevation));
    routeDistance = Math.max(60, Math.max(size.x, size.z) * 3.2) * Math.max(1, 1.1 / camera.aspect);
    controls.target.copy(centre);
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

  /** Advance the glide to or from the bird's-eye view; call once per frame. */
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
    /** Distance from the camera to the point it orbits. */
    focusDistance: () => camera.position.distanceTo(controls.target),
  };
}
