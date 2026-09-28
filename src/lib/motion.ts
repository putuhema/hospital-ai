// Motion shared by the map's mobile layout. The same curves are in CSS as
// custom properties on `.mobile-map` (see MobileMap.svelte).

/** A CSS `cubic-bezier()` as an easing function for Svelte transitions. */
export function bezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (t: number, a: number, b: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const slope = (t: number, a: number, b: number) =>
    3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;
  return (x: number) => {
    if (x <= 0 || x >= 1) return x;
    // Newton's method finds the curve parameter for this x.
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t -= (at(t, x1, x2) - x) / d;
    }
    return at(Math.min(1, Math.max(0, t)), y1, y2);
  };
}

/** Strong ease-out: things entering or answering a tap. */
export const easeOut = bezier(0.23, 1, 0.32, 1);
/** The iOS sheet curve. */
export const easeDrawer = bezier(0.32, 0.72, 0, 1);

/** The duration, or none when the visitor asked for less motion. */
export const motion = (ms: number) =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : ms;

/** Fade in from a slight blur, for content swapped in place. */
export function unblur(_: Element, { duration = 220 } = {}) {
  return {
    duration: motion(duration),
    easing: easeOut,
    css: (t: number) => `opacity: ${t}; filter: blur(${(1 - t) * 4}px)`,
  };
}

/** Fade and rise a few pixels, with an optional delay for staggered lists. */
export function rise(_: Element, { delay = 0, duration = 320, y = 8 } = {}) {
  return {
    delay: motion(delay),
    duration: motion(duration),
    easing: easeOut,
    css: (t: number, u: number) => `opacity: ${t}; transform: translateY(${u * y}px)`,
  };
}

/** Fade and scale from 0.96, for popovers and buttons that appear. */
export function pop(_: Element, { duration = 200, from = 0.96 } = {}) {
  return {
    duration: motion(duration),
    easing: easeOut,
    css: (t: number) => `opacity: ${t}; transform: scale(${from + (1 - from) * t})`,
  };
}
