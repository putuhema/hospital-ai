/**
 * Walking read from a phone's motion sensors: steps from the accelerometer,
 * turns from the gyroscope. The gyroscope measures how far the body turned,
 * which indoors is far more reliable than the compass (steel and concrete
 * throw it off). Pure functions of sensor samples, so they can be tested.
 */

/** Earth's gravity, m/s². */
const G = 9.81;

/**
 * Steps from the size of the acceleration (gravity included), sampled about
 * 60 times a second: each step is a bump well above gravity, after a dip back
 * below it. Returns a function to feed samples to; it says true on a step.
 */
export function createStepDetector({
  /** How far above gravity (m/s², smoothed) a bump must reach to count. */
  threshold = 1.1,
  /** No two steps closer than this (ms): faster than anyone walks. */
  minGap = 280,
} = {}) {
  let smooth = G,
    baseline = G,
    armed = true,
    last = -Infinity;
  return (magnitude: number, time: number) => {
    // Smooth out the jitter; the baseline follows the slow part (gravity, tilt).
    smooth += (magnitude - smooth) * 0.35;
    baseline += (magnitude - baseline) * 0.02;
    const lift = smooth - baseline;
    if (lift < 0.2) armed = true;
    if (!armed || lift < threshold || time - last < minGap) return false;
    armed = false;
    last = time;
    return true;
  };
}

/** One sample's turning speed about the vertical (deg/s): positive is to the left (anticlockwise from above). */
export function yawRate(
  gravity: { x: number; y: number; z: number },
  rotation: { alpha: number; beta: number; gamma: number },
) {
  // The device reports rotation about its own axes (beta x, gamma y, alpha z);
  // the part about "up", which gravity gives in the same axes, is the turn of the body.
  const length = Math.hypot(gravity.x, gravity.y, gravity.z);
  if (length < 1) return 0;
  return (rotation.beta * gravity.x + rotation.gamma * gravity.y + rotation.alpha * gravity.z) / length;
}

/**
 * Turns from the turning speed about the vertical. A turn is reported once
 * it is over (the body steady again), as the angle turned in degrees:
 * positive left, negative right. Returns a function to feed samples to.
 */
export function createTurnDetector({
  /** Smallest turn reported (degrees): less is a wiggle or a bend in the corridor. */
  minAngle = 35,
  /** Below this turning speed (deg/s) the body is steady. */
  steady = 25,
  /** How long (ms) it must stay steady before the turn counts as finished. */
  settle = 400,
} = {}) {
  let turning = 0,
    steadySince = -Infinity,
    last = -Infinity;
  return (rate: number, time: number): number | null => {
    const dt = Math.min(0.1, Math.max(0, (time - last) / 1000));
    last = time;
    if (Math.abs(rate) > steady) {
      turning += rate * dt;
      steadySince = time;
      return null;
    }
    // Slow drift adds up too, but only while a turn is under way.
    if (turning) turning += rate * dt;
    if (time - steadySince < settle) return null;
    const angle = turning;
    turning = 0;
    return Math.abs(angle) >= minAngle ? angle : null;
  };
}
