import type { Route, Step } from "./routing.ts";

/** An average adult step, in metres. */
export const STRIDE = 0.7;

/** Expected turn for a step, in degrees: positive left, negative right (as `createTurnDetector` reports). */
function expectedTurn(step: Step | undefined): number | null {
  if (step?.say.kind !== "turn") return null;
  return { left: 90, right: -90, "bear-left": 45, "bear-right": -45, around: 180, straight: 0 }[step.say.turn];
}

/** Metres from each step's start to the next step's (the arrival step is 0 long). */
export function legLengths(route: Route) {
  const { points, steps } = route;
  return steps.map((step, i) => {
    const end = steps[i + 1]?.at ?? step.at;
    let metres = 0;
    for (let k = step.at + 1; k <= end; k++)
      metres += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y) * 2;
    return metres;
  });
}

/**
 * Follows a visitor along a route from their steps and turns, so they don't
 * have to tick off each instruction. `done` is how many steps are behind them
 * (as the steps list counts them) and `along` how far into the current one
 * they have walked. A turn the route expects ends a stretch, and puts them
 * exactly at that corner, clearing what step counting got wrong; with no turn
 * felt, a stretch ends only well past its length (the visitor can tap).
 * Ticking a step by hand (`sync`) overrides it.
 *
 * The map may not be drawn to the hospital's true size, so each corner
 * reached also teaches it `scale`: map metres per metre walked. Start from
 * what an earlier route taught, kept on the phone.
 */
export function createFollower(route: Route, { stride = STRIDE, scale = 1 } = {}) {
  const legs = legLengths(route),
    last = route.steps.length;
  let done = 0,
    along = 0,
    /** Steps counted in the current stretch. */
    taken = 0;

  function advance() {
    done++;
    along = 0;
    taken = 0;
    // The arrival is the end of the last stretch, not a stretch of its own.
    if (done === last - 1) done = last;
  }

  return {
    get done() {
      return done;
    },
    /** Metres into the current stretch, never past its end. */
    get along() {
      return Math.min(along, legs[done] ?? 0);
    },
    /** Map metres per metre walked, as learned so far. */
    get scale() {
      return scale;
    },
    /** One step taken. Returns true when it finished a stretch. */
    step() {
      if (done >= last) return false;
      taken++;
      along += stride * scale;
      const length = legs[done];
      if (along < length) return false;
      // A straight-on step (into a corridor, say) ends on distance; a turn waits
      // at the corner to be felt, unless they have walked twice as far and more.
      const slack = expectedTurn(route.steps[done + 1]) ? length + 4 : 0;
      if (along - length < slack) return false;
      advance();
      return true;
    },
    /** A turn felt, in degrees (positive left). Returns true when it was the route's next turn. */
    turn(angle: number) {
      if (done >= last - 1) return false;
      const expected = expectedTurn(route.steps[done + 1]);
      if (!expected) return false;
      const sameWay = Math.abs(expected) >= 150 || Math.sign(angle) === Math.sign(expected);
      // About the turn the route makes there, and some way along: not a turn
      // just after the last corner, however far off the scale still is.
      if (!sameWay || Math.abs(angle) < Math.abs(expected) * 0.5 || along < legs[done] * 0.35) return false;
      // The corner is where the map says: learn how many map metres a step really covers.
      if (taken >= 4 && legs[done] >= 3)
        scale = Math.min(2.5, Math.max(0.3, scale * 0.4 + (legs[done] / (taken * stride)) * 0.6));
      advance();
      return true;
    },
    /** The visitor ticked steps by hand: follow on from there. */
    sync(ticked: number) {
      done = Math.max(0, Math.min(ticked, last));
      along = 0;
      taken = 0;
    },
  };

}
