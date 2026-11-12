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
 * felt, a stretch ends a little after its length. Ticking a step by hand
 * (`sync`) overrides it.
 */
export function createFollower(route: Route, { stride = STRIDE } = {}) {
  const legs = legLengths(route),
    last = route.steps.length;
  let done = 0,
    along = 0;

  function advance() {
    done++;
    along = 0;
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
    /** One step taken. Returns true when it finished a stretch. */
    step() {
      if (done >= last) return false;
      along += stride;
      const length = legs[done];
      if (along < length) return false;
      // A straight-on step (into a corridor, say) ends on distance; a turn waits
      // to be felt, unless they are well past where it should have been.
      const slack = expectedTurn(route.steps[done + 1]) ? Math.max(4, length * 0.3) : 0;
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
      // About the turn the route makes there, and at least half way along: step
      // counting can be a third short (short strides) but not that far out.
      if (!sameWay || Math.abs(angle) < Math.abs(expected) * 0.5 || along < legs[done] * 0.5) return false;
      advance();
      return true;
    },
    /** The visitor ticked steps by hand: follow on from there. */
    sync(ticked: number) {
      done = Math.max(0, Math.min(ticked, last));
      along = 0;
    },
  };

}
