import { createStepDetector, createTurnDetector, yawRate } from "./motion.ts";

/**
 * Whether the phone is reading the visitor's walking: `asking` while iOS
 * asks for motion access, `on` once readings arrive, `denied` when access
 * was refused, `unavailable` when the device has no motion sensors (a laptop).
 */
export type SensorState = "asking" | "on" | "denied" | "unavailable";

type Permission = { requestPermission?: () => Promise<"granted" | "denied"> };

/**
 * Start reading steps and turns from the phone's motion sensors. Call it from
 * a tap: iOS only asks for motion access in answer to one. Returns a function
 * that stops it.
 */
export function startWalkSensor(on: {
  step: (time: number) => void;
  /** Degrees turned, positive left. */
  turn: (angle: number) => void;
  state: (state: SensorState) => void;
}) {
  let stopped = false,
    listening = false,
    heard = false;
  const steps = createStepDetector(),
    turns = createTurnDetector();
  // Some phones report gravity upside down. Held to be read, the screen faces
  // up and the top points away, so the readings for "up" should be positive.
  let upright = 0;

  function sample(e: DeviceMotionEvent) {
    const g = e.accelerationIncludingGravity,
      r = e.rotationRate;
    if (!g || g.x === null || g.y === null || g.z === null) return;
    if (!heard) {
      heard = true;
      on.state("on");
    }
    const time = e.timeStamp;
    if (steps(Math.hypot(g.x, g.y, g.z), time)) on.step(time);
    upright += ((g.y + g.z) - upright) * 0.02;
    if (r && r.alpha !== null && r.beta !== null && r.gamma !== null) {
      const rate = yawRate({ x: g.x, y: g.y, z: g.z }, { alpha: r.alpha, beta: r.beta, gamma: r.gamma });
      const angle = turns(upright < 0 ? -rate : rate, time);
      if (angle !== null) on.turn(angle);
    }
  }

  function listen() {
    if (stopped) return;
    listening = true;
    addEventListener("devicemotion", sample);
    // A laptop has the event but never fires it.
    setTimeout(() => {
      if (!stopped && !heard) on.state("unavailable");
    }, 2500);
  }

  const Motion = (globalThis as { DeviceMotionEvent?: Permission }).DeviceMotionEvent;
  if (!Motion) on.state("unavailable");
  else if (typeof Motion.requestPermission === "function") {
    on.state("asking");
    Motion.requestPermission()
      .then((answer) => (answer === "granted" ? listen() : on.state("denied")))
      .catch(() => on.state("denied"));
  } else listen();

  return () => {
    stopped = true;
    if (listening) removeEventListener("devicemotion", sample);
  };
}
