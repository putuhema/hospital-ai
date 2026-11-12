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

/**
 * What a scanned QR code says: the spot of one of this map's signs (its place
 * id, as in `signLink`), a sign of another hospital's map, or something else.
 */
export function readSign(text: string, slug: string | undefined): { from: string } | { error: "other-map" | "not-a-sign" } {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { error: "not-a-sign" };
  }
  const from = url.searchParams.get("from"),
    map = url.pathname.match(/^\/m\/([^/]+)\/?$/)?.[1];
  if (!from || !(map || url.pathname === "/")) return { error: "not-a-sign" };
  if (map && slug && map !== slug) return { error: "other-map" };
  return { from };
}
