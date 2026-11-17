import { categories, type LandmarkCategory } from "../model/categories.ts";
import { roomTypes } from "../model/interiors.ts";
import { planRoute, type NavGrid, type Place } from "./routing.ts";
import type { Point } from "./navigation.ts";
import { search } from "./search.ts";

/** A kind of place to jump to, e.g. the nearest toilets or parking. */
export type Shortcut = {
  /** The places' `detail`, e.g. "Toilets" or "Parking". */
  name: string;
  kind: "room" | "landmark" | "area";
  category?: LandmarkCategory;
};

// What visitors look for most, first.
const ORDER = ["toilet", "info", "reception", "cafe", "pharmacy", "parking", "emergency", "atm", "prayer", "lift", "stairs", "dropoff", "entrance", "radiology", "lab"];
const rank = (key: string) => (ORDER.indexOf(key) + 1 || ORDER.length + 1);

/** Room types and landmark kinds that exist in this layout, most useful first. */
export function shortcuts(list: Place[], limit = Infinity): Shortcut[] {
  const rooms = roomTypes
    .filter((t) => list.some((p) => p.kind === "room" && p.detail === t.name))
    .map((t) => ({ key: t.type as string, name: t.name, kind: "room" as const }));
  const marks = categories
    .filter((c) => c.id !== "other" && list.some((p) => (p.kind === "landmark" || p.kind === "area") && p.category === c.id))
    .map((c) => ({ key: c.id as string, name: c.name, kind: "landmark" as const, category: c.id }));
  return [...rooms, ...marks]
    .sort((a, b) => rank(a.key) - rank(b.key))
    .slice(0, limit)
    .map(({ key: _, ...s }) => s);
}

/**
 * The emergency department (IGD) to go to: the nearest by walking from
 * `from`, or the best-named one without a start. Found the way visitors
 * search ("igd" also finds Emergency rooms and "Gawat Darurat"); a maternity
 * emergency (IGD PONEK) only when there is no other.
 */
export function emergencyPlace(list: Place[], grid: NavGrid, from: Place | Point | null): Place | null {
  const matches = search(list, "igd");
  if (!matches.length) return null;
  const top = matches[0].score;
  let options = matches.filter((m) => m.score >= top * 0.8).map((m) => m.place);
  const general = options.filter((p) => !/ponek|maternal|kebidanan|obstetri/i.test(p.name));
  if (general.length) options = general;
  if (!from || options.length === 1) return options[0];
  let best = options[0],
    bestMeters = Infinity;
  for (const p of options) {
    const r = planRoute(grid, from, p);
    if (r && r.meters < bestMeters) [best, bestMeters] = [p, r.meters];
  }
  return best;
}
