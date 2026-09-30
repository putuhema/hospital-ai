import type { Place } from "./wayfinding/routing.ts";

/**
 * "You are here" signs: a printed QR code that opens the hospital map with
 * the sign's spot already set as the starting point.
 */

/** The link a sign's QR code opens, e.g. https://…/m/abc?from=b:9 */
export const signLink = (mapUrl: string, place: Place) =>
  `${mapUrl}?from=${encodeURIComponent(place.id).replaceAll("%3A", ":")}`;

/** Room types that usually get a sign: where people arrive or change floors. */
const SIGN_ROOMS = ["Reception desk", "Stairs & lift", "Waiting area"];

/**
 * Where signs are suggested by default: named landmarks (entrances, lifts,
 * cafés), reception desks, waiting areas and stairs. Without any of those,
 * every building.
 */
export function suggestedSpots(list: Place[]): Place[] {
  const spots = list.filter(
    (p) => p.kind === "landmark" || (p.kind === "room" && SIGN_ROOMS.includes(p.detail)),
  );
  return spots.length ? spots : list.filter((p) => p.kind === "building");
}

/** Places a sign can stand at: everything except listed rooms, which have no spot of their own. */
export const signablePlaces = (list: Place[]) => list.filter((p) => p.kind !== "listed");
