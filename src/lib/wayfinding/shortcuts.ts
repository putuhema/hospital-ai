import { categories, type LandmarkCategory } from "../model/categories.ts";
import { roomTypes } from "../model/interiors.ts";
import type { Place } from "./routing.ts";

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
