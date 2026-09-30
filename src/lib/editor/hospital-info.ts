/**
 * The hospital information page (/editor/info): the questions visitors ask
 * and the doctors' schedules, edited on the saved layout.
 */
import type { Piece } from "../model/layout.ts";
import type { Doctor } from "../model/doctors.ts";
import { parseInfo, type PlaceInfo } from "../model/place-info.ts";
import { places, type Place } from "../wayfinding/routing.ts";
import type { WalkingNetwork } from "../wayfinding/navigation.ts";

/** Where doctors can practise: rooms first (clinics are rooms), then whole buildings. */
export const clinics = (pieces: Piece[]): Place[] =>
  places(pieces)
    .filter((p) => p.kind === "room" || p.kind === "building")
    .sort((a, b) => Number(a.kind === "building") - Number(b.kind === "building"));

/** A place's details changed, as a new layout; `id` is a place id from `places`. */
export function withInfo(
  pieces: Piece[],
  network: WalkingNetwork,
  id: string,
  info: PlaceInfo | undefined,
): { pieces: Piece[]; network: WalkingNetwork } {
  const [kind, a, b] = id.split(":");
  if (kind === "n")
    return { pieces, network: { ...network, nodes: network.nodes.map((n) => (n.id === a ? { ...n, info } : n)) } };
  return {
    network,
    pieces: pieces.map((p) =>
      String(p.id) !== a
        ? p
        : kind === "r"
          ? { ...p, roomAssets: p.roomAssets?.map((r) => (String(r.id) === b ? { ...r, info } : r)) }
          : { ...p, info },
    ),
  };
}

/**
 * A place's doctors replaced, keeping its other details. Doctors still
 * without a name stay while they are being written; loading drops them.
 */
export function withDoctors(info: PlaceInfo | undefined, doctors: Doctor[]): PlaceInfo | undefined {
  const { doctors: _, ...rest } = info ?? {};
  return doctors.length ? { ...rest, doctors } : parseInfo(rest);
}
