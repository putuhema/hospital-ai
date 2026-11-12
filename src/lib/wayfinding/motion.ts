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
 * How far the visitor has turned lately: the turning (degrees, positive left)
 * within the last `seconds`, and when that turn began. Read while they are
 * still turning, so a turn at a junction counts as soon as it is clear, not
 * once they have walked on. Turning slower than `drift` (deg/s) is the sensor
 * wandering and doesn't count.
 */
export function createTurnWindow({ seconds = 2.5, drift = 3, starting = 15 } = {}) {
  let samples: { time: number; angle: number; fast: boolean }[] = [];
  return {
    /** A sample: turning speed (deg/s) over `dt` seconds, at `time` (ms). */
    add(rate: number, dt: number, time: number) {
      if (Math.abs(rate) > drift) samples.push({ time, angle: rate * dt, fast: Math.abs(rate) > starting });
      samples = samples.filter((s) => time - s.time <= seconds * 1000);
      const angle = samples.reduce((sum, s) => sum + s.angle, 0);
      // The turn began with the first brisk turning still in the window.
      const start = samples.find((s) => s.fast)?.time ?? time;
      return { angle, start };
    },
    clear() {
      samples = [];
    },
  };
}
