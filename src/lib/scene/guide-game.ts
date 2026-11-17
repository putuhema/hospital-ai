/**
 * "Antar pengunjung": a game to pass the time while waiting. Visitors stand
 * about the hospital lost, a "?" over their heads: a grandmother looking for
 * the pharmacy, a mother with her child looking for a ward. Walk up to one and
 * they follow you; lead them to where they want to go before the clock runs
 * out. The arrow at your feet follows the hospital's real walking route, so
 * playing teaches the way.
 *
 * One clock for the whole game: it starts at a minute, and each visitor
 * brought adds time, more when quick. Points for each, more when quick.
 * Plain state, stepped by `tick`, so it is tested without a scene.
 */

/** A spot on the ground, in metres. */
export type Spot = { x: number; z: number };

/** Who is lost: how they look, and what they are called. */
export type Who = { name: string; look: "elder" | "adult" | "pair" | "patient" };

/** A visitor to lead: who, where they wait, where they want to go, and the time a good guide takes. */
export type Fare = {
  who: Who;
  from: Spot;
  /** Where they want to be: the place's name and the spot to bring them to (its door). */
  to: Spot & { name: string };
  /** Seconds a good guide takes, from the walking route. */
  budget: number;
};

export type Rating = "fast" | "good" | "slow";

export type Game = {
  state: "seeking" | "guiding" | "over";
  /** Seconds left on the game clock. */
  clock: number;
  score: number;
  delivered: number;
  /** The visitor waiting to be found (seeking), or being led (guiding). */
  fare: Fare | null;
  /** Seconds since they started following. */
  taken: number;
};

export type GameEvent =
  | { type: "picked"; fare: Fare }
  | { type: "delivered"; fare: Fare; rating: Rating; points: number; seconds: number }
  | { type: "over" };

export const START_CLOCK = 60,
  /** Close enough to talk to someone, or to their destination. */
  PICK_UP = 2.2,
  ARRIVE = 3;

/** Seconds a good guide takes over a route of `meters`, at a run with a little slack. */
export const budgetFor = (meters: number) => Math.round(meters / 5 + 8);

export const newGame = (fare: Fare | null): Game => ({ state: "seeking", clock: START_CLOCK, score: 0, delivered: 0, fare, taken: 0 });

/** How well a visitor was brought: within 60% of the time a good guide takes is fast. */
export const rate = (taken: number, budget: number): Rating => (taken <= budget * 0.6 ? "fast" : taken <= budget ? "good" : "slow");

/** Seconds added to the clock and points for bringing someone. */
export function reward(rating: Rating, taken: number, budget: number) {
  const seconds = rating === "fast" ? 12 : rating === "good" ? 8 : 4;
  const points = 100 + Math.max(0, Math.round((budget - taken) * 10)) + (rating === "fast" ? 50 : 0);
  return { seconds, points };
}

const near = (a: Spot, b: Spot, d: number) => Math.hypot(a.x - b.x, a.z - b.z) <= d;

/**
 * The game after `dt` seconds with the player at `player`. `next` makes the
 * next lost visitor once one is brought (null when none can be made).
 */
export function tick(game: Game, dt: number, player: Spot, next: () => Fare | null): { game: Game; events: GameEvent[] } {
  if (game.state === "over") return { game, events: [] };
  const events: GameEvent[] = [];
  let g: Game = { ...game, clock: Math.max(0, game.clock - dt) };
  if (g.state === "seeking" && g.fare && near(player, g.fare.from, PICK_UP)) {
    g = { ...g, state: "guiding", taken: 0 };
    events.push({ type: "picked", fare: g.fare! });
  } else if (g.state === "guiding" && g.fare) {
    const fare = g.fare;
    g = { ...g, taken: g.taken + dt };
    if (near(player, fare.to, ARRIVE)) {
      const rating = rate(g.taken, fare.budget),
        { seconds, points } = reward(rating, g.taken, fare.budget);
      events.push({ type: "delivered", fare, rating, points, seconds });
      g = { ...g, state: "seeking", clock: g.clock + seconds, score: g.score + points, delivered: g.delivered + 1, fare: next(), taken: 0 };
    }
  } else if (g.state === "seeking" && !g.fare) g = { ...g, fare: next() };
  if (g.clock <= 0) {
    g = { ...g, state: "over", clock: 0 };
    events.push({ type: "over" });
  }
  return { game: g, events };
}

/** The lost visitors, in turn: names as visitors here would be called. */
export const PEOPLE: Who[] = [
  { name: "Nenek Hasnah", look: "elder" },
  { name: "Ibu Sari dan anaknya", look: "pair" },
  { name: "Pak Yusuf", look: "patient" },
  { name: "Kak Rina", look: "adult" },
  { name: "Kakek Baco", look: "elder" },
  { name: "Ibu Nur dan anaknya", look: "pair" },
  { name: "Pak Arman", look: "adult" },
  { name: "Ibu Ani", look: "patient" },
];

/** Where lost visitors want to go, by name: the pharmacy, wards, clinics, the lab and the like. */
export const WANTED = /farmasi|apotek|pharmacy|perawatan|ward|poli|clinic|igd|emergency|lab|radiologi|radiology|kasir|rekam medis|icu|gizi|mushola/i;
